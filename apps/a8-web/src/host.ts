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
import type { FirmwareLibraryEntry } from "virtual:firmware-library";
import type { AudioOutput } from "./audio.ts";
import { commands, type Command } from "./commands.ts";
import { Emulator } from "./emulator.ts";
import { Keyboard } from "./keyboard.ts";
import {
	loadImageBytes,
	loadLibraryEntry,
	type LibraryEntry,
} from "./library.ts";
import {
	clampRam,
	hasBuiltinBasic,
	MODEL_LABELS,
	ramConfig,
	settingsEqual,
	type MachineSettings,
} from "./machine-config.ts";
import { currentPath, navigate } from "./navigate.ts";
import { messages } from "./messages.ts";

export interface HostConfig {
	model: AtariModel;
	/**
	 * The firmware library manifest. The host ranks/picks OS + BASIC from this
	 * metadata and fetches only the chosen ROM's bytes, on demand.
	 */
	firmware: FirmwareLibraryEntry[];
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
export type SidebarPanel = "menu" | "palette";

export type { MachineSettings } from "./machine-config.ts";

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

	// Firmware manifest, indexed by key for ranked selection (metadata only).
	readonly #firmware: Map<FirmwareKey, FirmwareLibraryEntry>;
	// Fetched ROM bytes, keyed by asset URL — populated lazily before each
	// (re)build so #makeEmulator can read them synchronously.
	readonly #bytes = new Map<string, Uint8Array>();
	readonly #audio: AudioOutput | null;
	readonly #audioError: string | null;
	readonly #keyboard: Keyboard;

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
	#cartridge: { cart: Cartridge; name: string } | null = null;
	#drives: ({ disk: AtrImage; name: string } | null)[] = [null];

	/**
	 * Build a host and boot its first emulator. Async because the initial OS +
	 * BASIC bytes are fetched here (the constructor stays synchronous and the
	 * emulator can't be built until they're cached).
	 */
	static async create(config: HostConfig): Promise<EmulatorHost> {
		const host = new EmulatorHost(config);
		await host.#ensureFirmware();
		host.#emulator = host.#makeEmulator();
		host.#wireLeds();
		return host;
	}

	constructor({ model, firmware, audio, audioError }: HostConfig) {
		// Index the firmware images by key (non-firmware library entries are
		// ignored). The manifest is already deduped — one entry per key.
		this.#firmware = new Map(
			firmware
				.filter(
					(e): e is FirmwareLibraryEntry & { firmwareKey: FirmwareKey } =>
						e.firmwareKey !== null,
				)
				.map((e) => [e.firmwareKey, e]),
		);
		this.#audio = audio;
		this.#audioError = audioError ?? null;
		this.config.value = {
			model,
			memory: model === "400/800" ? 48 : 64,
			portbExtendedRam: null,
			tv: "ntsc",
			basicDisabled: false,
		};
		this.staged.value = this.config.peek();

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
				? (this.#pick(preferredBasicKeys())?.name ?? null)
				: null;
		this.attachments.value = {
			cartridge: this.#cartridge?.name ?? basic,
			drives: this.#drives.map((drive) => drive?.name ?? null),
		};
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

	// The best-ranked firmware present in the library for a list of keys.
	#pick(keys: readonly FirmwareKey[]): FirmwareLibraryEntry | null {
		for (const key of keys) {
			const entry = this.#firmware.get(key);
			if (entry) return entry;
		}
		return null;
	}

	// The OS + BASIC the running config wants, picked from the manifest by rank.
	// BASIC is omitted when the machine doesn't wire it in (the 400/800 with the
	// cartridge slot taken; the XL/XE "disable" is the OPTION-hold at boot).
	#resolveFirmware(): {
		os: FirmwareLibraryEntry | null;
		basic: FirmwareLibraryEntry | null;
		game: FirmwareLibraryEntry | null;
	} {
		const { model, tv, basicDisabled } = this.config.value;
		// Built-in BASIC (xl/xe, xegs) is always loaded — its "disable" is the
		// OPTION-hold. Cart BASIC (400/800, 1200xl) loads only when it takes the
		// slot: enabled and no cartridge mounted.
		const needBasic =
			hasBuiltinBasic(model) || (!basicDisabled && this.#cartridge === null);
		return {
			os: this.#pick(preferredOsKeys({ model, tv })),
			basic: needBasic ? this.#pick(preferredBasicKeys()) : null,
			game: model === "xegs" ? this.#pickGame() : null,
		};
	}

	// The XEGS built-in game — any game-type firmware in the library.
	#pickGame(): FirmwareLibraryEntry | null {
		for (const entry of this.#firmware.values()) {
			if (entry.firmwareType === "game") return entry;
		}
		return null;
	}

	// Fetch (and cache) the bytes the running config's OS + BASIC need, so the
	// next #makeEmulator can read them synchronously. Already-cached ROMs (the
	// common reboot case) resolve immediately.
	async #ensureFirmware(): Promise<void> {
		const { os, basic, game } = this.#resolveFirmware();
		await Promise.all(
			[os, basic, game]
				.filter((e): e is FirmwareLibraryEntry => e !== null)
				.filter((e) => !this.#bytes.has(e.url))
				.map(async (e) => {
					this.#bytes.set(e.url, await loadImageBytes(e.url, e.name));
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
		const osBytes = this.#bytes.get(os.url);
		const basicBytes = basic ? this.#bytes.get(basic.url) : undefined;
		const gameBytes = game ? this.#bytes.get(game.url) : undefined;
		if (!osBytes) {
			throw new Error(`firmware bytes missing for "${os.name}"`);
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
			`Firmware for ${model} ${tv.toUpperCase()}: OS "${os.name}"` +
				(basic ? `, BASIC "${basic.name}"` : ", no BASIC"),
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
			const name = this.#pick(preferredBasicKeys())?.name ?? "BASIC";
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
		this.#announceConfigChange(prev, next);
		void this.#reboot();
	}

	applyModel(model: AtariModel): void {
		this.#applyConfigChange({ model, ...clampRam(model, this.config.value) });
	}

	applyRam(totalKB: number): void {
		this.#applyConfigChange(ramConfig(totalKB));
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

	/** Boot a user-supplied file (the "Boot image…" picker / drag-and-drop). */
	async loadFile(file: File): Promise<void> {
		this.#bootImage(new Uint8Array(await file.arrayBuffer()), file.name);
	}

	/** Boot a software item from the built-in library. */
	async bootLibraryEntry(entry: LibraryEntry): Promise<void> {
		this.#bootImage(await loadLibraryEntry(entry), entry.fileName);
	}

	// Mount an image (disk/cartridge/executable) and power-cycle into it.
	// Booting an image always disables BASIC so it can't intercept the boot; on
	// the 800 the BASIC cart also comes out for a game cartridge anyway (handled
	// by #makeEmulator).
	#bootImage(contents: Uint8Array, name: string): void {
		const format = detectFileFormat(contents, name);

		// An unrecognized/unloadable file changes nothing — just warn.
		const unsupported = unsupportedMessage(format);
		if (unsupported) {
			this.toast(`${name}: ${unsupported}`, "warning");
			return;
		}

		// Boot image starts fresh: fill the one slot it boots from and clear the
		// rest. (Attach, below, instead adds to the running machine in place.)
		let cartridge: { cart: Cartridge; name: string } | null = null;
		let disk: { disk: AtrImage; name: string } | null = null;
		try {
			if (format === "atr") {
				disk = { disk: new AtrImage(contents), name };
			} else if (format === "xex") {
				// XEX boots from a generated in-memory disk (its loader).
				disk = { disk: buildBootDisk(contents), name };
			} else {
				cartridge = { cart: new Cartridge(contents, name), name };
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
			const name = this.#pick(preferredBasicKeys())?.name ?? "BASIC";
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
	 * Attach an ATR to D1: of the running machine — live, no reboot, BASIC
	 * untouched (unlike Boot image, which power-cycles into the image). The
	 * disk also becomes D1: for the next cold start and is what Download D1:
	 * saves.
	 */
	async attachDiskFile(file: File): Promise<void> {
		const contents = new Uint8Array(await file.arrayBuffer());
		let disk: AtrImage;
		try {
			disk = new AtrImage(contents);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.toast(`${file.name}: ${message}`, "error");
			return;
		}

		this.#drives[0] = { disk, name: file.name };
		this.#emulator.machine.insertDisk(disk);
		this.closePanel(); // get out of the way
		this.#refreshAttachments();
		this.toast(messages.toasts.attachingDisk(file.name));
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
		const contents = new Uint8Array(await file.arrayBuffer());
		const format = detectFileFormat(contents, file.name);
		const isCartridge =
			format !== null &&
			format !== "atr" &&
			format !== "xex" &&
			unsupportedMessage(format) === null;
		if (!isCartridge) {
			this.toast(`${file.name}: ${messages.errors.notACartridge}`, "warning");
			return;
		}

		let cart: Cartridge;
		try {
			cart = new Cartridge(contents, file.name);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.toast(`${file.name}: ${message}`, "error");
			return;
		}

		// Announce what's leaving the cart slot (an explicit cart, or BASIC on
		// the 400/800) before the new cart goes in.
		const { model, basicDisabled } = this.config.value;
		if (this.#cartridge) {
			this.toast(messages.toasts.detachingCartridge(this.#cartridge.name));
		} else if (!hasBuiltinBasic(model) && !basicDisabled) {
			const basic = this.#pick(preferredBasicKeys())?.name ?? "BASIC";
			this.toast(messages.toasts.detachingCartridge(basic));
		}
		this.toast(messages.toasts.attachingCartridge(file.name));

		this.closePanel(); // get out of the way
		this.#cartridge = { cart, name: file.name };
		this.#refreshAttachments();
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
