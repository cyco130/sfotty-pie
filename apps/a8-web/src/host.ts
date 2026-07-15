import {
	AtrImage,
	buildBootDisk,
	buildNtscPalette,
	buildPalPalette,
	CART_TYPES,
	createCartridge,
	DiskDrive,
	isCartTypeSupported,
	type Cartridge,
	detectFileFormat,
	FRAME_BUFFER_HEIGHT,
	FRAME_BUFFER_WIDTH,
	NTSC_PIXEL_ASPECT_RATIO,
	PAL_PIXEL_ASPECT_RATIO,
	KEYBOARD_LINES,
	preferredBasicKeys,
	preferredOsKeys,
	type AtariFileFormat,
	type AtariModel,
	type FirmwareKey,
	type OutputGamut,
} from "@sfotty-pie/a8";
import { computed, signal } from "@preact/signals";
import type { AudioOutput } from "./audio.ts";
import { commands, type Command, releaseOf } from "./commands.ts";
import {
	type DisplaySettings,
	type OverscanSettings,
	overscanCrop,
	type PaletteSettings,
	sanitizeOverscan,
	sanitizePalette,
	sanitizeFrameBlending,
} from "./display-settings.ts";
import {
	loadDisplaySettings,
	saveDisplaySettings,
} from "./display-settings-store.ts";
import type { Binding, KeyboardMode } from "./key-bindings.ts";
import { Emulator } from "./emulator.ts";
import { Gamepads, type PadInfo } from "./gamepad.ts";
import {
	type GamepadBindings,
	defaultGamepadBindings,
	loadGamepadBindings,
	saveGamepadBindings,
} from "./gamepad-bindings-store.ts";
import type { NormalizeProfile } from "./gamepad-normalize.ts";
import {
	loadNormalizeProfiles,
	type NormalizeProfiles,
	saveNormalizeProfiles,
} from "./gamepad-normalize-store.ts";
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
	updateUserMeta,
} from "./images/library.ts";
import type { ImageEntry } from "./images/metadata.ts";
import {
	ensureStoredLayout,
	freshBindings,
	loadLayoutPref,
	loadStoredBindings,
	saveBindings,
	saveLayoutPref,
} from "./key-bindings-store.ts";
import { GLYPH_TO_ATASCII } from "./keyboard-docs.ts";
import { Keyboard } from "./keyboard.ts";
import {
	clampRam,
	hasBuiltinBasic,
	MODEL_LABELS,
	ramConfig,
	sanitizeSettings,
	settingsEqual,
	type MachineSettings,
	type TvAdapter,
	type TvStandard,
} from "./machine-config.ts";
import { currentPath, navigate } from "./navigate.ts";
import { messages } from "./messages.ts";
import { isMac } from "./platform.ts";
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

/** A mounted drive slot: the disk, its display name, the library entry it
 *  came from (if any), and whether the drive is on (attached to the bus;
 *  off = parked, the disk is kept but the bus hears nothing). `synthetic`
 *  marks a generated boot disk (an XEX's loader) - not real media, so its
 *  write-protection can't be lifted. */
interface DriveSlot {
	disk: AtrImage;
	name: string;
	sourceId?: string;
	on: boolean;
	synthetic?: boolean;
}

/** The fixed drive bank size (D1:-D8:, the SIO device-ID range). */
export const DRIVE_COUNT = 8;

function emptyDrives<T>(): (T | null)[] {
	return Array.from({ length: DRIVE_COUNT }, () => null);
}

/** A mounted drive as the devices view sees it (see {@link EmulatorHost.driveBank}). */
export interface DriveBankEntry {
	name: string;
	/** The library entry the disk came from - its details-page link; null
	 *  for an id-less mount. */
	sourceId: string | null;
	/** Attached to the bus; off = parked (the disk is kept). */
	on: boolean;
	writeProtected: boolean;
	/** Unsaved in-session writes (the disk's dirty flag). */
	modified: boolean;
	/** The ATR density tag: SD (128b/720), ED (128b/1040), DD (256b). */
	density: "SD" | "ED" | "DD";
}

function density(disk: AtrImage): DriveBankEntry["density"] {
	if (disk.sectorSize === 256) return "DD";
	return disk.sectorCount > 720 ? "ED" : "SD";
}

// The write-protect notch persisted on the library entry (a property of the
// medium). Protected is the DEFAULT - a disk writes only after a deliberate
// un-protect on its library page. An id-less mount has no entry (and thus no
// page to un-protect it from), so it alone starts writable.
function imageWriteProtected(sourceId: string | undefined): boolean {
	return sourceId ? (getImage(sourceId)?.user.writeProtected ?? true) : false;
}

/**
 * The sidebar's content when open. Stable string ids so the state stays
 * serializable (a future deep-link layer can map these straight to the URL).
 */
export type SidebarPanel =
	| "menu"
	| "config"
	| "display"
	| "palette"
	| "keys"
	| "devices"
	| "controllers"
	| "roms"
	| "library";

export type { MachineSettings } from "./machine-config.ts";

/**
 * In-memory firmware overrides; an explicit pick beats the ranking. Values are
 * library image ids - a built-in's firmware key, or a user upload's UUID.
 */
export interface RomOverrides {
	os: Partial<Record<OsSlot, string>>;
	basic: string | null;
	game: string | null;
}

const NO_ROM_OVERRIDES: RomOverrides = { os: {}, basic: null, game: null };

/**
 * Owns the emulator's imperative lifetime - the live {@link Emulator}
 * instance (swapped on Load), the real-time present loop, audio, and the
 * keyboard - so the Preact chrome stays a thin view. Reactive UI state is
 * exposed as signals; the canvas and keystroke loops are wired up via the
 * `attach*` methods (called from the component's mount effect) and never
 * touch Preact's render path.
 */
export class EmulatorHost {
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
		this.keyboardMode.value =
			loadPersisted(KBMODE_KEY) === "positional" ? "positional" : "character";
		this.realisticScan.value = loadPersisted(REALISTIC_SCAN_KEY) === "on";
		this.sioTrap.value = loadPersisted(SIO_TRAP_KEY) !== "off";
		this.sioAcceleration.value = loadPersisted(SIO_ACCEL_KEY) !== "off";
		this.diskSpeed.value = parseDiskSpeed(loadPersisted(DISK_SPEED_KEY));
		this.pasteChMode.value = loadPersisted(PASTE_MODE_KEY) === "ch";
		this.osdForced.value = loadPersisted(OSD_KEY) === "on";
		if (audio) audio.muted = loadPersisted(MUTED_KEY) === "on";

		// Key bindings: this tab's stored flat set, or empty until create()
		// generates and persists the platform defaults (first run / cleared store).
		const storedBindings = loadStoredBindings();
		this.#bindingsStored = storedBindings !== undefined;
		this.keyBindings.value = storedBindings ?? [];
		// #emulator is built by create() once the initial firmware is fetched.
		this.#keyboard = new Keyboard(
			{
				press: (command) => this.press(command),
				release: (command) => this.release(command),
				tap: (command) => this.dispatch(command),
				releaseMatrix: () => this.releaseMatrix(),
			},
			() => this.keyboardMode.value,
			storedBindings ?? [],
		);

		// The gamepad poller drives the joystick commands the same way; the
		// emulator loop calls its poll() once per frame (wired in #makeEmulator).
		this.#gamepads = new Gamepads({
			press: (command) => this.press(command),
			release: (command) => this.release(command),
		});
		// Mirror the pad set / port assignment into a signal for the panel.
		this.#gamepads.onChange = () => {
			this.gamepads.value = this.#gamepads.pads();
		};
		// Surface connect/disconnect as notices, with the assigned port.
		this.#gamepads.onConnect = (name, port) => {
			this.toast(messages.toasts.controllerConnected(name, port));
		};
		this.#gamepads.onDisconnect = (name) => {
			this.toast(messages.toasts.controllerDisconnected(name));
		};
		// Apply the persisted (or default) bindings and the persisted
		// per-device normalization profiles to the poller.
		const gb = this.gamepadBindings.peek();
		this.#gamepads.setBindings(gb.joystick, gb.console);
		this.#gamepads.setProfiles(this.gamepadNormalize.peek());

		// The audio context resumes/suspends asynchronously; track it.
		if (audio) {
			audio.context.addEventListener("statechange", () =>
				this.#refreshAudioState(),
			);
			this.#refreshAudioState();
		}

		// Keep the status-bar attachment labels in sync with the config - the
		// 400/800 BASIC slot depends on the model and whether BASIC is enabled.
		// (Runs immediately, seeding the initial labels.)
		this.config.subscribe(() => this.#refreshAttachments());
	}

	/**
	 * Build a host and boot its first emulator. Async because the initial OS +
	 * BASIC bytes are fetched here (the constructor stays synchronous and the
	 * emulator can't be built until they're cached).
	 */
	static async create(config: HostConfig): Promise<EmulatorHost> {
		const host = new EmulatorHost(config);
		await host.#ensureFirmware();
		await host.#restoreMedia();
		// First run (or a cleared store): generate + persist the default bindings
		// from the layout snapshot. Otherwise load the stored snapshot (only used to
		// label the editor's live preview now - existing chords carry baked labels).
		// The keyboard isn't attached until the UI mounts, so the brief empty-binding
		// window is never live.
		if (!host.#bindingsStored) {
			const { bindings, layout } = await freshBindings(host.#isMac);
			host.#applyBindings(bindings);
			host.layoutLabels.value = layout;
		} else {
			host.layoutLabels.value = await ensureStoredLayout();
		}
		host.#emulator = host.#makeEmulator();
		host.#wireLeds();
		return host;
	}

	/**
	 * What's attached, for the status bar: the cartridge-slot label (a cart
	 * name, or "BASIC" when it occupies the 400/800 cart slot, or null) and a
	 * per-drive disk name (index 0 = D1:; null = empty).
	 */
	readonly attachments = signal<{
		cartridge: string | null;
		drives: (string | null)[];
	}>({ cartridge: null, drives: [null] });

	/** The drive bank for the devices view (index 0 = D1:; null = empty):
	 *  each mounted slot's name, power, write-protect, and ATR density. */
	readonly driveBank = signal<(DriveBankEntry | null)[]>(emptyDrives());

	/** The cartridge slot for the devices view: the mounted cart (its
	 *  library link), or BASIC when it occupies the 400/800 slot
	 *  (sourceId null - eject then means "disable BASIC"), or null. */
	readonly cartSlot = signal<{ name: string; sourceId: string | null } | null>(
		null,
	);

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
		tvAdapter: "gtia",
		basicDisabled: false,
	});

	/** The menu's working copy - applied (with a reboot) on demand. */
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

	/** Keyboard interpretation: Character (layout-aware typing) vs Positional
	 *  (raw, by physical key). Persisted; loaded in the constructor. */
	readonly keyboardMode = signal<KeyboardMode>("character");

	/** Whether the (XEGS-style detachable) keyboard is plugged in. Applied
	 *  to every machine; on an XEGS config the presence sense shows on
	 *  TRIG2. */
	readonly keyboardAttached = signal(true);

	/** Raw hardware key scanning. Off (the default) = a new key press lifts
	 *  the previous keys first, so fast rollover typing never trips the
	 *  matrix's two-keys-held debounce block. The 15KHz scan itself runs
	 *  either way; the mode only limits what the matrix holds. */
	readonly realisticScan = signal(false);

	/** Whether the SIOV trap serves OS disk calls instantly (high-level
	 *  emulation); off = everything runs over the emulated serial wire.
	 *  Persisted; applied live and re-applied on a rebuild. */
	readonly sioTrap = signal(true);

	/** Serial I/O acceleration: SIO transfers paced by the program's own
	 *  reads instead of the baud rate. Persisted; applied live. */
	readonly sioAcceleration = signal(true);

	/** The disk drive's advertised high-speed divisor (the $3F answer);
	 *  undefined = a stock drive. Programs re-detect at their next boot.
	 *  Persisted; applied live. */
	readonly diskSpeed = signal<number | undefined>(6);

	/** The active key bindings (one flat set); mirrors what the keyboard resolves,
	 *  for surfaces that show shortcuts (the palette). Updated via #applyBindings. */
	readonly keyBindings = signal<Binding[]>([]);

	/** Connected gamepads and their Atari-port assignments, for the controllers
	 *  panel. Mirrored from the poller on connect/disconnect/reassign. */
	readonly gamepads = signal<PadInfo[]>([]);

	/** The gamepad binding set (joystick + console layers) the editor edits; the
	 *  device-independent layer, persisted via the gamepad-bindings store. */
	readonly gamepadBindings = signal<GamepadBindings>(loadGamepadBindings());

	/** Per-device normalization profiles by gamepad id - the device-dependent
	 *  layer ahead of the bindings, persisted via the gamepad-normalize store.
	 *  Capture/monitor surfaces read pads through these (see normalize()). */
	readonly gamepadNormalize = signal<NormalizeProfiles>(
		loadNormalizeProfiles(),
	);

	/** Per-TV-standard display settings (overscan, palette, frame blending);
	 *  the running config's standard selects the effective one. Persisted. */
	readonly displaySettings = signal<DisplaySettings>(loadDisplaySettings());

	/** The color space the screen canvas actually got (attachScreen detects
	 *  wide gamut); surfaces that preview colors (the display panel's guide)
	 *  generate in the same space so they match the machine exactly. */
	readonly outputGamut = signal<OutputGamut>("srgb");

	/** Whether the game picker overlay is open (see favorites-menu.tsx). */
	readonly favoritesOpen = signal(false);
	// Whether the machine was running when the picker opened (resume on close).
	#favoritesWasRunning = false;

	/** The layout snapshot the bindings were baked from (`code` -> legend), used to
	 *  label the editor's live preview - existing chords carry their own baked
	 *  labels. Persisted, so stable across refresh; refreshed on reset. */
	readonly layoutLabels = signal<Map<string, string>>(new Map());

	/** The keyboard-layout preference: "auto" (getLayoutMap) or a KEYBOARD_LAYOUTS
	 *  id (the manual picker). Drives the setup page's selection. */
	readonly layoutPref = signal<string>(loadLayoutPref());

	/** The 1200XL keyboard LEDs `[L1, L2]` (true = lit), or null on other models. */
	readonly leds = signal<readonly [boolean, boolean] | null>(null);

	/**
	 * Which sidebar panel is showing, or null when closed. The sidebar is a
	 * single docked surface that hosts the menu, the command palette, and (in
	 * future) other dialogs - one at a time, always pushing the screen aside
	 * rather than covering it.
	 */
	readonly sidebar = signal<SidebarPanel | null>(null);

	/**
	 * Show the on-screen controls even without a touch pointer (the OSD shows
	 * itself on coarse-pointer devices regardless). Persisted; toggled by
	 * the OSD_TOGGLE command - handy for the paste editor and for exercising
	 * the touch UI on desktop.
	 */
	readonly osdForced = signal(false);

	toggleOsd(): void {
		this.osdForced.value = !this.osdForced.value;
		savePersisted(OSD_KEY, this.osdForced.value ? "on" : "off");
	}

	// The firmware picks per slot, persisted. appliedRoms is what the running
	// machine uses (an explicit pick, or the rank-resolved one #ensurePins pins in
	// so it stays put across library changes); stagedRoms is the ROMs panel's
	// working copy. applyRoms adopts it, rebooting only when the picks change the
	// running machine.
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

	/**
	 * Activate a command from a momentary trigger (the palette, a click) - no
	 * release event follows, so a control auto-releases after a short pulse;
	 * app verbs (no release half) just run.
	 */
	dispatch(command: Command): void {
		this.press(command);
		const release = releaseOf(command);
		if (release) {
			// Frame-paced so the pulse is two emulated frames even under turbo.
			this.#emulator.afterFrames(PULSE_FRAMES, () =>
				release(this.#commandContext()),
			);
		}
	}

	/** Press a command (a sustained trigger's key-down). */
	press(command: Command): void {
		commands[command].run(this.#commandContext());
	}

	/** Release a command (a sustained trigger's key-up); a no-op if press-only. */
	release(command: Command): void {
		releaseOf(command)?.(this.#commandContext());
	}

	// Composed-key synthesis. Command key codes carry Shift/Ctrl bits
	// (KBCODE-style, bit 6/7); the machine's keyboard is a physical matrix
	// where Shift and Control are LINES. The host holds the composed keys
	// and drives the meta lines with the union of the held keys' bits plus
	// the standalone SHIFT command - so overlapping shifted presses and a
	// held Shift key can't release each other's line early. (Exception:
	// in Character mode held composed keys own the SHIFT line - see
	// #syncMetaLines.)
	#heldComposed = new Map<number, number>(); // scan code -> composed code
	#shiftCommandHeld = false;

	/** Press a composed key code (scan code + Shift/Ctrl bits). */
	matrixKeyDown(code: number): void {
		const scan = code & 0x3f;
		const keyboard = this.#emulator.machine.keyboard;
		// Forgiving mode (the default - and always in Character mode, where
		// the character channel composes keystrokes itself and realistic
		// two-keys-held blocking would garble fast typing): lift the
		// previous keys first, so a fast-typed overlap never trips the
		// matrix's debounce block. The scan itself stays real - the matrix
		// just only ever holds the newest key.
		if (!this.realisticScan.value || this.keyboardMode.value === "character") {
			for (const held of this.#heldComposed.keys()) {
				if (held === scan) continue;
				keyboard.releaseKey(held);
				this.#heldComposed.delete(held);
			}
		}
		this.#heldComposed.set(scan, code);
		this.#syncMetaLines(); // lines first, so KBCODE composes the bits
		keyboard.pressKey(scan);
	}

	/** Release a composed key code. */
	matrixKeyUp(code: number): void {
		this.#heldComposed.delete(code & 0x3f);
		this.#emulator.machine.keyboard.releaseKey(code & 0x3f);
		this.#syncMetaLines();
	}

	/** The standalone Shift key (its own bindable command). */
	setShiftKey(held: boolean): void {
		this.#shiftCommandHeld = held;
		this.#syncMetaLines();
	}

	/** The Break key (its own bindable command). A KR2 meta line like Shift:
	 *  only the down edge raises the IRQ, but the held LEVEL is part of the
	 *  matrix (phantom chains, two-meta-key contention), so it tracks the
	 *  host key rather than pulsing. */
	setBreakKey(held: boolean): void {
		const keyboard = this.#emulator.machine.keyboard;
		if (held) keyboard.pressMetaKey(KEYBOARD_LINES.BREAK);
		else keyboard.releaseMetaKey(KEYBOARD_LINES.BREAK);
	}

	#syncMetaLines(): void {
		const keyboard = this.#emulator.machine.keyboard;
		let bits = 0;
		for (const code of this.#heldComposed.values()) bits |= code;
		// In Character mode a held composed key owns the SHIFT line: the
		// produced character already carries the Shift it wants, and the
		// physical Shift key (the standalone SHIFT command) must not leak
		// in - on a layout where Shift+8 types "*", the held Shift would
		// otherwise scan the asterisk key as Shift+asterisk, which is "^".
		// With the matrix idle (or in Positional mode) the standalone
		// Shift drives the line as a plain held key, so games that sense
		// Shift keep working.
		const composedOwnsShift =
			this.keyboardMode.value === "character" && this.#heldComposed.size > 0;
		if ((this.#shiftCommandHeld && !composedOwnsShift) || bits & 0x40) {
			keyboard.pressMetaKey(KEYBOARD_LINES.SHIFT);
		} else {
			keyboard.releaseMetaKey(KEYBOARD_LINES.SHIFT);
		}
		if (bits & 0x80) keyboard.pressMetaKey(KEYBOARD_LINES.CONTROL);
		else keyboard.releaseMetaKey(KEYBOARD_LINES.CONTROL);
	}

	/**
	 * Release every held matrix key (not the standalone Shift). The
	 * keyboard/OSD call this when the last held matrix key goes up.
	 */
	releaseMatrix(): void {
		const keyboard = this.#emulator.machine.keyboard;
		for (const scan of this.#heldComposed.keys()) {
			keyboard.releaseKey(scan);
		}
		this.#heldComposed.clear();
		this.#syncMetaLines();
	}

	/**
	 * Set joystick 0 to an absolute direction - for the analog OSD stick,
	 * which (unlike the keyboard's per-direction press/release) reports a
	 * whole position at once. `mask` bits: 1 = up, 2 = down, 4 = left,
	 * 8 = right; 0 = centred.
	 */
	setJoystickDirection(mask: number): void {
		this.#emulator.joysticks[0]!.direction = mask;
	}

	/** Assign a connected gamepad (by its `gamepad.index`) to an Atari port (0-3)
	 *  or `null` for off - the controllers panel's port selector. */
	setGamepadPort(index: number, port: number | null): void {
		this.#gamepads.setPort(index, port);
	}

	/** Replace the gamepad bindings - apply them live, persist, and mirror onto the
	 *  signal the editor reads. */
	setGamepadBindings(bindings: GamepadBindings): void {
		this.gamepadBindings.value = bindings;
		this.#gamepads.setBindings(bindings.joystick, bindings.console);
		saveGamepadBindings(bindings);
	}

	/** Restore the default gamepad bindings. */
	resetGamepadBindings(): void {
		this.setGamepadBindings(defaultGamepadBindings());
	}

	/** Set one standard's overscan (sanitized) - applies live via the screen's
	 *  subscription, persists (the settings page / dev console's path). */
	setOverscan(tv: TvStandard, overscan: OverscanSettings): void {
		const current = this.displaySettings.peek();
		const next: DisplaySettings = {
			...current,
			[tv]: { ...current[tv], overscan: sanitizeOverscan(overscan) },
		};
		this.displaySettings.value = next;
		saveDisplaySettings(next);
	}

	/** Set one standard's frame blending (sanitized). Applies live via
	 *  the screen's subscription, persists. */
	setFrameBlending(tv: TvStandard, frameBlending: number): void {
		const current = this.displaySettings.peek();
		const next: DisplaySettings = {
			...current,
			[tv]: {
				...current[tv],
				frameBlending: sanitizeFrameBlending(frameBlending),
			},
		};
		this.displaySettings.value = next;
		saveDisplaySettings(next);
	}

	/** Set one standard's palette generation parameters (sanitized; partial -
	 *  unmentioned parameters keep their value). Applies live, persists. */
	setPalette(tv: TvStandard, palette: Partial<PaletteSettings>): void {
		const current = this.displaySettings.peek();
		const next: DisplaySettings = {
			...current,
			[tv]: {
				...current[tv],
				palette: sanitizePalette({ ...current[tv].palette, ...palette }),
			},
		};
		this.displaySettings.value = next;
		saveDisplaySettings(next);
	}

	/** Open the game picker (see favorites-menu.tsx): pause the machine and
	 *  suspend pad -> command polling - the picker reads the pad itself. */
	openFavorites(): void {
		if (this.favoritesOpen.value) return;
		this.#favoritesWasRunning = this.running.value;
		if (this.running.value) this.pause();
		this.#gamepads.suspend(true);
		this.favoritesOpen.value = true;
	}

	/** Close the picker. With a boot target, boot it (and make sure the fresh
	 *  machine runs); without one, resume whatever was running before. */
	closeFavorites(bootId?: string): void {
		if (!this.favoritesOpen.value) return;
		this.favoritesOpen.value = false;
		this.#gamepads.suspend(false);
		if (bootId !== undefined) {
			void this.bootImage(bootId).then(() => {
				if (!this.running.value) this.resume();
			});
		} else if (this.#favoritesWasRunning) {
			this.resume();
		}
	}

	/** Set or clear (null) a device's normalization profile - apply it live,
	 *  persist, and mirror onto the signal (the calibration flow's save path). */
	setGamepadProfile(id: string, profile: NormalizeProfile | null): void {
		const next = { ...this.gamepadNormalize.peek() };
		if (profile) next[id] = profile;
		else delete next[id];
		this.gamepadNormalize.value = next;
		this.#gamepads.setProfiles(next);
		saveNormalizeProfiles(next);
	}

	/** The live emulator (swaps on reboot) - for the dev console. */
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

	/** Switch the keyboard interpretation (Character vs Positional). Persisted;
	 *  takes effect on the next keystroke once the keyboard reads the binding set. */
	setKeyboardMode(mode: KeyboardMode): void {
		this.keyboardMode.value = mode;
		savePersisted(KBMODE_KEY, mode);
		this.toast(messages.toasts.keyboardMode(mode));
	}

	toggleKeyboardMode(): void {
		this.setKeyboardMode(
			this.keyboardMode.value === "character" ? "positional" : "character",
		);
	}

	/** Switch between realistic key scanning and the forgiving default (see
	 *  {@link realisticScan}). Persisted. */
	setRealisticScan(enabled: boolean): void {
		this.realisticScan.value = enabled;
		savePersisted(REALISTIC_SCAN_KEY, enabled ? "on" : "off");
		this.toast(messages.toasts.realisticScan(enabled));
	}

	toggleRealisticScan(): void {
		this.setRealisticScan(!this.realisticScan.value);
	}

	/** Turn the SIOV trap on or off (see {@link sioTrap}). Persisted. */
	setSioTrap(enabled: boolean): void {
		this.sioTrap.value = enabled;
		savePersisted(SIO_TRAP_KEY, enabled ? "on" : "off");
		this.#emulator.machine.sioTrapEnabled = enabled;
		this.toast(messages.toasts.sioTrap(enabled));
	}

	toggleSioTrap(): void {
		this.setSioTrap(!this.sioTrap.value);
	}

	/** Turn serial I/O acceleration on or off (see
	 *  {@link sioAcceleration}). Persisted. */
	setSioAcceleration(enabled: boolean): void {
		this.sioAcceleration.value = enabled;
		savePersisted(SIO_ACCEL_KEY, enabled ? "on" : "off");
		this.#emulator.machine.sioAcceleration = enabled;
		this.toast(messages.toasts.sioAcceleration(enabled));
	}

	toggleSioAcceleration(): void {
		this.setSioAcceleration(!this.sioAcceleration.value);
	}

	/** Set the drive's advertised SIO speed (see {@link diskSpeed}).
	 *  Persisted; programs pick it up on their next detection pass. */
	setDiskSpeed(index: number | undefined): void {
		this.diskSpeed.value = index;
		savePersisted(
			DISK_SPEED_KEY,
			index === undefined ? "standard" : String(index),
		);
		this.#emulator.machine.diskSpeedIndex = index; // the built-in D1:
		for (const drive of this.#extraDrives) drive.highSpeedIndex = index;
		this.toast(messages.toasts.diskSpeed(index));
	}

	/** Type text into the machine through the OS K: trap (see the machine's
	 *  `paste`), with toast feedback - the shared tail of the clipboard
	 *  shortcut and the paste panel. */
	typeText(text: string): void {
		if (!this.#emulator.machine.pasteSupported) {
			this.toast(messages.errors.pasteUnsupported, "warning");
			return;
		}
		const count = this.#emulator.machine.paste(text, GLYPH_TO_ATASCII);
		if (count > 0) this.toast(messages.toasts.pasted(count));
		else this.toast(messages.errors.nothingToPaste, "warning");
	}

	/**
	 * Paste delivery mode, mirrored onto the machine (and re-applied on a
	 * rebuild): false = the default K: handler trap, true = CH ($02FC)
	 * injection for programs that poll the key code directly. Persisted.
	 */
	readonly pasteChMode = signal(false);

	setPasteChMode(ch: boolean): void {
		this.pasteChMode.value = ch;
		savePersisted(PASTE_MODE_KEY, ch ? "ch" : "k");
		this.#emulator.machine.pasteMode = ch ? "ch" : "k";
		this.toast(messages.toasts.pasteMode(ch));
	}

	togglePasteChMode(): void {
		this.setPasteChMode(!this.pasteChMode.value);
	}

	/** Read the host clipboard and type it into the machine (see
	 *  {@link typeText}). Must run within a user gesture - the paste key
	 *  binding or a palette pick - for the clipboard read to be allowed. */
	pasteText(): void {
		if (!this.#emulator.machine.pasteSupported) {
			this.toast(messages.errors.pasteUnsupported, "warning");
			return;
		}
		navigator.clipboard
			.readText()
			.then((text) => this.typeText(text))
			.catch(() => this.toast(messages.errors.clipboardUnavailable, "warning"));
	}

	/** Plug or unplug the keyboard. Detached, the matrix sends no response,
	 *  and an XEGS senses the absence on TRIG2. Session-only - a rebuild
	 *  carries it over, like a cable nobody replugged. */
	setKeyboardAttached(attached: boolean): void {
		this.keyboardAttached.value = attached;
		this.#emulator.machine.keyboard.attached.value = attached;
		this.toast(messages.toasts.keyboardAttached(attached));
	}

	/** Whether this host runs on macOS - for platform-specific shortcut labels. */
	get isMac(): boolean {
		return this.#isMac;
	}

	/** Regenerate the platform default key bindings from a freshly re-read layout
	 *  (so this doubles as the layout-switch refresh), persist them, and apply them
	 *  live - discarding any customization. */
	async resetKeyBindings(): Promise<void> {
		if (!window.confirm(messages.shortcuts.confirmReset)) return;
		const { bindings, layout } = await freshBindings(this.#isMac);
		this.#applyBindings(bindings);
		this.layoutLabels.value = layout;
		this.toast(messages.toasts.keyBindingsReset);
	}

	/** Set the keyboard-layout preference ("auto" or a `KEYBOARD_LAYOUTS` id) and
	 *  regenerate the default bindings from it - discarding customization (a no-op
	 *  if it's already the current pick). */
	async setLayoutPreference(pref: string): Promise<void> {
		if (pref === this.layoutPref.value) return;
		if (!window.confirm(messages.shortcuts.confirmLayout)) return;
		saveLayoutPref(pref);
		this.layoutPref.value = pref;
		const { bindings, layout } = await freshBindings(this.#isMac);
		this.#applyBindings(bindings);
		this.layoutLabels.value = layout;
		this.toast(messages.toasts.keyBindingsReset);
	}

	// Make a flat binding set the active one - both the keyboard (resolution) and
	// the signal (UI shortcut display).
	#applyBindings(bindings: Binding[]): void {
		this.keyBindings.value = bindings;
		this.#keyboard.setBindings(bindings);
	}

	/** Replace the binding set from an edit - persist it and apply it live. */
	updateBindings(bindings: Binding[]): void {
		saveBindings(bindings);
		this.#applyBindings(bindings);
	}

	setMuted(muted: boolean): void {
		if (!this.#audio) return;
		this.#audio.muted = muted;
		savePersisted(MUTED_KEY, muted ? "on" : "off");
		this.#refreshAudioState();
	}

	/**
	 * The audio indicator's click action: enable audio if it's still
	 * suspended (any gesture resumes the context), otherwise flip mute.
	 */
	toggleAudio(): void {
		const audio = this.#audio;
		if (!audio) {
			// No audio sink - surface why (it's the only feedback the user gets).
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

	/** Open the file picker to attach a disk to the given drive (no reboot).
	 *  Keeps the open pane: the pick came from somewhere worth returning to
	 *  (the drive bank), and with nothing open there's nothing to close. */
	pickAttachDisk(unit = 1): void {
		this.#pendingPick = (file) =>
			void this.attachDiskFile(file, unit, { keepPanel: true });
		this.#bootImagePicker?.();
	}

	/** Open the file picker to attach a cartridge (cold boots). Keeps the
	 *  open pane, like {@link pickAttachDisk}. */
	pickAttachCartridge(): void {
		this.#pendingPick = (file) =>
			void this.attachCartridgeFile(file, { keepPanel: true });
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

	// Announce the config fields that changed between two settings, as toasts -
	// so the palette's one-shot commands and the menu's batched apply both give
	// the same feedback.
	#announceConfigChange(prev: MachineSettings, next: MachineSettings): void {
		if (next.model !== prev.model) {
			this.toast(messages.toasts.switchingMachine(MODEL_LABELS[next.model]));
		}
		if (next.tv !== prev.tv) {
			this.toast(messages.toasts.switchingTv(next.tv.toUpperCase()));
		}
		if (next.tvAdapter !== prev.tvAdapter) {
			this.toast(
				messages.toasts.switchingVideoChip(next.tvAdapter.toUpperCase()),
			);
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
		// Open the config form on the running machine's settings.
		if (panel === "config") this.staged.value = this.config.peek();
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
	 * ResizeObserver). Where the Fullscreen API is unavailable - notably iPhone
	 * Safari, which only fullscreens video - say so rather than silently fail.
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

	stageTvAdapter(tvAdapter: TvAdapter): void {
		this.staged.value = { ...this.staged.value, tvAdapter };
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

	// Apply a single config change to the running machine and reboot into it -
	// the palette's "... (reboots)" commands. A no-op change is ignored so it
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

	// `null` clears the override (back to the automatic ranking) - so picking the
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
	 * Boot a user-supplied file (the "Boot image..." picker / drag-and-drop). The
	 * file is auto-added to the library (transient) so it has an id - for resume
	 * and save - and booted through it; unrecognized bytes still warn directly.
	 */
	async loadFile(file: File, options?: { keepPanel?: boolean }): Promise<void> {
		const bytes = new Uint8Array(await file.arrayBuffer());
		const id = await addOrFindImage(bytes, file.name, true);
		if (id) await this.bootImage(id, options);
		else this.#bootImage(bytes, file.name, undefined, options);
	}

	// --- Image library actions (by id; built-in or user). The id-based entry
	// points fetch the bytes through the facade and reuse the boot/attach cores
	// below. ---

	/**
	 * An unknown-ROM can't boot until its cartridge type is picked: send the
	 * user to its library page, where the picker lives. A typed cart whose
	 * type isn't runnable (unimplemented scheme, a 5200 cart) explains
	 * itself; the picker on its page allows trying another type.
	 */
	#interceptUnresolvedCart(entry: ImageEntry): boolean {
		if (entry.derived.type === "unknown-rom") {
			this.toast(
				messages.library.cartTypeUnknownToast(entry.user.displayName),
				"warning",
			);
			navigate(`/a8/emu/library/${encodeURIComponent(entry.id)}`);
			return true;
		}
		if (
			entry.derived.type === "cart" &&
			!isCartTypeSupported(entry.derived.cartType)
		) {
			const message =
				CART_TYPES[entry.derived.cartType]?.machine === "5200"
					? messages.errors.cart5200
					: messages.errors.cartTypeUnsupported;
			this.toast(`${entry.user.displayName}: ${message}`, "warning");
			return true;
		}
		return false;
	}

	/** Boot a library image as a fresh machine. */
	async bootImage(
		id: string,
		options?: { keepPanel?: boolean },
	): Promise<void> {
		await readyLibrary();
		const entry = getImage(id);
		if (!entry) return;
		if (this.#interceptUnresolvedCart(entry)) return;
		this.#bootImage(
			await getImageBytes(id),
			entry.user.displayName,
			id,
			options,
		);
	}

	/** Attach a library disk image to a drive (live, no reboot). Resolves
	 *  true when the disk actually mounted - callers navigating afterwards
	 *  (the item view heads to the devices view) skip it on failure. */
	async attachDisk(
		id: string,
		unit = 1,
		options?: { keepPanel?: boolean },
	): Promise<boolean> {
		await readyLibrary();
		const entry = getImage(id);
		if (!entry) return false;
		return this.#attachDiskBytes(
			await getImageBytes(id),
			entry.user.displayName,
			id,
			unit,
			options,
		);
	}

	/** Attach a library cartridge (cold boots). */
	async attachCartridge(
		id: string,
		options?: { keepPanel?: boolean },
	): Promise<void> {
		await readyLibrary();
		const entry = getImage(id);
		if (!entry) return;
		if (this.#interceptUnresolvedCart(entry)) return;
		this.#attachCartridgeBytes(
			await getImageBytes(id),
			entry.user.displayName,
			id,
			options,
		);
	}

	/** Promote a transient (auto-added) image into the curated library -
	 *  from the recents bookmark or its own library page. */
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
		if (!window.confirm(messages.reset.confirmDefaults)) return;
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
			tvAdapter: "gtia",
			basicDisabled: false,
		};
	}

	// Set config + applied/staged ROM picks, then re-pin (a reset clears the picks,
	// so this fills + persists them afresh - without it a settled slot would read
	// as empty until the next boot and re-rank on import).
	#setConfigAndRoms(config: MachineSettings, roms: RomOverrides): void {
		this.config.value = config;
		this.staged.value = config;
		this.appliedRoms.value = roms;
		this.stagedRoms.value = roms;
		this.#ensurePins();
	}

	#mediaMounted(): boolean {
		return this.#cartridge !== null || this.#drives.some((d) => d !== null);
	}

	// Unmount everything in memory (the persisted media is cleared separately by
	// the reset's storage wipe). The caller reboots into the now-empty machine.
	#clearMedia(): void {
		this.#cartridge = null;
		this.#drives = emptyDrives();
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
	#bootImage(
		contents: Uint8Array,
		name: string,
		sourceId?: string,
		options?: { keepPanel?: boolean },
	): void {
		// Content-based detection (no filename hint): the bytes carry their own
		// magic/heuristics, and library images may have no meaningful extension.
		const format = detectFileFormat(contents);

		// An unrecognized/unloadable file changes nothing - just warn.
		const unsupported = unsupportedMessage(format);
		if (unsupported) {
			this.toast(`${name}: ${unsupported}`, "warning");
			return;
		}

		// Boot image starts fresh: fill the one slot it boots from and clear the
		// rest. (Attach, below, instead adds to the running machine in place.)
		let cartridge: { cart: Cartridge; name: string; sourceId?: string } | null =
			null;
		let disk: Omit<DriveSlot, "on"> | null = null;
		try {
			if (format === "atr") {
				disk = {
					disk: new AtrImage(contents, {
						writeProtected: imageWriteProtected(sourceId),
					}),
					name,
					sourceId,
				};
			} else if (format === "xex") {
				// XEX boots from a generated in-memory disk (its loader). The source
				// id is kept so the boot can be resumed (re-built from the XEX), but
				// saveD1ToLibrary refuses it - its synthetic disk isn't the XEX.
				disk = {
					disk: buildBootDisk(contents),
					name,
					sourceId,
					synthetic: true,
				};
			} else {
				cartridge = { cart: createCartridge(contents), name, sourceId };
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.toast(`${name}: ${message}`, "error");
			return;
		}

		// Announce the teardown of every boot source it clears, then the boot
		// itself - so the silent multi-action is legible.
		this.#announceBootTeardown();
		this.toast(
			cartridge
				? messages.toasts.bootCartridge(name)
				: format === "xex"
					? messages.toasts.bootExecutable(name)
					: messages.toasts.bootDisk(name),
		);

		// Get out of the way - except for a dropped file, where whatever pane
		// is open (the drive bank, the library) is the context being worked in.
		if (!options?.keepPanel) this.closePanel();
		this.#cartridge = cartridge;
		// Boot clears its own slot (D1:) only; disks parked or mounted in
		// D2:-D8: ride along, like real drives across a power cycle.
		const drives = [...this.#drives];
		drives[0] = disk ? { ...disk, on: true } : null;
		this.#drives = drives;
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
			this.toast(messages.toasts.detachingDisk(1, this.#drives[0].name));
		}
		if (hasBuiltinBasic(model) && !basicDisabled) {
			this.toast(messages.toasts.disablingBasic);
		}
	}

	/**
	 * Save a drive's disk as an `.atr`, including any sectors the running
	 * machine has written this session (writes live only in memory, so this
	 * is how you keep them). Writable disks only - the synthetic XEX boot
	 * disk is write-protected and isn't a real disk worth saving.
	 */
	downloadDisk(unit = 1): void {
		const drive = this.#drives[unit - 1];
		if (!drive || drive.disk.writeProtected) {
			this.toast(messages.errors.noWritableDisk(unit), "warning");
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
	 * Save a drive's disk back to the library item it was attached from -
	 * keeping any sectors written this session. Only a disk attached from one
	 * of your library uploads can be saved (built-ins are read-only; a
	 * file-loaded disk has no library item - use the download for those).
	 */
	async saveDiskToLibrary(unit = 1): Promise<void> {
		const drive = this.#drives[unit - 1];
		if (!drive) {
			this.toast(messages.errors.noDiskToSave(unit), "warning");
			return;
		}
		// Only a real disk entry can be overwritten - not a XEX (its D1: is a
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
		drive.disk.dirty = false;
		this.#refreshAttachments();
		this.toast(messages.toasts.savedToLibrary(drive.name));
	}

	/**
	 * Save a drive's disk (in-session writes included) to the library as a
	 * new item, and repoint the slot at it - subsequent in-place saves go to
	 * the new item, Save As style.
	 */
	async saveDiskAsNew(unit = 1): Promise<void> {
		const drive = this.#drives[unit - 1];
		if (!drive) {
			this.toast(messages.errors.noDiskToSave(unit), "warning");
			return;
		}
		const id = await addOrFindImage(drive.disk.toBytes(), drive.name, false);
		if (!id) {
			this.toast(messages.errors.unrecognized, "warning");
			return;
		}
		// The new item records the mounted disk's notch state explicitly -
		// with protected-by-default meta, a working (writable) copy must
		// carry its false or it would re-protect on the next attach.
		await updateUserMeta(id, { writeProtected: drive.disk.writeProtected });
		drive.sourceId = id;
		drive.disk.dirty = false;
		this.#refreshAttachments();
		this.#saveMedia();
		this.toast(messages.toasts.savedAsNewItem(drive.name));
	}

	/**
	 * Attach an ATR to a drive of the running machine - live, no reboot, BASIC
	 * untouched (unlike Boot image, which power-cycles into the image). The
	 * disk also stays mounted for the next cold start; D1:'s is what Download
	 * D1: saves.
	 */
	async attachDiskFile(
		file: File,
		unit = 1,
		options?: { keepPanel?: boolean },
	): Promise<void> {
		const bytes = new Uint8Array(await file.arrayBuffer());
		const id = await addOrFindImage(bytes, file.name, true);
		if (id) await this.attachDisk(id, unit, options);
		else this.#attachDiskBytes(bytes, file.name, undefined, unit, options);
	}

	// Attach an ATR's bytes to a drive, live - shared by the file picker and
	// the library's `attachDisk(id)` (which passes the source entry for saving
	// back). The drive comes on with the disk: inserting is the intent to use.
	#attachDiskBytes(
		contents: Uint8Array,
		name: string,
		sourceId?: string,
		unit = 1,
		options?: { keepPanel?: boolean },
	): boolean {
		let disk: AtrImage;
		try {
			disk = new AtrImage(contents, {
				writeProtected: imageWriteProtected(sourceId),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.toast(`${name}: ${message}`, "error");
			return false;
		}

		this.#drives[unit - 1] = { disk, name, sourceId, on: true };
		this.#syncDriveToMachine(unit);
		// Get out of the way - unless the attach came from a pane the user is
		// working in (a drive-row drop or its file picker, where the bank IS
		// the feedback).
		if (!options?.keepPanel && currentPath() !== "/a8/emu/devices") {
			this.closePanel();
		}
		this.#refreshAttachments();
		this.#saveMedia();
		this.#noteUsed(sourceId);
		this.toast(messages.toasts.attachingDisk(unit, name));
		return true;
	}

	/** Detach the disk from a drive of the running machine (live, no reboot). */
	detachDisk(unit = 1): void {
		const slot = this.#drives[unit - 1];
		if (!slot) {
			this.toast(messages.errors.noDiskToDetach(unit), "warning");
			return;
		}
		this.#drives[unit - 1] = null;
		this.#syncDriveToMachine(unit);
		this.#refreshAttachments();
		this.#saveMedia();
		this.toast(messages.toasts.detachingDisk(unit, slot.name));
	}

	/** Detach every mounted disk (live, no reboot). */
	detachAllDisks(): void {
		if (this.#drives.every((slot) => slot === null)) {
			this.toast(messages.errors.noDisksAttached, "warning");
			return;
		}
		this.#drives = emptyDrives();
		for (let unit = 1; unit <= DRIVE_COUNT; unit++) {
			this.#syncDriveToMachine(unit);
		}
		this.#refreshAttachments();
		this.#saveMedia();
		this.toast(messages.toasts.detachingAllDisks);
	}

	/**
	 * Turn a drive on or off (only meaningful with a disk in). Off parks the
	 * disk: the host keeps the image (in-session writes included), the bus
	 * hears nothing - like powering a real drive down with the disk inside.
	 */
	setDriveOn(unit: number, on: boolean): void {
		const slot = this.#drives[unit - 1];
		if (!slot) {
			this.toast(messages.errors.driveEmpty(unit), "warning");
			return;
		}
		slot.on = on;
		this.#syncDriveToMachine(unit);
		this.#refreshAttachments();
		this.#saveMedia();
		this.toast(messages.toasts.driveOn(unit, on));
	}

	toggleDriveOn(unit: number): void {
		const slot = this.#drives[unit - 1];
		if (!slot) {
			this.toast(messages.errors.driveEmpty(unit), "warning");
			return;
		}
		this.setDriveOn(unit, !slot.on);
	}

	/**
	 * Write-protect a library disk: the notch is a property of the medium,
	 * so it persists on the entry's metadata (built-ins via overrides) and
	 * flips every currently-mounted copy live (the drives' status frames
	 * follow the flag). Synthetic boot disks stay protected regardless.
	 */
	async setImageWriteProtect(id: string, on: boolean): Promise<void> {
		await updateUserMeta(id, { writeProtected: on });
		for (let unit = 1; unit <= DRIVE_COUNT; unit++) {
			const slot = this.#drives[unit - 1];
			if (slot?.sourceId === id && !slot.synthetic) {
				slot.disk.writeProtected = on;
			}
		}
		this.#refreshAttachments();
	}

	/**
	 * Rotate the drive slots by one, wrapping - up moves each disk to the
	 * next-lower drive (D2: becomes D1:, D1: wraps to D8:), the multi-disk
	 * "insert the next disk" gesture; down is the inverse. The whole slot
	 * travels, parked state included.
	 */
	rotateDrives(direction: "up" | "down"): void {
		if (this.#drives.every((slot) => slot === null)) {
			this.toast(messages.errors.noDisksAttached, "warning");
			return;
		}
		const d = this.#drives;
		this.#drives =
			direction === "up"
				? [...d.slice(1), d[0] ?? null]
				: [d[DRIVE_COUNT - 1] ?? null, ...d.slice(0, DRIVE_COUNT - 1)];
		for (let unit = 1; unit <= DRIVE_COUNT; unit++) {
			this.#syncDriveToMachine(unit);
		}
		this.#refreshAttachments();
		this.#saveMedia();
		this.toast(messages.toasts.rotatingDrives(direction === "up"));
	}

	/**
	 * Exchange a drive's slot with its neighbor (whole slot, parked state
	 * included) - the per-drive nudge; no wrap, that's what rotate is for.
	 */
	moveDrive(unit: number, direction: "up" | "down"): void {
		const target = direction === "up" ? unit - 1 : unit + 1;
		if (target < 1 || target > DRIVE_COUNT) return;
		const d = this.#drives;
		const moved = d[unit - 1] ?? null;
		d[unit - 1] = d[target - 1] ?? null;
		d[target - 1] = moved;
		this.#syncDriveToMachine(unit);
		this.#syncDriveToMachine(target);
		this.#refreshAttachments();
		this.#saveMedia();
		this.toast(messages.toasts.movingDrive(unit, target));
	}

	// Mirror a slot onto the machine: the drive holds the disk only while the
	// slot is on (a parked or empty drive claims no bus ID - identical on the
	// wire). D1: is the machine's built-in drive; the rest are the host's.
	#syncDriveToMachine(unit: number): void {
		const slot = this.#drives[unit - 1];
		const active = slot?.on ? slot.disk : undefined;
		if (unit === 1) {
			if (active) this.#emulator.machine.insertDisk(active);
			else this.#emulator.machine.ejectDisk();
		} else {
			const drive = this.#extraDrives[unit - 2];
			if (drive) drive.disk = active;
		}
	}

	/**
	 * Attach a cartridge and cold boot into it. Unlike Boot image this leaves
	 * the other media in place (a disk in D1: stays, and the cart's own header
	 * flags then decide whether the disk also boots). It reboots because a
	 * cartridge is memory-mapped and only takes effect at reset; the niche
	 * "stage it without rebooting" can come later.
	 */
	async attachCartridgeFile(
		file: File,
		options?: { keepPanel?: boolean },
	): Promise<void> {
		const bytes = new Uint8Array(await file.arrayBuffer());
		const id = await addOrFindImage(bytes, file.name, true);
		if (id) await this.attachCartridge(id, options);
		else this.#attachCartridgeBytes(bytes, file.name, undefined, options);
	}

	// Attach a cartridge's bytes (cold boots) - shared by the file picker and the
	// library's `attachCartridge(id)`. Content-based detection so canonical `.car`
	// and raw built-in bytes both load without a filename hint.
	#attachCartridgeBytes(
		contents: Uint8Array,
		name: string,
		sourceId?: string,
		options?: { keepPanel?: boolean },
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
			cart = createCartridge(contents);
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

		// Get out of the way - unless the attach came from a pane the user is
		// working in (the cart slot's drop target or file picker).
		if (!options?.keepPanel) this.closePanel();
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
	 * too) - what the user means by "detach." Anything else (XL/XE, or the slot
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
			this.applyBasicDisabled(true); // toasts "Detaching cartridge (BASIC...)"
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
		// Wide gamut when both the display and the canvas API support it -
		// deliberately no UI: sRGB-defined palettes are converted so they look
		// identical, while corrected wide primaries (NTSC 1953) keep saturation
		// an sRGB canvas would clamp. Decided once here; a context's color
		// space is fixed at creation.
		let outputGamut: OutputGamut = "srgb";
		let context: CanvasRenderingContext2D | null = null;
		if (matchMedia("(color-gamut: p3)").matches) {
			context = canvas.getContext("2d", { colorSpace: "display-p3" });
			if (
				context &&
				typeof context.getContextAttributes === "function" &&
				context.getContextAttributes().colorSpace === "display-p3"
			) {
				outputGamut = "display-p3";
			}
		}
		context ??= canvas.getContext("2d");
		this.outputGamut.value = outputGamut;
		const stage = canvas.parentElement;
		if (!context || !stage) return () => {};

		// The visible crop of the rendered frame - the running standard's
		// overscan setting (see display-settings.ts). The canvas backing store
		// is the crop, so the blit clips and the fit letterboxes exactly what's
		// shown. Updated by the subscriptions below.
		let crop = overscanCrop(
			this.displaySettings.value[this.config.value.tv].overscan,
		);

		// Fit the canvas into its parent, preserving the display aspect - which
		// depends on the crop and the TV standard's pixel aspect ratio, so it's
		// re-run when either changes (the stage may not).
		const fit = () => {
			const par =
				this.config.value.tv === "pal"
					? PAL_PIXEL_ASPECT_RATIO
					: NTSC_PIXEL_ASPECT_RATIO;
			const displayAspect = (crop.width * par) / crop.height;
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
			{ colorSpace: outputGamut },
		);
		const pixels = new Uint32Array(imageData.data.buffer);

		// The frameCount of the frame currently on the canvas; -1 forces a
		// redraw on the next present.
		let presented = -1;

		// Size the canvas backing store to the crop and force a redraw (resizing
		// clears the canvas, and the present loop otherwise skips unchanged
		// frames - noticeable while paused).
		const applyCrop = () => {
			crop = overscanCrop(
				this.displaySettings.value[this.config.value.tv].overscan,
			);
			if (canvas.width !== crop.width || canvas.height !== crop.height) {
				canvas.width = crop.width;
				canvas.height = crop.height;
			}
			presented = -1;
			fit();
		};

		// The fit (pixel aspect), the palette, the crop, and the frame-blending
		// amount follow the TV standard; all also follow the display settings
		// (the palette is *generated* from the standard's parameters).
		let palette = buildNtscPalette();
		let frameBlending = 0;
		const apply = () => {
			applyCrop();
			const tv = this.config.value.tv;
			const params = { ...this.displaySettings.value[tv].palette, outputGamut };
			palette =
				tv === "pal" ? buildPalPalette(params) : buildNtscPalette(params);
			frameBlending = this.displaySettings.value[tv].frameBlending;
		};
		const unsubscribeConfig = this.config.subscribe(apply);
		const unsubscribeDisplay = this.displaySettings.subscribe(apply);

		// Frame blending mixes in *linear light* - flicker fusion happens in
		// light, not signal, and gamma-space blending underweights the bright
		// phase of a flicker pair (see the analog-video appendix's averaging
		// note). LUTs stand in for per-pixel pow: byte -> linear in, linear ->
		// byte out.
		const LINEAR = new Float32Array(256);
		for (let i = 0; i < 256; i++) LINEAR[i] = Math.pow(i / 255, 2.2);
		const ENCODE = new Uint8Array(4097);
		for (let i = 0; i <= 4096; i++) {
			ENCODE[i] = Math.round(Math.pow(i / 4096, 1 / 2.2) * 255);
		}
		// The retained displayed image (linear RGB triplets), and the frame it
		// represents. Allocated on first use; dropped while blending is off.
		let retained: Float32Array | null = null;
		let blendedFrame = -1;

		// Listen for pad connect/disconnect so polling can gate on presence.
		const detachGamepads = this.#gamepads.attach();

		let raf = 0;
		let framesAtSecondStart = this.#emulator.frameCount;
		let secondStart = performance.now();
		const present = () => {
			// Keepalive poll on the display cadence: the emulation loop's afterYield
			// poll stops when paused, so this keeps the meta buttons (notably
			// Pause->Resume) live. Harmless while running - edge detection dedupes it
			// against the fresher afterYield samples, and it no-ops with no pad.
			this.#gamepads.poll();

			if (this.#emulator.frameCount !== presented) {
				const frameCount = this.#emulator.frameCount;
				const frame = this.#emulator.frame;
				if (frameBlending > 0) {
					// Decay per *emulated* frame: skipped frames (turbo, slow
					// tabs) decay by k^N rather than one step. A non-advancing
					// or reset frameCount (machine swap, forced redraws from
					// setting changes) rebuilds the retained image fresh.
					const fresh =
						retained === null || blendedFrame < 0 || frameCount <= blendedFrame;
					const k = fresh
						? 0
						: Math.pow(frameBlending, frameCount - blendedFrame);
					const keep = 1 - k;
					retained ??= new Float32Array(frame.length * 3);
					for (let i = 0; i < frame.length; i++) {
						const w = palette[frame[i]!]!;
						const base = i * 3;
						const r = LINEAR[w & 0xff]! * keep + retained[base]! * k;
						const g =
							LINEAR[(w >>> 8) & 0xff]! * keep + retained[base + 1]! * k;
						const b =
							LINEAR[(w >>> 16) & 0xff]! * keep + retained[base + 2]! * k;
						retained[base] = r;
						retained[base + 1] = g;
						retained[base + 2] = b;
						pixels[i] =
							0xff000000 |
							(ENCODE[(b * 4096) | 0]! << 16) |
							(ENCODE[(g * 4096) | 0]! << 8) |
							ENCODE[(r * 4096) | 0]!;
					}
				} else {
					retained = null; // free it; re-primed when turned back on
					for (let i = 0; i < frame.length; i++) {
						pixels[i] = palette[frame[i]!]!;
					}
				}
				blendedFrame = frameCount;
				presented = frameCount;
				// The canvas is the visible crop; putImageData clips the rest.
				context.putImageData(imageData, -crop.left, -crop.top);
			}
			this.crashed.value = this.#emulator.crashed; // dedup'd by the signal
			// Sample the emulated frame rate about once a second. Measure the
			// emulator's own frameCount delta over the elapsed wall clock, not
			// how many distinct frames this RAF loop happened to observe - RAF
			// coalesces under main-thread load and would undercount frames the
			// emulator actually produced.
			const now = performance.now();
			const elapsed = now - secondStart;
			const frameCount = this.#emulator.frameCount;
			if (frameCount < framesAtSecondStart) {
				// The emulator was swapped (reboot/config change) and its
				// frameCount reset - rebase the window rather than report a
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
			unsubscribeConfig();
			unsubscribeDisplay();
			detachGamepads();
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
			// Let toolbar buttons, the sidebar (which has its own focusable
			// input), and editable controls (the OSD paste editor) take their
			// own clicks; only steal focus back from clicks on the
			// screen/letterbox so keystrokes return to the emulator.
			const target = event.target as HTMLElement;
			if (target.closest("button, aside, input, textarea, select")) return;
			event.preventDefault();
			input.focus();
		};
		const releaseAll = () => {
			this.#keyboard.releaseAll();
			// The machine-side backstop: a keyup the app never saw (focus
			// stolen mid-press) can't leave a matrix key wedged down.
			this.#heldComposed.clear();
			this.#shiftCommandHeld = false;
			this.#emulator.machine.keyboard.releaseAll();
		};
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
	 * not pointerdown - so listen on pointerup and keydown.
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

	// Fetched ROM bytes, keyed by the resolved image's id - populated lazily
	// before each (re)build so #makeEmulator can read them synchronously.
	readonly #bytes = new Map<string, Uint8Array>();
	readonly #audio: AudioOutput | null;
	readonly #audioError: string | null;
	readonly #keyboard: Keyboard;
	readonly #gamepads: Gamepads;
	readonly #isMac = isMac();
	// Whether key bindings were loaded from storage; if not, create() generates
	// and persists the platform defaults (async - it resolves layout labels).
	readonly #bindingsStored: boolean;
	// The model a brand-new install starts from (and resets fall back to).
	readonly #defaultModel: AtariModel;

	// Assigned by create() before the host is handed out - the constructor can't
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
	// coexist); #drives is indexed by drive number (0 = D1:), all eight slots.
	// `sourceId` is the library entry the cart/disk came from, if any - used to
	// persist what's mounted (and, for a disk, what `saveD1ToLibrary` writes back).
	// A slot's `on` is "attached to the bus": off keeps the disk parked (the
	// host holds the AtrImage, the machine drive is empty, in-session writes
	// survive the park). On-but-empty isn't modeled - an empty drive claims no
	// bus ID either way.
	#cartridge: { cart: Cartridge; name: string; sourceId?: string } | null =
		null;
	#drives: (DriveSlot | null)[] = emptyDrives();
	// The D2:-D8: DiskDrive devices attached to the current machine's SIO
	// connector (index 0 = D2:), rebuilt with each emulator by #makeEmulator.
	#extraDrives: DiskDrive[] = [];
	// Media to re-mount once the library is ready (set from sessionStorage in the
	// constructor, consumed by create()/#restoreMedia). Null when nothing to do.
	#pendingMedia: PersistedMedia | null = null;

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
		this.cartSlot.value = this.#cartridge
			? {
					name: this.#cartridge.name,
					sourceId: this.#cartridge.sourceId ?? null,
				}
			: basic
				? { name: basic, sourceId: null }
				: null;
		this.driveBank.value = this.#drives.map(
			(slot) =>
				slot && {
					name: slot.name,
					sourceId: slot.sourceId ?? null,
					on: slot.on,
					writeProtected: slot.disk.writeProtected,
					modified: slot.disk.dirty,
					density: density(slot.disk),
				},
		);
	}

	/**
	 * Recompute the drive bank (and attachment labels). The devices view
	 * polls this while open: a guest write flips a disk's dirty flag with no
	 * host action to piggyback on.
	 */
	refreshDriveBank(): void {
		this.#refreshAttachments();
	}

	// Persist this tab's mounted media (the library ids in each slot) plus the
	// live BASIC state, so reloading the tab resumes the running machine. Only
	// slots backed by a library entry persist; an id-less mount is dropped (it
	// can't be reconstructed). Session-only - a fresh tab starts empty.
	#saveMedia(): void {
		saveSession(MEDIA_KEY, {
			cart: this.#cartridge?.sourceId ?? null,
			drives: this.#drives.map((slot) =>
				slot?.sourceId ? { id: slot.sourceId, on: slot.on } : null,
			),
			basicDisabled: this.config.value.basicDisabled,
		} satisfies PersistedMedia);
	}

	// Record a just-booted/attached library image in the recents history, then
	// sweep transient (auto-added) images that have fallen off it - keeping any
	// still mounted, so a resume never loses its backing blob.
	#noteUsed(sourceId: string | undefined): void {
		if (!sourceId) return;
		touchRecent(sourceId);
		const keep = new Set(recentIds.value);
		if (this.#cartridge?.sourceId) keep.add(this.#cartridge.sourceId);
		for (const slot of this.#drives) {
			if (slot?.sourceId) keep.add(slot.sourceId);
		}
		void sweepTransients(keep);
	}

	#mountsImage(id: string): boolean {
		return (
			this.#cartridge?.sourceId === id ||
			this.#drives.some((slot) => slot?.sourceId === id)
		);
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
		for (let unit = 1; unit <= DRIVE_COUNT; unit++) {
			const saved = media.drives[unit - 1];
			if (!saved) continue;
			try {
				const entry = getImage(saved.id);
				if (entry) {
					const bytes = await getImageBytes(saved.id);
					// An XEX resumes via its synthetic boot disk - a D1:-only
					// arrangement (that's the slot a boot fills).
					const synthetic = entry.derived.type === "xex" && unit === 1;
					this.#drives[unit - 1] = {
						disk: synthetic
							? buildBootDisk(bytes)
							: new AtrImage(bytes, {
									writeProtected: entry.user.writeProtected ?? true,
								}),
						name: entry.user.displayName,
						sourceId: saved.id,
						on: saved.on,
						synthetic,
					};
				}
			} catch {
				// corrupt or missing blob - leave the drive empty
			}
		}
		if (media.cart) {
			try {
				const entry = getImage(media.cart);
				if (entry) {
					const bytes = await getImageBytes(media.cart);
					this.#cartridge = {
						cart: createCartridge(bytes),
						name: entry.user.displayName,
						sourceId: media.cart,
					};
				}
			} catch {
				// corrupt or missing blob - leave the cart slot empty
			}
		}
		this.#refreshAttachments();
	}

	#commandContext() {
		return { emulator: this.#emulator, host: this };
	}

	// The best-ranked built-in firmware present in the library for a list of
	// keys (a built-in's image id is its firmware key).
	// Resolve the best available firmware by rank, matching on the detected
	// firmware identity - so an uploaded copy of a known ROM is picked just like
	// the built-in one (a built-in's id is also its key).
	#pick(keys: readonly FirmwareKey[]): ImageEntry | null {
		for (const key of keys) {
			const entry = libraryEntries.value.find((e) => e.firmwareKey === key);
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
	// override wins over the ranking when its image is present (a missing one -
	// e.g. a built-in dropped by a deploy - falls back to the ranking).
	#resolveWith(roms: RomOverrides): {
		os: ImageEntry | null;
		basic: ImageEntry | null;
		game: ImageEntry | null;
	} {
		const { model, tv, basicDisabled } = this.config.value;
		// Built-in BASIC (xl/xe, xegs) is always loaded - its "disable" is the
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

	// Resolve an override to its library image - null when it doesn't resolve
	// (no override, or one pointing at an image the library no longer has).
	#fromId(id: string | null | undefined): ImageEntry | null {
		return id ? (getImage(id) ?? null) : null;
	}

	// The XEGS game-slot image - any library image flagged for the game slot
	// (the bundled one, or an upload the user has tagged).
	#pickGame(): ImageEntry | null {
		return (
			libraryEntries.value.find((e) => e.user.slots?.includes("game")) ?? null
		);
	}

	// Pin the resolved firmware per slot into the (persisted) prefs, so a later
	// library change can't silently re-rank a slot that's already settled. A slot
	// is (re)picked by rank only when its pref is empty or points at an image the
	// library no longer has - "fill an empty slot, or replace a vanished one";
	// importing a better ROM leaves a settled slot alone (pick it by hand instead).
	#ensurePins(): void {
		// Every OS slot (not just the running model's) gets pinned, so a slot the
		// user hasn't booted into is just as stable against imports.
		const osSlots: { slot: OsSlot; model: AtariModel; tv: "ntsc" | "pal" }[] = [
			{ slot: "800-ntsc", model: "400/800", tv: "ntsc" },
			{ slot: "800-pal", model: "400/800", tv: "pal" },
			{ slot: "xlxe", model: "xl/xe", tv: "ntsc" },
			{ slot: "1200xl", model: "1200xl", tv: "ntsc" },
			{ slot: "xegs", model: "xegs", tv: "ntsc" },
		];
		const prev = this.appliedRoms.value;
		const os = { ...prev.os };
		let basic = prev.basic;
		let game = prev.game;
		let changed = false;

		for (const s of osSlots) {
			if (this.#fromId(os[s.slot])) continue; // settled + still available
			const pick = this.#pick(preferredOsKeys({ model: s.model, tv: s.tv }));
			if (pick) {
				os[s.slot] = pick.id;
				changed = true;
			}
		}
		if (!this.#fromId(basic)) {
			const pick = this.#pick(preferredBasicKeys());
			if (pick) {
				basic = pick.id;
				changed = true;
			}
		}
		if (!this.#fromId(game)) {
			const pick = this.#pickGame();
			if (pick) {
				game = pick.id;
				changed = true;
			}
		}

		if (!changed) return;
		const wasDirty = this.romsDirty.value; // staged-vs-applied, before we update
		const next: RomOverrides = { os, basic, game };
		this.appliedRoms.value = next;
		if (!wasDirty) this.stagedRoms.value = next; // keep the panel synced
		savePersisted(ROMS_KEY, next);
	}

	// Fetch (and cache) the bytes the running config's OS + BASIC need, so the
	// next #makeEmulator can read them synchronously. Already-cached ROMs (the
	// common reboot case) resolve immediately. Ensures the user library is loaded
	// first so an override pointing at an upload resolves (resilient: an IDB
	// failure just leaves built-ins).
	async #ensureFirmware(): Promise<void> {
		await readyLibrary();
		this.#ensurePins();
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
		const { model, tv, tvAdapter, basicDisabled, memory, portbExtendedRam } =
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
				? createCartridge(basicBytes)
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
			tvAdapter,
			...(builtinBasic && basicBytes && { basic: basicBytes }),
			...(builtinBasic && basicDisabled && { holdOption: true }),
			...(model === "xegs" && gameBytes && { game: gameBytes }),
			...(model === "xegs" && { keyboardSense: true }),
			...(cartridge && { cartridge }),
			...(this.#drives[0]?.on && { disk: this.#drives[0].disk }),
			...(this.#audio && { audio: this.#audio }),
		});
		emulator.setTrace(this.#cpuTrace);
		emulator.setTurboMode(this.#turboMode);
		emulator.machine.keyboard.attached.value = this.keyboardAttached.value;
		emulator.machine.sioTrapEnabled = this.sioTrap.value;
		emulator.machine.sioAcceleration = this.sioAcceleration.value;
		emulator.machine.diskSpeedIndex = this.diskSpeed.value;
		emulator.machine.pasteMode = this.pasteChMode.value ? "ch" : "k";
		// D2:-D8: are host-attached DiskDrive devices on the SIO connector
		// (D1: is the machine's built-in drive, fed above). Rebuilt fresh per
		// emulator; each carries the advertised speed and its slot's disk.
		this.#extraDrives = [];
		for (let unit = 2; unit <= DRIVE_COUNT; unit++) {
			const drive = new DiskDrive(unit);
			drive.highSpeedIndex = this.diskSpeed.value;
			const slot = this.#drives[unit - 1];
			if (slot?.on) drive.disk = slot.disk;
			emulator.machine.sio.attach(drive);
			this.#extraDrives.push(drive);
		}
		// Sample the gamepad on every emulation-loop yield (see Emulator.afterYield)
		// - the freshest read, right before the next scanlines poll the pins.
		emulator.afterYield = () => this.#gamepads.poll();
		return emulator;
	}

	// Swap in a fresh emulator for the current config + attachment.
	#rebuild(): void {
		this.#emulator.stop();
		this.#audio?.clear();
		this.#heldComposed.clear();
		this.#shiftCommandHeld = false;
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
		// The connector's LED signals only fire on real level changes, so the
		// bank-switch noise on the underlying PIA port never reaches us.
		const panel = this.#emulator.machine.console;
		this.#unwatchLeds = panel.watchLeds((led1, led2) => {
			this.leds.value = [led1, led2];
		});
		this.leds.value = [panel.led1, panel.led2];
	}

	// Fetch whatever firmware the new config needs, then power-cycle into it.
	// Async (the fetch), but the rebuild itself stays synchronous - so the old
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
}

// Persisted-state keys (namespaced by storageName) - see persist.ts.
const CONFIG_KEY = "config";
const ROMS_KEY = "roms";
const KBMODE_KEY = "keyboard-mode";
const REALISTIC_SCAN_KEY = "realistic-key-scan";
const SIO_TRAP_KEY = "sio-trap";
const SIO_ACCEL_KEY = "sio-acceleration";
const DISK_SPEED_KEY = "disk-sio-speed";

// The persisted disk-speed value: "standard" = a stock drive (no $3F
// answer), else a POKEY divisor 0-40; anything unparseable falls back to
// the default (6, ~69k - the 1050 Turbo's rate, still within SpartaDOS
// X's clean-receive floor).
function parseDiskSpeed(stored: unknown): number | undefined {
	if (stored === "standard") return undefined;
	const divisor = Number(stored);
	return Number.isInteger(divisor) && divisor >= 0 && divisor <= 40
		? divisor
		: 6;
}
const PASTE_MODE_KEY = "paste-mode";
const OSD_KEY = "osd-forced";
const MUTED_KEY = "audio-muted";

// How long a momentary trigger (palette, click) holds a control before its
// auto-release - long enough for the OS to sense the key/button. Counted in
// emulated frames so it's two frames whether real-time or in turbo.
const PULSE_FRAMES = 2;
// The mounted media is per-tab (sessionStorage only) - a fresh tab starts empty
// rather than auto-booting the last session's image.
const MEDIA_KEY = "media";

/** This tab's persisted mounted media: the library ids in each slot. */
interface PersistedMedia {
	cart: string | null;
	/** Per-drive slot (index 0 = D1:): the library id and the drive's on
	 *  (bus-attached) state; null = empty. */
	drives: ({ id: string; on: boolean } | null)[];
	/** The live BASIC-disabled state (a boot turns it off without touching the
	 *  saved config seed), so a resume matches the booted machine. */
	basicDisabled: boolean;
}

// Coerce an untrusted persisted value into a PersistedMedia, or null if absent
// or malformed (ids are resolved against the library lazily, on restore). The
// pre-multi-drive shape carried a single `disk` id - accept it as D1:.
function sanitizeMedia(value: unknown): PersistedMedia | null {
	if (typeof value !== "object" || value === null) return null;
	const v = value as Partial<PersistedMedia> & { disk?: unknown };
	const drives = Array.from({ length: DRIVE_COUNT }, (_, index) => {
		const slot = Array.isArray(v.drives) ? (v.drives[index] as unknown) : null;
		if (typeof slot !== "object" || slot === null) return null;
		const s = slot as { id?: unknown; on?: unknown };
		return typeof s.id === "string" ? { id: s.id, on: s.on !== false } : null;
	});
	if (typeof v.disk === "string" && !drives[0]) {
		drives[0] = { id: v.disk, on: true };
	}
	return {
		cart: typeof v.cart === "string" ? v.cart : null,
		drives,
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
