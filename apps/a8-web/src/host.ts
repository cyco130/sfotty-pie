import {
	AtrImage,
	buildBootDisk,
	buildNtscPalette,
	buildPalPalette,
	Cartridge,
	detectFileFormat,
	FRAME_BUFFER_HEIGHT,
	FRAME_BUFFER_WIDTH,
	NTSC_PIXEL_ASPECT_RATIO,
	PAL_PIXEL_ASPECT_RATIO,
	preferredBasicKeys,
	preferredOsKeys,
	type AtariFileFormat,
	type AtariModel,
	type FirmwareKey,
} from "@sfotty-pie/a8";
import { computed, signal } from "@preact/signals";
import type { AudioOutput } from "./audio.ts";
import { commands, type Command } from "./commands.ts";
import { Emulator } from "./emulator.ts";
import { osSlotFor, type OsSlot } from "./firmware-slots.ts";
import {
	addOrFindImage,
	getImage,
	getImageBytes,
	keepImage,
	libraryEntries,
	nukeLibrary,
	readyLibrary,
	removeImage,
	sweepTransients,
	updateImage,
} from "./images/library.ts";
import type { ImageEntry } from "./images/metadata.ts";
import { Keyboard } from "./keyboard.ts";
import {
	clampRam,
	hasBuiltinBasic,
	MODEL_LABELS,
	ramConfig,
	sanitizeSettings,
	settingsEqual,
	type MachineSettings,
} from "./machine-config.ts";
import { currentPath, navigate } from "./navigate.ts";
import { messages } from "./messages.ts";
import { recentIds, removeRecent, touchRecent } from "./recents.ts";
import {
	clearAllPersisted,
	clearSessionPersisted,
	loadPersisted,
	loadSession,
	savePersisted,
	saveSession,
} from "./persist.ts";

export interface HostConfig {
	model: AtariModel;
	audio: AudioOutput | null;
	/** Why audio is unavailable, if it failed to initialize (shown on tap). */
	audioError?: string | null;
}

/**
 * The audio indicator's state: no Web Audio at all, suspended (awaiting the
 * first user gesture), playing, or muted at the output.
 */
export type AudioState = "unavailable" | "suspended" | "on" | "muted";

/**
 * A transient on-screen notification. `info`/`warning` auto-dismiss in the
 * corner; `error` pins (with Copy) until dismissed. See the `Toasts` view.
 */
export type ToastKind = "info" | "warning" | "error";
export interface Toast {
	id: number;
	kind: ToastKind;
	text: string;
}

/**
 * The sidebar's content when open. Stable string ids so the state stays
 * serializable (a future deep-link layer can map these straight to the URL).
 */
export type SidebarPanel = "menu" | "palette" | "roms" | "library";

export type { MachineSettings } from "./machine-config.ts";

/**
 * In-memory firmware overrides; an explicit pick beats the ranking. Values are
 * library image ids — a built-in's firmware key, or a user upload's UUID.
 */
export interface RomOverrides {
	os: Partial<Record<OsSlot, string>>;
	basic: string | null;
	game: string | null;
}

const NO_ROM_OVERRIDES: RomOverrides = { os: {}, basic: null, game: null };

// Persisted-state keys (namespaced by storageName) — see persist.ts.
const CONFIG_KEY = "config";
const ROMS_KEY = "roms";
// The mounted media is per-tab (sessionStorage only) — a fresh tab starts empty
// rather than auto-booting the last session's image.
const MEDIA_KEY = "media";

/** This tab's persisted mounted media: the library ids in each slot. */
interface PersistedMedia {
	cart: string | null;
	disk: string | null;
	/** The live BASIC-disabled state (a boot turns it off without touching the
	 *  saved config seed), so a resume matches the booted machine. */
	basicDisabled: boolean;
}

// Coerce an untrusted persisted value into a PersistedMedia, or null if absent
// or malformed (ids are resolved against the library lazily, on restore).
function sanitizeMedia(value: unknown): PersistedMedia | null {
	if (typeof value !== "object" || value === null) return null;
	const v = value as Partial<PersistedMedia>;
	return {
		cart: typeof v.cart === "string" ? v.cart : null,
		disk: typeof v.disk === "string" ? v.disk : null,
		basicDisabled: Boolean(v.basicDisabled),
	};
}

function romsEqual(a: RomOverrides, b: RomOverrides): boolean {
	if (a.basic !== b.basic || a.game !== b.game) return false;
	const slots = new Set([...Object.keys(a.os), ...Object.keys(b.os)]);
	for (const slot of slots) {
		if (a.os[slot as OsSlot] !== b.os[slot as OsSlot]) return false;
	}
	return true;
}

// Coerce a persisted/untrusted value into a RomOverrides shape; ids are
// validated lazily at resolve time (a stale one falls back to the ranking).
function sanitizeRoms(value: unknown): RomOverrides {
	if (typeof value !== "object" || value === null) return NO_ROM_OVERRIDES;
	const v = value as Partial<RomOverrides>;
	return {
		os:
			v.os && typeof v.os === "object"
				? (v.os as Partial<Record<OsSlot, string>>)
				: {},
		basic: typeof v.basic === "string" ? v.basic : null,
		game: typeof v.game === "string" ? v.game : null,
	};
}

/** Why a detected-but-not-loadable file can't be loaded (yet). */
function unsupportedMessage(format: AtariFileFormat | null): string | null {
	switch (format) {
		case "os-rom-10k":
		case "os-rom-16k":
			return messages.errors.osRom;
		case null:
			return messages.errors.unrecognized;
		default:
			return null; // a cartridge, disk, or executable
	}
}

/**
 * Owns the emulator's imperative lifetime — the live {@link Emulator}
 * instance (swapped on Load), the real-time present loop, audio, and the
 * keyboard — so the Preact chrome stays a thin view. Reactive UI state is
 * exposed as signals; the canvas and keystroke loops are wired up via the
 * `attach*` methods (called from the component's mount effect) and never
 * touch Preact's render path.
 */
export class EmulatorHost {
	/**
	 * What's attached, for the status bar: the cartridge-slot label (a cart
	 * name, or "BASIC" when it occupies the 400/800 cart slot, or null) and a
	 * per-drive disk name (index 0 = D1:; null = empty).
	 */
	readonly attachments = signal<{
		cartridge: string | null;
		drives: (string | null)[];
	}>({ cartridge: null, drives: [null] });

	/** True once the CPU has jammed (CIM). */
	readonly crashed = signal(false);

	/** Pinned error toasts (top-center, dismissed manually; copyable). */
	readonly errors = signal<Toast[]>([]);
	/** Auto-dismissing info/warning toasts (bottom-right). */
	readonly notices = signal<Toast[]>([]);
	#nextToastId = 0;

	/** The running machine configuration (drives the config indicator). */
	readonly config = signal<MachineSettings>({
		model: "xl/xe",
		memory: 64,
		portbExtendedRam: null,
		tv: "ntsc",
		basicDisabled: false,
	});

	/** The menu's working copy — applied (with a reboot) on demand. */
	readonly staged = signal<MachineSettings>(this.config.peek());

	/** True while the staged config differs from the running machine. */
	readonly dirty = computed(
		() => !settingsEqual(this.staged.value, this.config.value),
	);

	/** Whether emulation is running (vs. paused). */
	readonly running = signal(true);

	/** The audio indicator state. */
	readonly audio = signal<AudioState>("unavailable");

	/** The measured emulated frame rate, sampled about once a second. */
	readonly fps = signal(0);

	/** Whether turbo mode (unthrottled, muted) is engaged. */
	readonly turboMode = signal(false);

	/** The 1200XL keyboard LEDs `[L1, L2]` (true = lit), or null on other models. */
	readonly leds = signal<readonly [boolean, boolean] | null>(null);

	/**
	 * Which sidebar panel is showing, or null when closed. The sidebar is a
	 * single docked surface that hosts the menu, the command palette, and (in
	 * future) other dialogs — one at a time, always pushing the screen aside
	 * rather than covering it.
	 */
	readonly sidebar = signal<SidebarPanel | null>(null);

	// Fetched ROM bytes, keyed by the resolved image's id — populated lazily
	// before each (re)build so #makeEmulator can read them synchronously.
	readonly #bytes = new Map<string, Uint8Array>();
	// In-memory firmware overrides (not persisted). appliedRoms is what the
	// running machine uses; stagedRoms is the ROMs panel's working copy. applyRoms
	// adopts it, rebooting only when the picks change the running machine.
	readonly appliedRoms = signal<RomOverrides>(NO_ROM_OVERRIDES);
	readonly stagedRoms = signal<RomOverrides>(NO_ROM_OVERRIDES);
	readonly romsDirty = computed(
		() => !romsEqual(this.stagedRoms.value, this.appliedRoms.value),
	);
	// Whether applying the staged picks would change the firmware the running
	// machine actually uses (vs. just saving a pick for a model to switch into).
	readonly romsReboot = computed(() => {
		const applied = this.#resolveWith(this.appliedRoms.value);
		const staged = this.#resolveWith(this.stagedRoms.value);
		return (
			applied.os?.id !== staged.os?.id ||
			applied.basic?.id !== staged.basic?.id ||
			applied.game?.id !== staged.game?.id
		);
	});
	readonly #audio: AudioOutput | null;
	readonly #audioError: string | null;
	readonly #keyboard: Keyboard;
	// The model a brand-new install starts from (and resets fall back to).
	readonly #defaultModel: AtariModel;

	// Assigned by create() before the host is handed out — the constructor can't
	// await the initial firmware fetch.
	#emulator!: Emulator;
	// Bumped per reboot so a slow firmware fetch can't clobber a newer config.
	#rebootToken = 0;
	// Drops the PORTB watch feeding the 1200XL LEDs; re-pointed on each rebuild.
	#unwatchLeds: (() => void) | null = null;
	#keyInput: HTMLInputElement | null = null;
	#bootImagePicker: (() => void) | null = null;
	// What to do with the next file the shared picker yields (boot vs. attach).
	#pendingPick: (file: File) => void = (file) => void this.loadFile(file);
	#cpuTrace = false; // persists across reboots; reapplied to each emulator
	#turboMode = false; // persists across reboots; reapplied to each emulator
	// What's mounted, kept across reboots and re-applied by #makeEmulator. The
	// cartridge slot and the disk drives are independent (a cart and a disk can
	// coexist); #drives is indexed by drive number (0 = D1:), one slot for now.
	// `sourceId` is the library entry the cart/disk came from, if any — used to
	// persist what's mounted (and, for a disk, what `saveD1ToLibrary` writes back).
	#cartridge: { cart: Cartridge; name: string; sourceId?: string } | null =
		null;
	#drives: ({ disk: AtrImage; name: string; sourceId?: string } | null)[] = [
		null,
	];
	// Media to re-mount once the library is ready (set from sessionStorage in the
	// constructor, consumed by create()/#restoreMedia). Null when nothing to do.
	#pendingMedia: PersistedMedia | null = null;

	/**
	 * Build a host and boot its first emulator. Async because the initial OS +
	 * BASIC bytes are fetched here (the constructor stays synchronous and the
	 * emulator can't be built until they're cached).
	 */
	static async create(config: HostConfig): Promise<EmulatorHost> {
		const host = new EmulatorHost(config);
		await host.#ensureFirmware();
		await host.#restoreMedia();
		host.#emulator = host.#makeEmulator();
		host.#wireLeds();
		return host;
	}

	constructor({ model, audio, audioError }: HostConfig) {
		this.#audio = audio;
		this.#audioError = audioError ?? null;
		this.#defaultModel = model;
		// Start from the last persisted machine config (this tab's, else the
		// last-used seed), falling back to a default for the requested model.
		this.config.value = sanitizeSettings(
			loadPersisted(CONFIG_KEY),
			this.#defaultSettings(),
		);
		// This tab's mounted media (if any) is restored by create() once the
		// library loads; its live BASIC state overrides the saved config seed so
		// a resumed boot matches the machine it left.
		this.#pendingMedia = sanitizeMedia(loadSession(MEDIA_KEY));
		if (this.#pendingMedia) {
			this.config.value = {
				...this.config.value,
				basicDisabled: this.#pendingMedia.basicDisabled,
			};
		}
		this.staged.value = this.config.peek();
		// Restore firmware picks (ids resolve lazily; a stale one falls back to
		// the ranking).
		this.appliedRoms.value = sanitizeRoms(loadPersisted(ROMS_KEY));
		this.stagedRoms.value = this.appliedRoms.peek();

		// #emulator is built by create() once the initial firmware is fetched.
		this.#keyboard = new Keyboard((command) => this.dispatch(command));

		// The audio context resumes/suspends asynchronously; track it.
		if (audio) {
			audio.context.addEventListener("statechange", () =>
				this.#refreshAudioState(),
			);
			this.#refreshAudioState();
		}

		// Keep the status-bar attachment labels in sync with the config — the
		// 400/800 BASIC slot depends on the model and whether BASIC is enabled.
		// (Runs immediately, seeding the initial labels.)
		this.config.subscribe(() => this.#refreshAttachments());
	}

	// Recompute the status-bar attachment labels from the mounted slots and the
	// running config. On the 400/800 an enabled BASIC occupies the cartridge
	// slot (when no cart is mounted) and shows there like any cartridge; on
	// XL/XE BASIC is internal and isn't shown.
	#refreshAttachments(): void {
		const { model, basicDisabled } = this.config.value;
		// On the 400/800 an enabled BASIC is a real cartridge in the slot, so
		// show the actual ROM image's name; on XL/XE BASIC is internal and the
		// slot reflects only a real cartridge.
		const basic =
			!hasBuiltinBasic(model) && !basicDisabled
				? (this.#pick(preferredBasicKeys())?.user.displayName ?? null)
				: null;
		this.attachments.value = {
			cartridge: this.#cartridge?.name ?? basic,
			drives: this.#drives.map((drive) => drive?.name ?? null),
		};
	}

	// Persist this tab's mounted media (the library ids in each slot) plus the
	// live BASIC state, so reloading the tab resumes the running machine. Only
	// slots backed by a library entry persist; an id-less mount is dropped (it
	// can't be reconstructed). Session-only — a fresh tab starts empty.
	#saveMedia(): void {
		saveSession(MEDIA_KEY, {
			cart: this.#cartridge?.sourceId ?? null,
			disk: this.#drives[0]?.sourceId ?? null,
			basicDisabled: this.config.value.basicDisabled,
		} satisfies PersistedMedia);
	}

	// Record a just-booted/attached library image in the recents history, then
	// sweep transient (auto-added) images that have fallen off it — keeping any
	// still mounted, so a resume never loses its backing blob.
	#noteUsed(sourceId: string | undefined): void {
		if (!sourceId) return;
		touchRecent(sourceId);
		const keep = new Set(recentIds.value);
		if (this.#cartridge?.sourceId) keep.add(this.#cartridge.sourceId);
		if (this.#drives[0]?.sourceId) keep.add(this.#drives[0].sourceId);
		void sweepTransients(keep);
	}

	#mountsImage(id: string): boolean {
		return this.#cartridge?.sourceId === id || this.#drives[0]?.sourceId === id;
	}

	// Re-mount the media persisted for this tab, resolving ids against the
	// library; an image deleted since (or any read error) is silently skipped, so
	// a stale pointer just yields an empty slot. Runs in create() after the
	// library has loaded, before the first emulator is built.
	async #restoreMedia(): Promise<void> {
		const media = this.#pendingMedia;
		this.#pendingMedia = null;
		if (!media) return;
		await readyLibrary();
		if (media.disk) {
			try {
				const entry = getImage(media.disk);
				if (entry) {
					const bytes = await getImageBytes(media.disk);
					const disk =
						entry.derived.type === "xex"
							? buildBootDisk(bytes)
							: new AtrImage(bytes);
					this.#drives[0] = {
						disk,
						name: entry.user.displayName,
						sourceId: media.disk,
					};
				}
			} catch {
				// corrupt or missing blob — leave D1: empty
			}
		}
		if (media.cart) {
			try {
				const entry = getImage(media.cart);
				if (entry) {
					const bytes = await getImageBytes(media.cart);
					this.#cartridge = {
						cart: new Cartridge(bytes),
						name: entry.user.displayName,
						sourceId: media.cart,
					};
				}
			} catch {
				// corrupt or missing blob — leave the cart slot empty
			}
		}
		this.#refreshAttachments();
	}

	/** Run a bound command (from a key binding, the UI, or the palette). */
	dispatch(command: Command): void {
		commands[command].run({ emulator: this.#emulator, host: this });
	}

	/**
	 * Set joystick 0 to an absolute direction — for the analog OSD stick,
	 * which (unlike the keyboard's per-direction press/release) reports a
	 * whole position at once. `mask` bits: 1 = up, 2 = down, 4 = left,
	 * 8 = right; 0 = centred. Release-then-press is atomic between frames.
	 */
	setJoystickDirection(mask: number): void {
		const machine = this.#emulator.machine;
		machine.joystickUp(0, 0x0f & ~mask);
		machine.joystickDown(0, mask);
	}

	// The best-ranked built-in firmware present in the library for a list of
	// keys (a built-in's image id is its firmware key).
	#pick(keys: readonly FirmwareKey[]): ImageEntry | null {
		for (const key of keys) {
			const entry = getImage(key);
			if (entry) return entry;
		}
		return null;
	}

	// The OS + BASIC the running config wants, picked from the library by rank.
	// BASIC is omitted when the machine doesn't wire it in (the 400/800 with the
	// cartridge slot taken; the XL/XE "disable" is the OPTION-hold at boot).
	#resolveFirmware(): {
		os: ImageEntry | null;
		basic: ImageEntry | null;
		game: ImageEntry | null;
	} {
		return this.#resolveWith(this.appliedRoms.value);
	}

	// Resolve OS/BASIC/game for the running config under a given override set; an
	// override wins over the ranking when its image is present (a missing one —
	// e.g. a built-in dropped by a deploy — falls back to the ranking).
	#resolveWith(roms: RomOverrides): {
		os: ImageEntry | null;
		basic: ImageEntry | null;
		game: ImageEntry | null;
	} {
		const { model, tv, basicDisabled } = this.config.value;
		// Built-in BASIC (xl/xe, xegs) is always loaded — its "disable" is the
		// OPTION-hold. Cart BASIC (400/800, 1200xl) loads only when it takes the
		// slot: enabled and no cartridge mounted.
		const needBasic =
			hasBuiltinBasic(model) || (!basicDisabled && this.#cartridge === null);
		const osSlot = osSlotFor(model, tv);
		return {
			os:
				this.#fromId(roms.os[osSlot]) ??
				this.#pick(preferredOsKeys({ model, tv })),
			basic: needBasic
				? (this.#fromId(roms.basic) ?? this.#pick(preferredBasicKeys()))
				: null,
			game:
				model === "xegs" ? (this.#fromId(roms.game) ?? this.#pickGame()) : null,
		};
	}

	// Resolve an override to its library image — null when it doesn't resolve
	// (no override, or one pointing at an image the library no longer has).
	#fromId(id: string | null | undefined): ImageEntry | null {
		return id ? (getImage(id) ?? null) : null;
	}

	// The XEGS built-in game — a bundled game-slot image.
	#pickGame(): ImageEntry | null {
		return (
			libraryEntries.value.find(
				(e) => e.source === "builtin" && e.user.slots?.includes("game"),
			) ?? null
		);
	}

	// Fetch (and cache) the bytes the running config's OS + BASIC need, so the
	// next #makeEmulator can read them synchronously. Already-cached ROMs (the
	// common reboot case) resolve immediately. Ensures the user library is loaded
	// first so an override pointing at an upload resolves (resilient: an IDB
	// failure just leaves built-ins).
	async #ensureFirmware(): Promise<void> {
		await readyLibrary();
		const { os, basic, game } = this.#resolveFirmware();
		await Promise.all(
			[os, basic, game]
				.filter((e): e is ImageEntry => e !== null)
				.filter((e) => !this.#bytes.has(e.id))
				.map(async (e) => {
					this.#bytes.set(e.id, await getImageBytes(e.id));
				}),
		);
	}

	// Build an emulator for the running config + the mounted image. The OS and
	// BASIC ROMs are picked from the library by the model's preference ranking.
	// On the 800 the BASIC cart shares the slot, so it's present only when not
	// disabled and no cartridge is mounted. The XL/XE always wire BASIC in (its
	// "disable" is the OPTION-hold at boot).
	#makeEmulator(): Emulator {
		const { model, tv, basicDisabled, memory, portbExtendedRam } =
			this.config.value;
		const xl = model !== "400/800";
		const builtinBasic = hasBuiltinBasic(model);

		const { os, basic, game } = this.#resolveFirmware();
		if (!os) {
			throw new Error(messages.errors.noCompatibleOs(model, tv.toUpperCase()));
		}
		// Bytes are cached by #ensureFirmware, which always runs before a build.
		const osBytes = this.#bytes.get(os.id);
		const basicBytes = basic ? this.#bytes.get(basic.id) : undefined;
		const gameBytes = game ? this.#bytes.get(game.id) : undefined;
		if (!osBytes) {
			throw new Error(`firmware bytes missing for "${os.user.displayName}"`);
		}

		// On 400/800 & 1200XL, BASIC is an $A000 cartridge displaced by a real
		// cart; on XL/XE & XEGS it's built in (banked, OPTION-hold to disable).
		const cartridge =
			this.#cartridge?.cart ??
			(!builtinBasic && !basicDisabled && basicBytes
				? new Cartridge(basicBytes)
				: undefined);

		// eslint-disable-next-line no-console -- shows which ROMs the ranking picked
		console.log(
			`Firmware for ${model} ${tv.toUpperCase()}: OS "${os.user.displayName}"` +
				(basic ? `, BASIC "${basic.user.displayName}"` : ", no BASIC"),
		);

		const emulator = new Emulator({
			xl,
			conventionalRamSize: memory,
			...(portbExtendedRam && {
				xeBankCount: (portbExtendedRam.size - 64) / 16,
				separateAnticAccess: portbExtendedRam.antic,
			}),
			os: osBytes,
			tvSystem: tv,
			...(builtinBasic && basicBytes && { basic: basicBytes }),
			...(builtinBasic && basicDisabled && { holdOption: true }),
			...(model === "xegs" && gameBytes && { game: gameBytes }),
			...(cartridge && { cartridge }),
			...(this.#drives[0] && { disk: this.#drives[0].disk }),
			...(this.#audio && { audio: this.#audio }),
		});
		emulator.setTrace(this.#cpuTrace);
		emulator.setTurboMode(this.#turboMode);
		return emulator;
	}

	/** The live emulator (swaps on reboot) — for the dev console. */
	get emulator(): Emulator {
		return this.#emulator;
	}

	/** Toggle the CPU instruction trace (persists across reboots). */
	setCpuTrace(enabled: boolean): void {
		this.#cpuTrace = enabled;
		this.#emulator.setTrace(enabled);
	}

	dumpCpuTrace(count?: number): string[] {
		return this.#emulator.dumpTrace(count);
	}

	clearCpuTrace(): void {
		this.#emulator.clearTrace();
	}

	// Swap in a fresh emulator for the current config + attachment.
	#rebuild(): void {
		this.#emulator.stop();
		this.#audio?.clear();
		this.#emulator = this.#makeEmulator();
		this.#emulator.start();
		this.running.value = true;
		this.#wireLeds();
		this.#keyInput?.focus();
	}

	// Re-point the LED watch at the current machine's PORTB. The 1200XL drives
	// its two keyboard LEDs from PORTB bits 2 & 3 (active-low: 0 = lit); other
	// models have none.
	#wireLeds(): void {
		this.#unwatchLeds?.();
		this.#unwatchLeds = null;
		if (this.config.value.model !== "1200xl") {
			this.leds.value = null;
			return;
		}
		const portb = this.#emulator.machine.pia.portbOut;
		const refresh = (): void => {
			const value = portb.value;
			const l1 = (value & 0x04) === 0;
			const l2 = (value & 0x08) === 0;
			// PORTB changes on every bank switch; only repaint when an LED moves.
			const current = this.leds.value;
			if (current && current[0] === l1 && current[1] === l2) return;
			this.leds.value = [l1, l2];
		};
		this.#unwatchLeds = portb.watch(refresh);
		refresh();
	}

	// Fetch whatever firmware the new config needs, then power-cycle into it.
	// Async (the fetch), but the rebuild itself stays synchronous — so the old
	// machine keeps running until the ROM is ready. Bails if a newer reboot
	// superseded this one mid-fetch, and keeps the old machine on a fetch error.
	async #reboot(): Promise<void> {
		const token = ++this.#rebootToken;
		try {
			await this.#ensureFirmware();
			if (token !== this.#rebootToken) return;
			this.#rebuild();
		} catch (error) {
			this.toast(
				error instanceof Error ? error.message : String(error),
				"error",
			);
		}
	}

	start(): void {
		this.#emulator.start();
		this.running.value = true;
	}

	// --- Command targets ---------------------------------------------------

	pause(): void {
		this.#emulator.stop();
		this.running.value = false;
	}

	resume(): void {
		this.#emulator.start();
		this.running.value = true;
	}

	togglePause(): void {
		if (this.running.value) this.pause();
		else this.resume();
	}

	setTurboMode(enabled: boolean): void {
		this.#turboMode = enabled;
		this.#emulator.setTurboMode(enabled);
		this.turboMode.value = enabled;
	}

	toggleTurboMode(): void {
		this.setTurboMode(!this.turboMode.value);
	}

	setMuted(muted: boolean): void {
		if (!this.#audio) return;
		this.#audio.muted = muted;
		this.#refreshAudioState();
	}

	/**
	 * The audio indicator's click action: enable audio if it's still
	 * suspended (any gesture resumes the context), otherwise flip mute.
	 */
	toggleAudio(): void {
		const audio = this.#audio;
		if (!audio) {
			// No audio sink — surface why (it's the only feedback the user gets).
			if (this.#audioError) {
				this.toast(
					messages.errors.audioUnavailableReason(this.#audioError),
					"error",
				);
			} else {
				this.toast(messages.errors.audioUnavailable, "warning");
			}
			return;
		}
		if (!audio.running) {
			audio.resume();
			return; // the statechange listener updates the indicator
		}
		this.setMuted(!audio.muted);
	}

	/** The App registers how to open the file picker (it owns the input). */
	registerBootImagePicker(open: () => void): void {
		this.#bootImagePicker = open;
	}

	pickBootImage(): void {
		this.#pendingPick = (file) => void this.loadFile(file);
		this.#bootImagePicker?.();
	}

	/** Open the file picker to attach a disk to D1: (no reboot). */
	pickAttachDisk(): void {
		this.#pendingPick = (file) => void this.attachDiskFile(file);
		this.#bootImagePicker?.();
	}

	/** Open the file picker to attach a cartridge (cold boots). */
	pickAttachCartridge(): void {
		this.#pendingPick = (file) => void this.attachCartridgeFile(file);
		this.#bootImagePicker?.();
	}

	/** The shared picker's callback: route the chosen file per the last pick. */
	handlePickedFile(file: File): void {
		this.#pendingPick(file);
	}

	/**
	 * Show a toast. `error` pins top-center (with Copy) until dismissed;
	 * `info`/`warning` auto-dismiss in the bottom-right corner.
	 */
	toast(text: string, kind: ToastKind = "info"): void {
		const entry: Toast = { id: this.#nextToastId++, kind, text };
		const target = kind === "error" ? this.errors : this.notices;
		target.value = [...target.value, entry];
	}

	dismissToast(id: number): void {
		this.errors.value = this.errors.value.filter((t) => t.id !== id);
		this.notices.value = this.notices.value.filter((t) => t.id !== id);
	}

	// Announce the config fields that changed between two settings, as toasts —
	// so the palette's one-shot commands and the menu's batched apply both give
	// the same feedback.
	#announceConfigChange(prev: MachineSettings, next: MachineSettings): void {
		if (next.model !== prev.model) {
			this.toast(messages.toasts.switchingMachine(MODEL_LABELS[next.model]));
		}
		if (next.tv !== prev.tv) {
			this.toast(messages.toasts.switchingTv(next.tv.toUpperCase()));
		}
		if (next.basicDisabled !== prev.basicDisabled) {
			this.toast(this.#basicToggleMessage(next.basicDisabled, next.model));
		}
	}

	// Wording for a BASIC on/off toast: on the 400/800 with no explicit cart,
	// BASIC *is* the cartridge in the slot, so phrase it as attach/detach with
	// the ROM's name; otherwise it's a plain enable/disable.
	#basicToggleMessage(disabled: boolean, model: AtariModel): string {
		if (!hasBuiltinBasic(model) && !this.#cartridge) {
			const name =
				this.#pick(preferredBasicKeys())?.user.displayName ?? "BASIC";
			return disabled
				? messages.toasts.detachingCartridge(name)
				: messages.toasts.attachingCartridge(name);
		}
		return disabled
			? messages.toasts.disablingBasic
			: messages.toasts.enablingBasic;
	}

	/** Show a sidebar panel (switching directly if another is already open). */
	showPanel(panel: SidebarPanel): void {
		if (panel === "menu") this.staged.value = this.config.peek(); // from running config
		navigate(`/a8/emu/${panel}`, { replace: true });
	}

	closePanel(): void {
		navigate("/a8/emu", { replace: true });
		this.#keyInput?.focus(); // return keystrokes to the emulator
	}

	/** A panel's trigger: open it, or close it if it's already the one showing. */
	togglePanel(panel: SidebarPanel): void {
		if (currentPath() === `/a8/emu/${panel}`) this.closePanel();
		else this.showPanel(panel);
	}

	/**
	 * Mirror the URL-derived open panel onto the signal the top bar and OSD read.
	 * The URL is the source of truth (the panel routes); the emulator layout
	 * calls this on navigation.
	 */
	setSidebar(panel: SidebarPanel | null): void {
		this.sidebar.value = panel;
	}

	/**
	 * Enter or leave full screen. Targets the whole document so the toolbar and
	 * the on-screen OSD controls stay in view (the canvas refits via its
	 * ResizeObserver). Where the Fullscreen API is unavailable — notably iPhone
	 * Safari, which only fullscreens video — say so rather than silently fail.
	 */
	toggleFullscreen(): void {
		if (document.fullscreenElement) {
			void document.exitFullscreen();
			return;
		}
		const root = document.documentElement;
		if (!root.requestFullscreen) {
			this.toast(messages.errors.fullscreenUnavailable, "warning");
			return;
		}
		void root.requestFullscreen().catch(() => {
			this.toast(messages.errors.fullscreenUnavailable, "warning");
		});
	}

	// Machine configuration. The menu's form stages changes (below) and applies
	// them with a single reboot; the palette's config commands apply one change
	// and reboot immediately (apply*, below that).
	stageModel(model: AtariModel): void {
		// Keep the staged RAM valid for the new class (the 400/800 caps at 48K,
		// no extended RAM).
		this.staged.value = {
			...this.staged.value,
			model,
			...clampRam(model, this.staged.value),
		};
	}

	stageRam(totalKB: number): void {
		this.staged.value = { ...this.staged.value, ...ramConfig(totalKB) };
	}

	stageAntic(antic: boolean): void {
		const ext = this.staged.value.portbExtendedRam;
		if (!ext) return;
		this.staged.value = {
			...this.staged.value,
			portbExtendedRam: { ...ext, antic },
		};
	}

	stageTv(tv: "ntsc" | "pal"): void {
		this.staged.value = { ...this.staged.value, tv };
	}

	stageBasicDisabled(basicDisabled: boolean): void {
		this.staged.value = { ...this.staged.value, basicDisabled };
	}

	/** Apply the staged config: adopt it, power-cycle into it, close the menu. */
	applyConfig(): void {
		if (!this.dirty.value) return;
		const prev = this.config.value;
		this.config.value = this.staged.value;
		savePersisted(CONFIG_KEY, this.config.value);
		this.#saveMedia(); // keep the resume's live BASIC state in sync
		this.#announceConfigChange(prev, this.config.value);
		void this.#reboot();
		this.closePanel();
	}

	// Apply a single config change to the running machine and reboot into it —
	// the palette's "… (reboots)" commands. A no-op change is ignored so it
	// doesn't cost a pointless cold boot. The staged copy follows so the menu
	// opens clean.
	#applyConfigChange(change: Partial<MachineSettings>): void {
		const next = { ...this.config.value, ...change };
		if (settingsEqual(next, this.config.value)) return;
		const prev = this.config.value;
		this.config.value = next;
		this.staged.value = next;
		savePersisted(CONFIG_KEY, next);
		this.#saveMedia(); // keep the resume's live BASIC state in sync
		this.#announceConfigChange(prev, next);
		void this.#reboot();
	}

	applyModel(model: AtariModel): void {
		this.#applyConfigChange({ model, ...clampRam(model, this.config.value) });
	}

	applyRam(totalKB: number): void {
		this.#applyConfigChange(ramConfig(totalKB));
	}

	// --- Firmware overrides (the ROMs panel). Staged like the machine config:
	// picks go to stagedRoms; applyRoms commits them and reboots. ---

	/** Reset the ROMs panel's working copy to what's applied (on panel open). */
	syncStagedRoms(): void {
		this.stagedRoms.value = this.appliedRoms.value;
	}

	// `null` clears the override (back to the automatic ranking) — so picking the
	// default value doesn't register as a staged change. `id` is a library image
	// id (a built-in's firmware key, or a user upload's UUID).
	stageOsRom(slot: OsSlot, id: string | null): void {
		const os = { ...this.stagedRoms.value.os };
		if (id === null) delete os[slot];
		else os[slot] = id;
		this.stagedRoms.value = { ...this.stagedRoms.value, os };
	}

	stageBasicRom(id: string | null): void {
		this.stagedRoms.value = { ...this.stagedRoms.value, basic: id };
	}

	stageGameRom(id: string | null): void {
		this.stagedRoms.value = { ...this.stagedRoms.value, game: id };
	}

	/** Adopt the staged ROM picks; reboot only if they change the running machine. */
	applyRoms(): void {
		if (!this.romsDirty.value) return;
		const reboot = this.romsReboot.value;
		this.appliedRoms.value = this.stagedRoms.value;
		savePersisted(ROMS_KEY, this.appliedRoms.value);
		if (reboot) void this.#reboot();
	}

	applyTv(tv: "ntsc" | "pal"): void {
		this.#applyConfigChange({ tv });
	}

	toggleTv(): void {
		this.applyTv(this.config.value.tv === "ntsc" ? "pal" : "ntsc");
	}

	applyBasicDisabled(basicDisabled: boolean): void {
		this.#applyConfigChange({ basicDisabled });
	}

	toggleBasic(): void {
		this.applyBasicDisabled(!this.config.value.basicDisabled);
	}

	/** Cold-restart the current machine (keeps all mounted media). */
	powerCycle(): void {
		this.toast(messages.toasts.powerCycling);
		this.#emulator.coldStart();
	}

	#refreshAudioState(): void {
		const audio = this.#audio;
		if (!audio) {
			this.audio.value = "unavailable";
		} else if (!audio.running) {
			this.audio.value = "suspended";
		} else {
			this.audio.value = audio.muted ? "muted" : "on";
		}
	}

	/**
	 * Boot a user-supplied file (the "Boot image…" picker / drag-and-drop). The
	 * file is auto-added to the library (transient) so it has an id — for resume
	 * and save — and booted through it; unrecognized bytes still warn directly.
	 */
	async loadFile(file: File): Promise<void> {
		const bytes = new Uint8Array(await file.arrayBuffer());
		const id = await addOrFindImage(bytes, file.name, true);
		if (id) await this.bootImage(id);
		else this.#bootImage(bytes, file.name);
	}

	// --- Image library actions (by id; built-in or user). The id-based entry
	// points fetch the bytes through the facade and reuse the boot/attach cores
	// below. ---

	/** Boot a library image as a fresh machine. */
	async bootImage(id: string): Promise<void> {
		await readyLibrary();
		const entry = getImage(id);
		if (!entry) return;
		this.#bootImage(await getImageBytes(id), entry.user.displayName, id);
	}

	/** Attach a library disk image to D1: (live, no reboot). */
	async attachDisk(id: string): Promise<void> {
		await readyLibrary();
		const entry = getImage(id);
		if (!entry) return;
		this.#attachDiskBytes(await getImageBytes(id), entry.user.displayName, id);
	}

	/** Attach a library cartridge (cold boots). */
	async attachCartridge(id: string): Promise<void> {
		await readyLibrary();
		const entry = getImage(id);
		if (!entry) return;
		this.#attachCartridgeBytes(
			await getImageBytes(id),
			entry.user.displayName,
			id,
		);
	}

	/** Promote a transient (auto-added) recents item into the curated library. */
	keepRecent(id: string): void {
		const entry = getImage(id);
		if (!entry?.transient) return;
		void keepImage(id).then(() =>
			this.toast(messages.recents.kept(entry.user.displayName)),
		);
	}

	// Drop an item from the recents history. A transient image that's no longer
	// recent and isn't mounted is then orphaned, so it's deleted outright.
	removeFromRecents(id: string): void {
		const entry = getImage(id);
		removeRecent(id);
		if (entry?.transient && !this.#mountsImage(id)) void removeImage(id);
	}

	/**
	 * Wipe all of the user's library uploads (after a confirm); reboots if the
	 * running machine was using one (it falls back to a built-in). Built-ins stay.
	 */
	clearLibrary(): void {
		if (!window.confirm(messages.library.confirmClear)) return;
		const before = this.#resolvedFirmwareIds();
		void nukeLibrary().then(() => {
			this.toast(messages.library.cleared);
			this.#rebootIfFirmwareChanged(before, false);
		});
	}

	/** Reset everything (testing): wipe the library AND all saved settings. */
	nukeEverything(): void {
		if (!window.confirm(messages.reset.confirmEverything)) return;
		const before = this.#resolvedFirmwareIds();
		const prev = this.config.value;
		const hadMedia = this.#mediaMounted();
		clearAllPersisted();
		void nukeLibrary().then(() => {
			this.#setConfigAndRoms(this.#defaultSettings(), NO_ROM_OVERRIDES);
			this.#clearMedia();
			this.#rebootIfFirmwareChanged(
				before,
				!settingsEqual(prev, this.config.value) || hadMedia,
			);
			this.toast(messages.reset.everything);
		});
	}

	/** Drop this tab's overrides, reverting to the last-saved (seed) config + picks. */
	resetTabSettings(): void {
		const before = this.#resolvedFirmwareIds();
		const prev = this.config.value;
		const hadMedia = this.#mediaMounted();
		clearSessionPersisted();
		this.#setConfigAndRoms(
			sanitizeSettings(loadPersisted(CONFIG_KEY), this.#defaultSettings()),
			sanitizeRoms(loadPersisted(ROMS_KEY)),
		);
		this.#clearMedia();
		this.#rebootIfFirmwareChanged(
			before,
			!settingsEqual(prev, this.config.value) || hadMedia,
		);
		this.toast(messages.reset.tab);
	}

	/** Clear all saved settings, reverting to factory config + picks (library kept). */
	resetDefaultSettings(): void {
		const before = this.#resolvedFirmwareIds();
		const prev = this.config.value;
		const hadMedia = this.#mediaMounted();
		clearAllPersisted();
		this.#setConfigAndRoms(this.#defaultSettings(), NO_ROM_OVERRIDES);
		this.#clearMedia();
		this.#rebootIfFirmwareChanged(
			before,
			!settingsEqual(prev, this.config.value) || hadMedia,
		);
		this.toast(messages.reset.defaults);
	}

	// --- reset helpers ------------------------------------------------------

	#defaultSettings(): MachineSettings {
		const model = this.#defaultModel;
		return {
			model,
			memory: model === "400/800" ? 48 : 64,
			portbExtendedRam: null,
			tv: "ntsc",
			basicDisabled: false,
		};
	}

	// Set config + applied/staged ROM picks without persisting (resets clear the
	// store deliberately; a later explicit change re-persists).
	#setConfigAndRoms(config: MachineSettings, roms: RomOverrides): void {
		this.config.value = config;
		this.staged.value = config;
		this.appliedRoms.value = roms;
		this.stagedRoms.value = roms;
	}

	#mediaMounted(): boolean {
		return this.#cartridge !== null || this.#drives.some((d) => d !== null);
	}

	// Unmount everything in memory (the persisted media is cleared separately by
	// the reset's storage wipe). The caller reboots into the now-empty machine.
	#clearMedia(): void {
		this.#cartridge = null;
		this.#drives = [null];
		this.#refreshAttachments();
	}

	#resolvedFirmwareIds(): { os?: string; basic?: string; game?: string } {
		const { os, basic, game } = this.#resolveFirmware();
		return { os: os?.id, basic: basic?.id, game: game?.id };
	}

	// Reboot when the config changed or the firmware the running machine resolves
	// to differs from `before` (so resets only power-cycle when they have to).
	#rebootIfFirmwareChanged(
		before: { os?: string; basic?: string; game?: string },
		configChanged: boolean,
	): void {
		const after = this.#resolvedFirmwareIds();
		if (
			configChanged ||
			before.os !== after.os ||
			before.basic !== after.basic ||
			before.game !== after.game
		) {
			void this.#reboot();
		}
	}

	// Mount an image (disk/cartridge/executable) and power-cycle into it.
	// Booting an image always disables BASIC so it can't intercept the boot; on
	// the 800 the BASIC cart also comes out for a game cartridge anyway (handled
	// by #makeEmulator).
	#bootImage(contents: Uint8Array, name: string, sourceId?: string): void {
		// Content-based detection (no filename hint): the bytes carry their own
		// magic/heuristics, and library images may have no meaningful extension.
		const format = detectFileFormat(contents);

		// An unrecognized/unloadable file changes nothing — just warn.
		const unsupported = unsupportedMessage(format);
		if (unsupported) {
			this.toast(`${name}: ${unsupported}`, "warning");
			return;
		}

		// Boot image starts fresh: fill the one slot it boots from and clear the
		// rest. (Attach, below, instead adds to the running machine in place.)
		let cartridge: { cart: Cartridge; name: string; sourceId?: string } | null =
			null;
		let disk: { disk: AtrImage; name: string; sourceId?: string } | null = null;
		try {
			if (format === "atr") {
				disk = { disk: new AtrImage(contents), name, sourceId };
			} else if (format === "xex") {
				// XEX boots from a generated in-memory disk (its loader). The source
				// id is kept so the boot can be resumed (re-built from the XEX), but
				// saveD1ToLibrary refuses it — its synthetic disk isn't the XEX.
				disk = { disk: buildBootDisk(contents), name, sourceId };
			} else {
				cartridge = { cart: new Cartridge(contents), name, sourceId };
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.toast(`${name}: ${message}`, "error");
			return;
		}

		// Announce the teardown of every boot source it clears, then the boot
		// itself — so the silent multi-action is legible.
		this.#announceBootTeardown();
		this.toast(
			cartridge
				? messages.toasts.bootCartridge(name)
				: format === "xex"
					? messages.toasts.bootExecutable(name)
					: messages.toasts.bootDisk(name),
		);

		this.closePanel(); // get out of the way
		this.#cartridge = cartridge;
		this.#drives = [disk];
		this.config.value = { ...this.config.value, basicDisabled: true };
		this.#refreshAttachments();
		this.#saveMedia();
		this.#noteUsed(sourceId);
		void this.#reboot();
	}

	// Toast each boot source Boot image is about to clear: the cartridge slot
	// (an explicit cart, or BASIC on the 400/800), the D1: disk, and BASIC on
	// XL/XE (on the 400/800 that's the cartridge-slot toast above).
	#announceBootTeardown(): void {
		const { model, basicDisabled } = this.config.value;
		if (this.#cartridge) {
			this.toast(messages.toasts.detachingCartridge(this.#cartridge.name));
		} else if (!hasBuiltinBasic(model) && !basicDisabled) {
			const name =
				this.#pick(preferredBasicKeys())?.user.displayName ?? "BASIC";
			this.toast(messages.toasts.detachingCartridge(name));
		}
		if (this.#drives[0]) {
			this.toast(messages.toasts.detachingDisk(this.#drives[0].name));
		}
		if (hasBuiltinBasic(model) && !basicDisabled) {
			this.toast(messages.toasts.disablingBasic);
		}
	}

	/**
	 * Save the disk mounted in D1: as an `.atr`, including any sectors the
	 * running machine has written this session (writes live only in memory, so
	 * this is how you keep them). Writable disks only — the synthetic XEX boot
	 * disk is write-protected and isn't a real disk worth saving.
	 */
	downloadDisk(): void {
		const drive = this.#drives[0];
		if (!drive || drive.disk.writeProtected) {
			this.toast(messages.errors.noWritableDisk, "warning");
			return;
		}

		// Copy into a fresh ArrayBuffer-backed view: a snapshot the Blob owns,
		// decoupled from later writes to the live image.
		const blob = new Blob([new Uint8Array(drive.disk.toBytes())], {
			type: "application/octet-stream",
		});
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = drive.name;
		anchor.click();
		URL.revokeObjectURL(url);
		this.toast(messages.toasts.saving(drive.name));
	}

	/**
	 * Save the D1: disk back to the library item it was attached from — keeping
	 * any sectors written this session. Only a disk attached from one of your
	 * library uploads can be saved (built-ins are read-only; a file-loaded disk
	 * has no library item — use Download D1: to export those).
	 */
	async saveD1ToLibrary(): Promise<void> {
		const drive = this.#drives[0];
		if (!drive) {
			this.toast(messages.errors.noDiskToSave, "warning");
			return;
		}
		// Only a real disk entry can be overwritten — not a XEX (its D1: is a
		// synthetic boot disk), nor a built-in or since-deleted source.
		const source = drive.sourceId ? getImage(drive.sourceId) : undefined;
		if (
			!source ||
			source.derived.type !== "disk" ||
			!(await updateImage(source.id, drive.disk.toBytes()))
		) {
			this.toast(messages.errors.notLibraryDisk, "warning");
			return;
		}
		this.toast(messages.toasts.savedToLibrary(drive.name));
	}

	/**
	 * Attach an ATR to D1: of the running machine — live, no reboot, BASIC
	 * untouched (unlike Boot image, which power-cycles into the image). The
	 * disk also becomes D1: for the next cold start and is what Download D1:
	 * saves.
	 */
	async attachDiskFile(file: File): Promise<void> {
		const bytes = new Uint8Array(await file.arrayBuffer());
		const id = await addOrFindImage(bytes, file.name, true);
		if (id) await this.attachDisk(id);
		else this.#attachDiskBytes(bytes, file.name);
	}

	// Attach an ATR's bytes to D1: live — shared by the file picker and the
	// library's `attachDisk(id)` (which passes the source entry for saving back).
	#attachDiskBytes(
		contents: Uint8Array,
		name: string,
		sourceId?: string,
	): void {
		let disk: AtrImage;
		try {
			disk = new AtrImage(contents);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.toast(`${name}: ${message}`, "error");
			return;
		}

		this.#drives[0] = { disk, name, sourceId };
		this.#emulator.machine.insertDisk(disk);
		this.closePanel(); // get out of the way
		this.#refreshAttachments();
		this.#saveMedia();
		this.#noteUsed(sourceId);
		this.toast(messages.toasts.attachingDisk(name));
	}

	/** Detach the disk from D1: of the running machine (live, no reboot). */
	detachDisk(): void {
		const drive = this.#drives[0];
		if (!drive) {
			this.toast(messages.errors.noDiskToDetach, "warning");
			return;
		}
		this.#drives[0] = null;
		this.#emulator.machine.ejectDisk();
		this.#refreshAttachments();
		this.#saveMedia();
		this.toast(messages.toasts.detachingDisk(drive.name));
	}

	/**
	 * Attach a cartridge and cold boot into it. Unlike Boot image this leaves
	 * the other media in place (a disk in D1: stays, and the cart's own header
	 * flags then decide whether the disk also boots). It reboots because a
	 * cartridge is memory-mapped and only takes effect at reset; the niche
	 * "stage it without rebooting" can come later.
	 */
	async attachCartridgeFile(file: File): Promise<void> {
		const bytes = new Uint8Array(await file.arrayBuffer());
		const id = await addOrFindImage(bytes, file.name, true);
		if (id) await this.attachCartridge(id);
		else this.#attachCartridgeBytes(bytes, file.name);
	}

	// Attach a cartridge's bytes (cold boots) — shared by the file picker and the
	// library's `attachCartridge(id)`. Content-based detection so canonical `.car`
	// and raw built-in bytes both load without a filename hint.
	#attachCartridgeBytes(
		contents: Uint8Array,
		name: string,
		sourceId?: string,
	): void {
		const format = detectFileFormat(contents);
		const isCartridge =
			format !== null &&
			format !== "atr" &&
			format !== "xex" &&
			unsupportedMessage(format) === null;
		if (!isCartridge) {
			this.toast(`${name}: ${messages.errors.notACartridge}`, "warning");
			return;
		}

		let cart: Cartridge;
		try {
			cart = new Cartridge(contents);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.toast(`${name}: ${message}`, "error");
			return;
		}

		// Announce what's leaving the cart slot (an explicit cart, or BASIC on
		// the 400/800) before the new cart goes in.
		const { model, basicDisabled } = this.config.value;
		if (this.#cartridge) {
			this.toast(messages.toasts.detachingCartridge(this.#cartridge.name));
		} else if (!hasBuiltinBasic(model) && !basicDisabled) {
			const basic =
				this.#pick(preferredBasicKeys())?.user.displayName ?? "BASIC";
			this.toast(messages.toasts.detachingCartridge(basic));
		}
		this.toast(messages.toasts.attachingCartridge(name));

		this.closePanel(); // get out of the way
		this.#cartridge = { cart, name, sourceId };
		this.#refreshAttachments();
		this.#saveMedia();
		this.#noteUsed(sourceId);
		void this.#reboot();
	}

	/**
	 * Clear the cartridge slot and cold boot (other media stays in place). With
	 * an explicit cart in it, detach the cart. Otherwise, only on the 400/800
	 * where an enabled BASIC fills the slot, disable BASIC instead (it reboots
	 * too) — what the user means by "detach." Anything else (XL/XE, or the slot
	 * already empty) has nothing to remove, so it reports that. (A confirmation
	 * step can come later.)
	 */
	detachCartridge(): void {
		if (this.#cartridge) {
			const { name } = this.#cartridge;
			this.#cartridge = null;
			this.#refreshAttachments();
			this.#saveMedia();
			void this.#reboot();
			this.toast(messages.toasts.detachingCartridge(name));
			return;
		}
		const { model, basicDisabled } = this.config.value;
		if (!hasBuiltinBasic(model) && !basicDisabled) {
			this.applyBasicDisabled(true); // toasts "Detaching cartridge (BASIC…)"
			return;
		}
		this.toast(messages.errors.noCartridge, "warning");
	}

	/**
	 * Drive the canvas: present the latest completed frame at the display
	 * refresh rate, and keep it sized to the largest pixel-aspect-correct
	 * rectangle that fits its parent (the rest is black letterbox). Returns
	 * a teardown function.
	 */
	attachScreen(canvas: HTMLCanvasElement): () => void {
		const context = canvas.getContext("2d");
		const stage = canvas.parentElement;
		if (!context || !stage) return () => {};

		// Fit the canvas into its parent, preserving the display aspect — which
		// depends on the TV standard's pixel aspect ratio, so re-fit when the
		// config changes too (the stage size may not).
		const fit = () => {
			const par =
				this.config.value.tv === "pal"
					? PAL_PIXEL_ASPECT_RATIO
					: NTSC_PIXEL_ASPECT_RATIO;
			const displayAspect = (FRAME_BUFFER_WIDTH * par) / FRAME_BUFFER_HEIGHT;
			const boxWidth = stage.clientWidth;
			const boxHeight = stage.clientHeight;
			let width = boxWidth;
			let height = width / displayAspect;
			if (height > boxHeight) {
				height = boxHeight;
				width = height * displayAspect;
			}
			canvas.style.width = `${Math.round(width)}px`;
			canvas.style.height = `${Math.round(height)}px`;
		};
		const resize = new ResizeObserver(fit);
		resize.observe(stage);

		const imageData = context.createImageData(
			FRAME_BUFFER_WIDTH,
			FRAME_BUFFER_HEIGHT,
		);
		const pixels = new Uint32Array(imageData.data.buffer);

		// Both the fit (pixel aspect) and the palette follow the TV standard,
		// so refresh them whenever the config changes (the stage may not).
		let palette = buildNtscPalette();
		const unsubscribe = this.config.subscribe(() => {
			fit();
			palette =
				this.config.value.tv === "pal" ? buildPalPalette() : buildNtscPalette();
		});

		let raf = 0;
		let presented = -1;
		let framesAtSecondStart = this.#emulator.frameCount;
		let secondStart = performance.now();
		const present = () => {
			if (this.#emulator.frameCount !== presented) {
				presented = this.#emulator.frameCount;
				const frame = this.#emulator.frame;
				for (let i = 0; i < frame.length; i++) {
					pixels[i] = palette[frame[i]!]!;
				}
				context.putImageData(imageData, 0, 0);
			}
			this.crashed.value = this.#emulator.crashed; // dedup'd by the signal
			// Sample the emulated frame rate about once a second. Measure the
			// emulator's own frameCount delta over the elapsed wall clock, not
			// how many distinct frames this RAF loop happened to observe — RAF
			// coalesces under main-thread load and would undercount frames the
			// emulator actually produced.
			const now = performance.now();
			const elapsed = now - secondStart;
			const frameCount = this.#emulator.frameCount;
			if (frameCount < framesAtSecondStart) {
				// The emulator was swapped (reboot/config change) and its
				// frameCount reset — rebase the window rather than report a
				// negative delta.
				framesAtSecondStart = frameCount;
				secondStart = now;
			} else if (elapsed >= 1000) {
				const frames = frameCount - framesAtSecondStart;
				this.fps.value = Math.round((frames * 1000) / elapsed);
				framesAtSecondStart = frameCount;
				secondStart = now;
			}
			raf = requestAnimationFrame(present);
		};
		raf = requestAnimationFrame(present);
		return () => {
			cancelAnimationFrame(raf);
			resize.disconnect();
			unsubscribe();
		};
	}

	/**
	 * Wire keystrokes through the offscreen input (so dead-key composition
	 * works) and keep it focused. Returns a teardown function.
	 */
	attachKeyboard(input: HTMLInputElement, root: HTMLElement): () => void {
		this.#keyInput = input;
		this.#keyboard.attach(input);
		input.focus();

		const refocus = (event: PointerEvent) => {
			// Let toolbar buttons and the sidebar (which has its own focusable
			// input) take their own clicks; only steal focus back from clicks on
			// the screen/letterbox so keystrokes return to the emulator.
			if ((event.target as HTMLElement).closest("button, aside")) return;
			event.preventDefault();
			input.focus();
		};
		const releaseAll = () => this.#keyboard.releaseAll();
		root.addEventListener("pointerdown", refocus);
		window.addEventListener("blur", releaseAll);
		return () => {
			root.removeEventListener("pointerdown", refocus);
			window.removeEventListener("blur", releaseAll);
		};
	}

	/**
	 * Resume the audio context on the first user gesture anywhere. iOS Safari
	 * only unlocks audio on a *completed* gesture (pointerup/touchend/click),
	 * not pointerdown — so listen on pointerup and keydown.
	 */
	enableAudioResume(): () => void {
		const audio = this.#audio;
		if (!audio) return () => {};
		const resume = () => audio.resume();
		window.addEventListener("pointerup", resume);
		window.addEventListener("keydown", resume);
		return () => {
			window.removeEventListener("pointerup", resume);
			window.removeEventListener("keydown", resume);
		};
	}
}
