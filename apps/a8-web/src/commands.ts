import type { Emulator } from "./emulator.ts";
import type { EmulatorHost } from "./host.ts";
import { labels, type LabelKey } from "./messages.ts";

export interface CommandContext {
	/** The live machine - for the key-matrix and joystick commands. */
	emulator: Emulator;
	/** The application host - for app-level commands (audio, pause, menu). */
	host: EmulatorHost;
}

/**
 * A command: a static label key (into {@link labels}) plus its action. `run` is
 * the action - or, for a control, its press half. `release` is the matching key
 * up; when present, a momentary trigger (palette, click) auto-releases after a
 * short pulse so it doesn't leave the control stuck, while a sustained trigger
 * (held key, touch) ties release to its own up event. Absent `release` =>
 * press-only: app verbs (POWER_CYCLE, SET_*) and Break alike.
 *
 * The palette lists every command - it's the catch-all fallback for any action
 * whose key binding is unavailable; a held control surfaced there just pulses
 * (one keystroke / one joystick step). `palette: false` removes one from that
 * list (still bindable) - wired but unused for now, for a future bindable-only
 * verb like "turbo while held".
 */
interface CommandSpec {
	label: LabelKey;
	run: (ctx: CommandContext) => void;
	release?: (ctx: CommandContext) => void;
	palette?: boolean;
	// A POKEY keyboard-matrix key (one shared register). The keyboard releases
	// these only when the last held matrix key is up - see {@link MATRIX_COMMANDS}.
	matrix?: boolean;
}

// On real hardware the keyboard matrix can't scan a key whose base scan code is
// $00-$07 or $10-$17 while both Ctrl and Shift are held, so the press does
// nothing. Those Ctrl+Shift commands ($C0-$C7, $D0-$D7 - bits $08 and $20 both
// clear) stay bound (harmlessly) but are hidden from the palette, where a no-op
// is just clutter.
const isDeadCtrlShift = (code: number): boolean =>
	code >= 0xc0 && (code & 0x28) === 0;

/** Factory for the keyboard matrix key presses, which differ only by key
 *  code (a scan code with KBCODE-style Shift/Ctrl bits; the host synthesizes
 *  the meta lines). Palette picks pulse a single keystroke. */
const press = (code: number, label: LabelKey): CommandSpec => ({
	label,
	run: ({ host }) => host.matrixKeyDown(code),
	release: ({ host }) => host.matrixKeyUp(code),
	matrix: true,
	...(isDeadCtrlShift(code) && { palette: false }),
});

// Joystick direction/trigger presses, one factory per kind. `port` is 0-3;
// direction `mask` bits are 1 = up, 2 = down, 4 = left, 8 = right. Held while a
// trigger sustains them; a palette pick pulses a single step. Ports 2/3 exist on
// the 800 only - on the XL/XE `emulator.joysticks` has no device there, so
// their commands are harmless no-ops.
const joyDir = (port: number, mask: number, label: LabelKey): CommandSpec => ({
	label,
	run: ({ emulator }) => emulator.joysticks[port]?.press(mask),
	release: ({ emulator }) => emulator.joysticks[port]?.release(mask),
});
const joyTrigger = (port: number, label: LabelKey): CommandSpec => ({
	label,
	run: ({ emulator }) => {
		const joystick = emulator.joysticks[port];
		if (joystick) joystick.trigger = true;
	},
	release: ({ emulator }) => {
		const joystick = emulator.joysticks[port];
		if (joystick) joystick.trigger = false;
	},
});

export const commands = {
	POWER_CYCLE: {
		label: "POWER_CYCLE",
		run: ({ host }) => host.powerCycle(),
	},

	// Emulation run state.
	PAUSE: { label: "PAUSE", run: ({ host }) => host.pause() },
	RESUME: { label: "RESUME", run: ({ host }) => host.resume() },
	TOGGLE_PAUSE: {
		label: "TOGGLE_PAUSE",
		run: ({ host }) => host.togglePause(),
	},

	// Turbo mode: run unthrottled (muted) vs. real time.
	TURBO_MODE_ENABLE: {
		label: "TURBO_MODE_ENABLE",
		run: ({ host }) => host.setTurboMode(true),
	},
	TURBO_MODE_DISABLE: {
		label: "TURBO_MODE_DISABLE",
		run: ({ host }) => host.setTurboMode(false),
	},
	TURBO_MODE_TOGGLE: {
		label: "TURBO_MODE_TOGGLE",
		run: ({ host }) => host.toggleTurboMode(),
	},
	// Turbo while held: press runs unthrottled, release returns to real time.
	// Bindable-only - a momentary palette pulse would enable turbo for a couple of
	// frames, which is pointless - so it's kept out of the palette.
	TURBO_HOLD: {
		label: "TURBO_HOLD",
		run: ({ host }) => host.setTurboMode(true),
		release: ({ host }) => host.setTurboMode(false),
		palette: false,
	},

	// Keyboard interpretation: layout-aware typing vs raw positional keys.
	KEYBOARD_MODE_CHARACTER: {
		label: "KEYBOARD_MODE_CHARACTER",
		run: ({ host }) => host.setKeyboardMode("character"),
	},
	KEYBOARD_MODE_POSITIONAL: {
		label: "KEYBOARD_MODE_POSITIONAL",
		run: ({ host }) => host.setKeyboardMode("positional"),
	},
	KEYBOARD_MODE_TOGGLE: {
		label: "KEYBOARD_MODE_TOGGLE",
		run: ({ host }) => host.toggleKeyboardMode(),
	},
	KEYBOARD_REALISTIC_SCAN_ENABLE: {
		label: "KEYBOARD_REALISTIC_SCAN_ENABLE",
		run: ({ host }) => host.setRealisticScan(true),
	},
	KEYBOARD_REALISTIC_SCAN_DISABLE: {
		label: "KEYBOARD_REALISTIC_SCAN_DISABLE",
		run: ({ host }) => host.setRealisticScan(false),
	},
	KEYBOARD_REALISTIC_SCAN_TOGGLE: {
		label: "KEYBOARD_REALISTIC_SCAN_TOGGLE",
		run: ({ host }) => host.toggleRealisticScan(),
	},
	KEYBOARD_ATTACH: {
		label: "KEYBOARD_ATTACH",
		run: ({ host }) => host.setKeyboardAttached(true),
	},
	KEYBOARD_DETACH: {
		label: "KEYBOARD_DETACH",
		run: ({ host }) => host.setKeyboardAttached(false),
	},
	SIO_TRAP_TOGGLE: {
		label: "SIO_TRAP_TOGGLE",
		run: ({ host }) => host.toggleSioTrap(),
	},
	SIO_ACCELERATION_TOGGLE: {
		label: "SIO_ACCELERATION_TOGGLE",
		run: ({ host }) => host.toggleSioAcceleration(),
	},
	KEY_BINDINGS_RESET: {
		label: "KEY_BINDINGS_RESET",
		run: ({ host }) => void host.resetKeyBindings(),
	},
	// Read the host clipboard and type it into the machine through the OS
	// keyboard trap. Must run within a user gesture (key binding, palette pick).
	// Touch devices use the OSD's paste view instead (clipboard-API-free).
	PASTE_TEXT: { label: "PASTE_TEXT", run: ({ host }) => host.pasteText() },
	// Paste delivery: the K: handler trap (default) vs key codes injected
	// into CH ($02FC / 764) for programs that poll it directly.
	PASTE_MODE_TOGGLE: {
		label: "PASTE_MODE_TOGGLE",
		run: ({ host }) => host.togglePasteChMode(),
	},

	// Audio.
	AUDIO_MUTE: { label: "AUDIO_MUTE", run: ({ host }) => host.setMuted(true) },
	AUDIO_UNMUTE: {
		label: "AUDIO_UNMUTE",
		run: ({ host }) => host.setMuted(false),
	},
	AUDIO_TOGGLE: {
		label: "AUDIO_TOGGLE",
		run: ({ host }) => host.toggleAudio(),
	},

	// Sidebar panels - each opens its panel; CLOSE_PANEL dismisses whichever is
	// showing. (Showing one when it's already open is a no-op.)
	OPEN_MENU: { label: "OPEN_MENU", run: ({ host }) => host.showPanel("menu") },
	// The consolidated settings view (opens on its first tab, Hardware). The
	// menu's Settings entry; hidden from the palette, where the per-tab
	// commands (Settings: Hardware..., Display..., ...) cover it without duplication.
	OPEN_SETTINGS: {
		label: "OPEN_SETTINGS",
		run: ({ host }) => host.showPanel("config"),
		palette: false,
	},
	OPEN_DISPLAY: {
		label: "OPEN_DISPLAY",
		run: ({ host }) => host.showPanel("display"),
	},
	OPEN_CONFIG: {
		label: "OPEN_CONFIG",
		run: ({ host }) => host.showPanel("config"),
	},
	// The command palette (this surface) - also the fallback for any action whose
	// key binding is unavailable.
	OPEN_PALETTE: {
		label: "OPEN_PALETTE",
		run: ({ host }) => host.showPanel("palette"),
	},
	OPEN_KEYS: { label: "OPEN_KEYS", run: ({ host }) => host.showPanel("keys") },
	OPEN_CONTROLLERS: {
		label: "OPEN_CONTROLLERS",
		run: ({ host }) => host.showPanel("controllers"),
	},
	// The devices view (opens on its first tab, D:).
	OPEN_DEVICES: {
		label: "OPEN_DEVICES",
		run: ({ host }) => host.showPanel("devices"),
	},

	// Full-screen the whole app (chrome included), so the on-screen controls
	// stay reachable. A no-op-safe toggle; also bound to a double-click on the
	// screen.
	TOGGLE_FULLSCREEN: {
		label: "TOGGLE_FULLSCREEN",
		run: ({ host }) => host.toggleFullscreen(),
	},
	// Show the touch on-screen controls without a touch pointer (they show
	// themselves on touch devices) - for the paste editor and OSD testing.
	OSD_TOGGLE: { label: "OSD_TOGGLE", run: ({ host }) => host.toggleOsd() },

	// Boot a file as a fresh machine image (opens the file picker).
	BOOT_IMAGE: { label: "BOOT_IMAGE", run: ({ host }) => host.pickBootImage() },
	// The couch game picker (gamepad-navigable favorites/recents overlay).
	OPEN_FAVORITES: {
		label: "OPEN_FAVORITES",
		run: ({ host }) => host.openFavorites(),
	},
	OPEN_ROMS: { label: "OPEN_ROMS", run: ({ host }) => host.showPanel("roms") },
	OPEN_LIBRARY: {
		label: "OPEN_LIBRARY",
		run: ({ host }) => host.showPanel("library"),
	},
	// Dismiss whichever sidebar panel is open, returning focus to the machine.
	CLOSE_PANEL: { label: "CLOSE_PANEL", run: ({ host }) => host.closePanel() },
	CLEAR_LIBRARY: {
		label: "CLEAR_LIBRARY",
		run: ({ host }) => host.clearLibrary(),
	},
	NUKE_EVERYTHING: {
		label: "NUKE_EVERYTHING",
		run: ({ host }) => host.nukeEverything(),
	},
	RESET_TAB_SETTINGS: {
		label: "RESET_TAB_SETTINGS",
		run: ({ host }) => host.resetTabSettings(),
	},
	RESET_DEFAULT_SETTINGS: {
		label: "RESET_DEFAULT_SETTINGS",
		run: ({ host }) => host.resetDefaultSettings(),
	},

	// Attach a disk to a drive of the running machine (no reboot, BASIC kept).
	ATTACH_D1: { label: "ATTACH_D1", run: ({ host }) => host.pickAttachDisk(1) },
	ATTACH_D2: { label: "ATTACH_D2", run: ({ host }) => host.pickAttachDisk(2) },
	ATTACH_D3: { label: "ATTACH_D3", run: ({ host }) => host.pickAttachDisk(3) },
	ATTACH_D4: { label: "ATTACH_D4", run: ({ host }) => host.pickAttachDisk(4) },
	ATTACH_D5: { label: "ATTACH_D5", run: ({ host }) => host.pickAttachDisk(5) },
	ATTACH_D6: { label: "ATTACH_D6", run: ({ host }) => host.pickAttachDisk(6) },
	ATTACH_D7: { label: "ATTACH_D7", run: ({ host }) => host.pickAttachDisk(7) },
	ATTACH_D8: { label: "ATTACH_D8", run: ({ host }) => host.pickAttachDisk(8) },
	// Detach the disk from a drive (live).
	DETACH_D1: { label: "DETACH_D1", run: ({ host }) => host.detachDisk(1) },
	DETACH_D2: { label: "DETACH_D2", run: ({ host }) => host.detachDisk(2) },
	DETACH_D3: { label: "DETACH_D3", run: ({ host }) => host.detachDisk(3) },
	DETACH_D4: { label: "DETACH_D4", run: ({ host }) => host.detachDisk(4) },
	DETACH_D5: { label: "DETACH_D5", run: ({ host }) => host.detachDisk(5) },
	DETACH_D6: { label: "DETACH_D6", run: ({ host }) => host.detachDisk(6) },
	DETACH_D7: { label: "DETACH_D7", run: ({ host }) => host.detachDisk(7) },
	DETACH_D8: { label: "DETACH_D8", run: ({ host }) => host.detachDisk(8) },
	// Drive power (only meaningful with a disk in): off parks the disk - the
	// image is kept, the bus hears nothing - and on reattaches it.
	TURN_ON_D1: {
		label: "TURN_ON_D1",
		run: ({ host }) => host.setDriveOn(1, true),
	},
	TURN_ON_D2: {
		label: "TURN_ON_D2",
		run: ({ host }) => host.setDriveOn(2, true),
	},
	TURN_ON_D3: {
		label: "TURN_ON_D3",
		run: ({ host }) => host.setDriveOn(3, true),
	},
	TURN_ON_D4: {
		label: "TURN_ON_D4",
		run: ({ host }) => host.setDriveOn(4, true),
	},
	TURN_ON_D5: {
		label: "TURN_ON_D5",
		run: ({ host }) => host.setDriveOn(5, true),
	},
	TURN_ON_D6: {
		label: "TURN_ON_D6",
		run: ({ host }) => host.setDriveOn(6, true),
	},
	TURN_ON_D7: {
		label: "TURN_ON_D7",
		run: ({ host }) => host.setDriveOn(7, true),
	},
	TURN_ON_D8: {
		label: "TURN_ON_D8",
		run: ({ host }) => host.setDriveOn(8, true),
	},
	TURN_OFF_D1: {
		label: "TURN_OFF_D1",
		run: ({ host }) => host.setDriveOn(1, false),
	},
	TURN_OFF_D2: {
		label: "TURN_OFF_D2",
		run: ({ host }) => host.setDriveOn(2, false),
	},
	TURN_OFF_D3: {
		label: "TURN_OFF_D3",
		run: ({ host }) => host.setDriveOn(3, false),
	},
	TURN_OFF_D4: {
		label: "TURN_OFF_D4",
		run: ({ host }) => host.setDriveOn(4, false),
	},
	TURN_OFF_D5: {
		label: "TURN_OFF_D5",
		run: ({ host }) => host.setDriveOn(5, false),
	},
	TURN_OFF_D6: {
		label: "TURN_OFF_D6",
		run: ({ host }) => host.setDriveOn(6, false),
	},
	TURN_OFF_D7: {
		label: "TURN_OFF_D7",
		run: ({ host }) => host.setDriveOn(7, false),
	},
	TURN_OFF_D8: {
		label: "TURN_OFF_D8",
		run: ({ host }) => host.setDriveOn(8, false),
	},
	TOGGLE_D1: { label: "TOGGLE_D1", run: ({ host }) => host.toggleDriveOn(1) },
	TOGGLE_D2: { label: "TOGGLE_D2", run: ({ host }) => host.toggleDriveOn(2) },
	TOGGLE_D3: { label: "TOGGLE_D3", run: ({ host }) => host.toggleDriveOn(3) },
	TOGGLE_D4: { label: "TOGGLE_D4", run: ({ host }) => host.toggleDriveOn(4) },
	TOGGLE_D5: { label: "TOGGLE_D5", run: ({ host }) => host.toggleDriveOn(5) },
	TOGGLE_D6: { label: "TOGGLE_D6", run: ({ host }) => host.toggleDriveOn(6) },
	TOGGLE_D7: { label: "TOGGLE_D7", run: ({ host }) => host.toggleDriveOn(7) },
	TOGGLE_D8: { label: "TOGGLE_D8", run: ({ host }) => host.toggleDriveOn(8) },
	// Rotate the drive slots by one, wrapping - up brings D2:'s disk to D1:
	// (the multi-disk "insert the next disk" gesture); down is the inverse.
	ROTATE_DRIVES_UP: {
		label: "ROTATE_DRIVES_UP",
		run: ({ host }) => host.rotateDrives("up"),
	},
	ROTATE_DRIVES_DOWN: {
		label: "ROTATE_DRIVES_DOWN",
		run: ({ host }) => host.rotateDrives("down"),
	},
	DETACH_ALL_DISKS: {
		label: "DETACH_ALL_DISKS",
		run: ({ host }) => host.detachAllDisks(),
	},
	// Attach/detach a cartridge (cold boots; leaves other media in place).
	ATTACH_CARTRIDGE: {
		label: "ATTACH_CARTRIDGE",
		run: ({ host }) => host.pickAttachCartridge(),
	},
	DETACH_CARTRIDGE: {
		label: "DETACH_CARTRIDGE",
		run: ({ host }) => host.detachCartridge(),
	},
	// Save the D1: disk (with any in-session writes) to a file.
	DOWNLOAD_D1: { label: "DOWNLOAD_D1", run: ({ host }) => host.downloadDisk() },
	SAVE_D1_TO_LIBRARY: {
		label: "SAVE_D1_TO_LIBRARY",
		run: ({ host }) => void host.saveD1ToLibrary(),
	},

	// Machine configuration. Each applies the change and reboots into it
	// immediately. (The menu's config form does its own stage/apply instead, so
	// the palette stays a one-shot surface.)
	SET_MODEL_400_800: {
		label: "SET_MODEL_400_800",
		run: ({ host }) => host.applyModel("400/800"),
	},
	SET_MODEL_1200XL: {
		label: "SET_MODEL_1200XL",
		run: ({ host }) => host.applyModel("1200xl"),
	},
	SET_MODEL_XLXE: {
		label: "SET_MODEL_XLXE",
		run: ({ host }) => host.applyModel("xl/xe"),
	},
	SET_MODEL_XEGS: {
		label: "SET_MODEL_XEGS",
		run: ({ host }) => host.applyModel("xegs"),
	},
	SET_TV_NTSC: {
		label: "SET_TV_NTSC",
		run: ({ host }) => host.applyTv("ntsc"),
	},
	SET_TV_PAL: { label: "SET_TV_PAL", run: ({ host }) => host.applyTv("pal") },
	SET_TV_TOGGLE: { label: "SET_TV_TOGGLE", run: ({ host }) => host.toggleTv() },
	BASIC_ENABLE: {
		label: "BASIC_ENABLE",
		run: ({ host }) => host.applyBasicDisabled(false),
	},
	BASIC_DISABLE: {
		label: "BASIC_DISABLE",
		run: ({ host }) => host.applyBasicDisabled(true),
	},
	BASIC_TOGGLE: {
		label: "BASIC_TOGGLE",
		run: ({ host }) => host.toggleBasic(),
	},

	// Regular key presses
	PRESS_L: press(0x00, "PRESS_L"),
	PRESS_J: press(0x01, "PRESS_J"),
	PRESS_SEMICOLON: press(0x02, "PRESS_SEMICOLON"),
	PRESS_F1: press(0x03, "PRESS_F1"),
	PRESS_F2: press(0x04, "PRESS_F2"),
	PRESS_K: press(0x05, "PRESS_K"),
	PRESS_PLUS: press(0x06, "PRESS_PLUS"),
	PRESS_ASTERISK: press(0x07, "PRESS_ASTERISK"),
	PRESS_O: press(0x08, "PRESS_O"),
	PRESS_CODE_09: press(0x09, "PRESS_CODE_09"),
	PRESS_P: press(0x0a, "PRESS_P"),
	PRESS_U: press(0x0b, "PRESS_U"),
	PRESS_RETURN: press(0x0c, "PRESS_RETURN"),
	PRESS_I: press(0x0d, "PRESS_I"),
	PRESS_MINUS: press(0x0e, "PRESS_MINUS"),
	PRESS_EQUALS: press(0x0f, "PRESS_EQUALS"),

	PRESS_V: press(0x10, "PRESS_V"),
	PRESS_HELP: press(0x11, "PRESS_HELP"),
	PRESS_C: press(0x12, "PRESS_C"),
	PRESS_F3: press(0x13, "PRESS_F3"),
	PRESS_F4: press(0x14, "PRESS_F4"),
	PRESS_B: press(0x15, "PRESS_B"),
	PRESS_X: press(0x16, "PRESS_X"),
	PRESS_Z: press(0x17, "PRESS_Z"),
	PRESS_4: press(0x18, "PRESS_4"),
	PRESS_CODE_19: press(0x19, "PRESS_CODE_19"),
	PRESS_3: press(0x1a, "PRESS_3"),
	PRESS_6: press(0x1b, "PRESS_6"),
	PRESS_ESC: press(0x1c, "PRESS_ESC"),
	PRESS_5: press(0x1d, "PRESS_5"),
	PRESS_2: press(0x1e, "PRESS_2"),
	PRESS_1: press(0x1f, "PRESS_1"),

	PRESS_COMMA: press(0x20, "PRESS_COMMA"),
	PRESS_SPACE: press(0x21, "PRESS_SPACE"),
	PRESS_PERIOD: press(0x22, "PRESS_PERIOD"),
	PRESS_N: press(0x23, "PRESS_N"),
	PRESS_CODE_24: press(0x24, "PRESS_CODE_24"),
	PRESS_M: press(0x25, "PRESS_M"),
	PRESS_SLASH: press(0x26, "PRESS_SLASH"),
	PRESS_INVERSE_VIDEO: press(0x27, "PRESS_INVERSE_VIDEO"),
	PRESS_R: press(0x28, "PRESS_R"),
	PRESS_CODE_29: press(0x29, "PRESS_CODE_29"),
	PRESS_E: press(0x2a, "PRESS_E"),
	PRESS_Y: press(0x2b, "PRESS_Y"),
	PRESS_TAB: press(0x2c, "PRESS_TAB"),
	PRESS_T: press(0x2d, "PRESS_T"),
	PRESS_W: press(0x2e, "PRESS_W"),
	PRESS_Q: press(0x2f, "PRESS_Q"),

	PRESS_9: press(0x30, "PRESS_9"),
	PRESS_CODE_31: press(0x31, "PRESS_CODE_31"),
	PRESS_0: press(0x32, "PRESS_0"),
	PRESS_7: press(0x33, "PRESS_7"),
	PRESS_BACKSPACE: press(0x34, "PRESS_BACKSPACE"),
	PRESS_8: press(0x35, "PRESS_8"),
	PRESS_LESS_THAN: press(0x36, "PRESS_LESS_THAN"),
	PRESS_GREATER_THAN: press(0x37, "PRESS_GREATER_THAN"),
	PRESS_F: press(0x38, "PRESS_F"),
	PRESS_H: press(0x39, "PRESS_H"),
	PRESS_D: press(0x3a, "PRESS_D"),
	PRESS_CODE_3B: press(0x3b, "PRESS_CODE_3B"),
	PRESS_CAPS: press(0x3c, "PRESS_CAPS"),
	PRESS_G: press(0x3d, "PRESS_G"),
	PRESS_S: press(0x3e, "PRESS_S"),
	PRESS_A: press(0x3f, "PRESS_A"),

	PRESS_SHIFT_L: press(0x40, "PRESS_SHIFT_L"),
	PRESS_SHIFT_J: press(0x41, "PRESS_SHIFT_J"),
	PRESS_SHIFT_SEMICOLON: press(0x42, "PRESS_SHIFT_SEMICOLON"),
	PRESS_SHIFT_F1: press(0x43, "PRESS_SHIFT_F1"),
	PRESS_SHIFT_F2: press(0x44, "PRESS_SHIFT_F2"),
	PRESS_SHIFT_K: press(0x45, "PRESS_SHIFT_K"),
	PRESS_SHIFT_PLUS: press(0x46, "PRESS_SHIFT_PLUS"),
	PRESS_SHIFT_ASTERISK: press(0x47, "PRESS_SHIFT_ASTERISK"),
	PRESS_SHIFT_O: press(0x48, "PRESS_SHIFT_O"),
	PRESS_SHIFT_CODE_09: press(0x49, "PRESS_SHIFT_CODE_09"),
	PRESS_SHIFT_P: press(0x4a, "PRESS_SHIFT_P"),
	PRESS_SHIFT_U: press(0x4b, "PRESS_SHIFT_U"),
	PRESS_SHIFT_RETURN: press(0x4c, "PRESS_SHIFT_RETURN"),
	PRESS_SHIFT_I: press(0x4d, "PRESS_SHIFT_I"),
	PRESS_SHIFT_MINUS: press(0x4e, "PRESS_SHIFT_MINUS"),
	PRESS_SHIFT_EQUALS: press(0x4f, "PRESS_SHIFT_EQUALS"),

	PRESS_SHIFT_V: press(0x50, "PRESS_SHIFT_V"),
	PRESS_SHIFT_HELP: press(0x51, "PRESS_SHIFT_HELP"),
	PRESS_SHIFT_C: press(0x52, "PRESS_SHIFT_C"),
	PRESS_SHIFT_F3: press(0x53, "PRESS_SHIFT_F3"),
	PRESS_SHIFT_F4: press(0x54, "PRESS_SHIFT_F4"),
	PRESS_SHIFT_B: press(0x55, "PRESS_SHIFT_B"),
	PRESS_SHIFT_X: press(0x56, "PRESS_SHIFT_X"),
	PRESS_SHIFT_Z: press(0x57, "PRESS_SHIFT_Z"),
	PRESS_SHIFT_4: press(0x58, "PRESS_SHIFT_4"),
	PRESS_SHIFT_CODE_19: press(0x59, "PRESS_SHIFT_CODE_19"),
	PRESS_SHIFT_3: press(0x5a, "PRESS_SHIFT_3"),
	PRESS_SHIFT_6: press(0x5b, "PRESS_SHIFT_6"),
	PRESS_SHIFT_ESC: press(0x5c, "PRESS_SHIFT_ESC"),
	PRESS_SHIFT_5: press(0x5d, "PRESS_SHIFT_5"),
	PRESS_SHIFT_2: press(0x5e, "PRESS_SHIFT_2"),
	PRESS_SHIFT_1: press(0x5f, "PRESS_SHIFT_1"),

	PRESS_SHIFT_COMMA: press(0x60, "PRESS_SHIFT_COMMA"),
	PRESS_SHIFT_SPACE: press(0x61, "PRESS_SHIFT_SPACE"),
	PRESS_SHIFT_PERIOD: press(0x62, "PRESS_SHIFT_PERIOD"),
	PRESS_SHIFT_N: press(0x63, "PRESS_SHIFT_N"),
	PRESS_SHIFT_CODE_24: press(0x64, "PRESS_SHIFT_CODE_24"),
	PRESS_SHIFT_M: press(0x65, "PRESS_SHIFT_M"),
	PRESS_SHIFT_SLASH: press(0x66, "PRESS_SHIFT_SLASH"),
	PRESS_SHIFT_INVERSE_VIDEO: press(0x67, "PRESS_SHIFT_INVERSE_VIDEO"),
	PRESS_SHIFT_R: press(0x68, "PRESS_SHIFT_R"),
	PRESS_SHIFT_CODE_29: press(0x69, "PRESS_SHIFT_CODE_29"),
	PRESS_SHIFT_E: press(0x6a, "PRESS_SHIFT_E"),
	PRESS_SHIFT_Y: press(0x6b, "PRESS_SHIFT_Y"),
	PRESS_SHIFT_TAB: press(0x6c, "PRESS_SHIFT_TAB"),
	PRESS_SHIFT_T: press(0x6d, "PRESS_SHIFT_T"),
	PRESS_SHIFT_W: press(0x6e, "PRESS_SHIFT_W"),
	PRESS_SHIFT_Q: press(0x6f, "PRESS_SHIFT_Q"),

	PRESS_SHIFT_9: press(0x70, "PRESS_SHIFT_9"),
	PRESS_SHIFT_CODE_31: press(0x71, "PRESS_SHIFT_CODE_31"),
	PRESS_SHIFT_0: press(0x72, "PRESS_SHIFT_0"),
	PRESS_SHIFT_7: press(0x73, "PRESS_SHIFT_7"),
	PRESS_SHIFT_BACKSPACE: press(0x74, "PRESS_SHIFT_BACKSPACE"),
	PRESS_SHIFT_8: press(0x75, "PRESS_SHIFT_8"),
	PRESS_SHIFT_LESS_THAN: press(0x76, "PRESS_SHIFT_LESS_THAN"),
	PRESS_SHIFT_GREATER_THAN: press(0x77, "PRESS_SHIFT_GREATER_THAN"),
	PRESS_SHIFT_F: press(0x78, "PRESS_SHIFT_F"),
	PRESS_SHIFT_H: press(0x79, "PRESS_SHIFT_H"),
	PRESS_SHIFT_D: press(0x7a, "PRESS_SHIFT_D"),
	PRESS_SHIFT_CODE_3B: press(0x7b, "PRESS_SHIFT_CODE_3B"),
	PRESS_SHIFT_CAPS: press(0x7c, "PRESS_SHIFT_CAPS"),
	PRESS_SHIFT_G: press(0x7d, "PRESS_SHIFT_G"),
	PRESS_SHIFT_S: press(0x7e, "PRESS_SHIFT_S"),
	PRESS_SHIFT_A: press(0x7f, "PRESS_SHIFT_A"),

	PRESS_CONTROL_L: press(0x80, "PRESS_CONTROL_L"),
	PRESS_CONTROL_J: press(0x81, "PRESS_CONTROL_J"),
	PRESS_CONTROL_SEMICOLON: press(0x82, "PRESS_CONTROL_SEMICOLON"),
	PRESS_CONTROL_F1: press(0x83, "PRESS_CONTROL_F1"),
	PRESS_CONTROL_F2: press(0x84, "PRESS_CONTROL_F2"),
	PRESS_CONTROL_K: press(0x85, "PRESS_CONTROL_K"),
	PRESS_CONTROL_PLUS: press(0x86, "PRESS_CONTROL_PLUS"),
	PRESS_CONTROL_ASTERISK: press(0x87, "PRESS_CONTROL_ASTERISK"),
	PRESS_CONTROL_O: press(0x88, "PRESS_CONTROL_O"),
	PRESS_CONTROL_CODE_89: press(0x89, "PRESS_CONTROL_CODE_89"),
	PRESS_CONTROL_P: press(0x8a, "PRESS_CONTROL_P"),
	PRESS_CONTROL_U: press(0x8b, "PRESS_CONTROL_U"),
	PRESS_CONTROL_RETURN: press(0x8c, "PRESS_CONTROL_RETURN"),
	PRESS_CONTROL_I: press(0x8d, "PRESS_CONTROL_I"),
	PRESS_CONTROL_MINUS: press(0x8e, "PRESS_CONTROL_MINUS"),
	PRESS_CONTROL_EQUALS: press(0x8f, "PRESS_CONTROL_EQUALS"),

	PRESS_CONTROL_V: press(0x90, "PRESS_CONTROL_V"),
	PRESS_CONTROL_HELP: press(0x91, "PRESS_CONTROL_HELP"),
	PRESS_CONTROL_C: press(0x92, "PRESS_CONTROL_C"),
	PRESS_CONTROL_F3: press(0x93, "PRESS_CONTROL_F3"),
	PRESS_CONTROL_F4: press(0x94, "PRESS_CONTROL_F4"),
	PRESS_CONTROL_B: press(0x95, "PRESS_CONTROL_B"),
	PRESS_CONTROL_X: press(0x96, "PRESS_CONTROL_X"),
	PRESS_CONTROL_Z: press(0x97, "PRESS_CONTROL_Z"),
	PRESS_CONTROL_4: press(0x98, "PRESS_CONTROL_4"),
	PRESS_CONTROL_CODE_99: press(0x99, "PRESS_CONTROL_CODE_99"),
	PRESS_CONTROL_3: press(0x9a, "PRESS_CONTROL_3"),
	PRESS_CONTROL_6: press(0x9b, "PRESS_CONTROL_6"),
	PRESS_CONTROL_ESC: press(0x9c, "PRESS_CONTROL_ESC"),
	PRESS_CONTROL_5: press(0x9d, "PRESS_CONTROL_5"),
	PRESS_CONTROL_2: press(0x9e, "PRESS_CONTROL_2"),
	PRESS_CONTROL_1: press(0x9f, "PRESS_CONTROL_1"),

	PRESS_CONTROL_COMMA: press(0xa0, "PRESS_CONTROL_COMMA"),
	PRESS_CONTROL_SPACE: press(0xa1, "PRESS_CONTROL_SPACE"),
	PRESS_CONTROL_PERIOD: press(0xa2, "PRESS_CONTROL_PERIOD"),
	PRESS_CONTROL_N: press(0xa3, "PRESS_CONTROL_N"),
	PRESS_CONTROL_CODE_A4: press(0xa4, "PRESS_CONTROL_CODE_A4"),
	PRESS_CONTROL_M: press(0xa5, "PRESS_CONTROL_M"),
	PRESS_CONTROL_SLASH: press(0xa6, "PRESS_CONTROL_SLASH"),
	PRESS_CONTROL_INVERSE_VIDEO: press(0xa7, "PRESS_CONTROL_INVERSE_VIDEO"),
	PRESS_CONTROL_R: press(0xa8, "PRESS_CONTROL_R"),
	PRESS_CONTROL_CODE_A9: press(0xa9, "PRESS_CONTROL_CODE_A9"),
	PRESS_CONTROL_E: press(0xaa, "PRESS_CONTROL_E"),
	PRESS_CONTROL_Y: press(0xab, "PRESS_CONTROL_Y"),
	PRESS_CONTROL_TAB: press(0xac, "PRESS_CONTROL_TAB"),
	PRESS_CONTROL_T: press(0xad, "PRESS_CONTROL_T"),
	PRESS_CONTROL_W: press(0xae, "PRESS_CONTROL_W"),
	PRESS_CONTROL_Q: press(0xaf, "PRESS_CONTROL_Q"),

	PRESS_CONTROL_9: press(0xb0, "PRESS_CONTROL_9"),
	PRESS_CONTROL_CODE_B1: press(0xb1, "PRESS_CONTROL_CODE_B1"),
	PRESS_CONTROL_0: press(0xb2, "PRESS_CONTROL_0"),
	PRESS_CONTROL_7: press(0xb3, "PRESS_CONTROL_7"),
	PRESS_CONTROL_BACKSPACE: press(0xb4, "PRESS_CONTROL_BACKSPACE"),
	PRESS_CONTROL_8: press(0xb5, "PRESS_CONTROL_8"),
	PRESS_CONTROL_LESS_THAN: press(0xb6, "PRESS_CONTROL_LESS_THAN"),
	PRESS_CONTROL_GREATER_THAN: press(0xb7, "PRESS_CONTROL_GREATER_THAN"),
	PRESS_CONTROL_F: press(0xb8, "PRESS_CONTROL_F"),
	PRESS_CONTROL_H: press(0xb9, "PRESS_CONTROL_H"),
	PRESS_CONTROL_D: press(0xba, "PRESS_CONTROL_D"),
	PRESS_CONTROL_CODE_BB: press(0xbb, "PRESS_CONTROL_CODE_BB"),
	PRESS_CONTROL_CAPS: press(0xbc, "PRESS_CONTROL_CAPS"),
	PRESS_CONTROL_G: press(0xbd, "PRESS_CONTROL_G"),
	PRESS_CONTROL_S: press(0xbe, "PRESS_CONTROL_S"),
	PRESS_CONTROL_A: press(0xbf, "PRESS_CONTROL_A"),

	PRESS_CONTROL_SHIFT_L: press(0xc0, "PRESS_CONTROL_SHIFT_L"),
	PRESS_CONTROL_SHIFT_J: press(0xc1, "PRESS_CONTROL_SHIFT_J"),
	PRESS_CONTROL_SHIFT_SEMICOLON: press(0xc2, "PRESS_CONTROL_SHIFT_SEMICOLON"),
	PRESS_CONTROL_SHIFT_F1: press(0xc3, "PRESS_CONTROL_SHIFT_F1"),
	PRESS_CONTROL_SHIFT_F2: press(0xc4, "PRESS_CONTROL_SHIFT_F2"),
	PRESS_CONTROL_SHIFT_K: press(0xc5, "PRESS_CONTROL_SHIFT_K"),
	PRESS_CONTROL_SHIFT_PLUS: press(0xc6, "PRESS_CONTROL_SHIFT_PLUS"),
	PRESS_CONTROL_SHIFT_ASTERISK: press(0xc7, "PRESS_CONTROL_SHIFT_ASTERISK"),
	PRESS_CONTROL_SHIFT_O: press(0xc8, "PRESS_CONTROL_SHIFT_O"),
	PRESS_CONTROL_SHIFT_CODE_09: press(0xc9, "PRESS_CONTROL_SHIFT_CODE_09"),
	PRESS_CONTROL_SHIFT_P: press(0xca, "PRESS_CONTROL_SHIFT_P"),
	PRESS_CONTROL_SHIFT_U: press(0xcb, "PRESS_CONTROL_SHIFT_U"),
	PRESS_CONTROL_SHIFT_RETURN: press(0xcc, "PRESS_CONTROL_SHIFT_RETURN"),
	PRESS_CONTROL_SHIFT_I: press(0xcd, "PRESS_CONTROL_SHIFT_I"),
	PRESS_CONTROL_SHIFT_MINUS: press(0xce, "PRESS_CONTROL_SHIFT_MINUS"),
	PRESS_CONTROL_SHIFT_EQUALS: press(0xcf, "PRESS_CONTROL_SHIFT_EQUALS"),

	PRESS_CONTROL_SHIFT_V: press(0xd0, "PRESS_CONTROL_SHIFT_V"),
	PRESS_CONTROL_SHIFT_HELP: press(0xd1, "PRESS_CONTROL_SHIFT_HELP"),
	PRESS_CONTROL_SHIFT_C: press(0xd2, "PRESS_CONTROL_SHIFT_C"),
	PRESS_CONTROL_SHIFT_F3: press(0xd3, "PRESS_CONTROL_SHIFT_F3"),
	PRESS_CONTROL_SHIFT_F4: press(0xd4, "PRESS_CONTROL_SHIFT_F4"),
	PRESS_CONTROL_SHIFT_B: press(0xd5, "PRESS_CONTROL_SHIFT_B"),
	PRESS_CONTROL_SHIFT_X: press(0xd6, "PRESS_CONTROL_SHIFT_X"),
	PRESS_CONTROL_SHIFT_Z: press(0xd7, "PRESS_CONTROL_SHIFT_Z"),
	PRESS_CONTROL_SHIFT_4: press(0xd8, "PRESS_CONTROL_SHIFT_4"),
	PRESS_CONTROL_SHIFT_CODE_19: press(0xd9, "PRESS_CONTROL_SHIFT_CODE_19"),
	PRESS_CONTROL_SHIFT_3: press(0xda, "PRESS_CONTROL_SHIFT_3"),
	PRESS_CONTROL_SHIFT_6: press(0xdb, "PRESS_CONTROL_SHIFT_6"),
	PRESS_CONTROL_SHIFT_ESC: press(0xdc, "PRESS_CONTROL_SHIFT_ESC"),
	PRESS_CONTROL_SHIFT_5: press(0xdd, "PRESS_CONTROL_SHIFT_5"),
	PRESS_CONTROL_SHIFT_2: press(0xde, "PRESS_CONTROL_SHIFT_2"),
	PRESS_CONTROL_SHIFT_1: press(0xdf, "PRESS_CONTROL_SHIFT_1"),

	PRESS_CONTROL_SHIFT_COMMA: press(0xe0, "PRESS_CONTROL_SHIFT_COMMA"),
	PRESS_CONTROL_SHIFT_SPACE: press(0xe1, "PRESS_CONTROL_SHIFT_SPACE"),
	PRESS_CONTROL_SHIFT_PERIOD: press(0xe2, "PRESS_CONTROL_SHIFT_PERIOD"),
	PRESS_CONTROL_SHIFT_N: press(0xe3, "PRESS_CONTROL_SHIFT_N"),
	PRESS_CONTROL_SHIFT_CODE_24: press(0xe4, "PRESS_CONTROL_SHIFT_CODE_24"),
	PRESS_CONTROL_SHIFT_M: press(0xe5, "PRESS_CONTROL_SHIFT_M"),
	PRESS_CONTROL_SHIFT_SLASH: press(0xe6, "PRESS_CONTROL_SHIFT_SLASH"),
	PRESS_CONTROL_SHIFT_INVERSE_VIDEO: press(
		0xe7,
		"PRESS_CONTROL_SHIFT_INVERSE_VIDEO",
	),
	PRESS_CONTROL_SHIFT_R: press(0xe8, "PRESS_CONTROL_SHIFT_R"),
	PRESS_CONTROL_SHIFT_CODE_29: press(0xe9, "PRESS_CONTROL_SHIFT_CODE_29"),
	PRESS_CONTROL_SHIFT_E: press(0xea, "PRESS_CONTROL_SHIFT_E"),
	PRESS_CONTROL_SHIFT_Y: press(0xeb, "PRESS_CONTROL_SHIFT_Y"),
	PRESS_CONTROL_SHIFT_TAB: press(0xec, "PRESS_CONTROL_SHIFT_TAB"),
	PRESS_CONTROL_SHIFT_T: press(0xed, "PRESS_CONTROL_SHIFT_T"),
	PRESS_CONTROL_SHIFT_W: press(0xee, "PRESS_CONTROL_SHIFT_W"),
	PRESS_CONTROL_SHIFT_Q: press(0xef, "PRESS_CONTROL_SHIFT_Q"),

	PRESS_CONTROL_SHIFT_9: press(0xf0, "PRESS_CONTROL_SHIFT_9"),
	PRESS_CONTROL_SHIFT_CODE_31: press(0xf1, "PRESS_CONTROL_SHIFT_CODE_31"),
	PRESS_CONTROL_SHIFT_0: press(0xf2, "PRESS_CONTROL_SHIFT_0"),
	PRESS_CONTROL_SHIFT_7: press(0xf3, "PRESS_CONTROL_SHIFT_7"),
	PRESS_CONTROL_SHIFT_BACKSPACE: press(0xf4, "PRESS_CONTROL_SHIFT_BACKSPACE"),
	PRESS_CONTROL_SHIFT_8: press(0xf5, "PRESS_CONTROL_SHIFT_8"),
	PRESS_CONTROL_SHIFT_LESS_THAN: press(0xf6, "PRESS_CONTROL_SHIFT_LESS_THAN"),
	PRESS_CONTROL_SHIFT_GREATER_THAN: press(
		0xf7,
		"PRESS_CONTROL_SHIFT_GREATER_THAN",
	),
	PRESS_CONTROL_SHIFT_F: press(0xf8, "PRESS_CONTROL_SHIFT_F"),
	PRESS_CONTROL_SHIFT_H: press(0xf9, "PRESS_CONTROL_SHIFT_H"),
	PRESS_CONTROL_SHIFT_D: press(0xfa, "PRESS_CONTROL_SHIFT_D"),
	PRESS_CONTROL_SHIFT_CODE_3B: press(0xfb, "PRESS_CONTROL_SHIFT_CODE_3B"),
	PRESS_CONTROL_SHIFT_CAPS: press(0xfc, "PRESS_CONTROL_SHIFT_CAPS"),
	PRESS_CONTROL_SHIFT_G: press(0xfd, "PRESS_CONTROL_SHIFT_G"),
	PRESS_CONTROL_SHIFT_S: press(0xfe, "PRESS_CONTROL_SHIFT_S"),
	PRESS_CONTROL_SHIFT_A: press(0xff, "PRESS_CONTROL_SHIFT_A"),

	PRESS_SHIFT: {
		label: "PRESS_SHIFT",
		run: ({ host }) => host.setShiftKey(true),
		release: ({ host }) => host.setShiftKey(false),
	},

	PRESS_RESET: {
		label: "PRESS_RESET",
		run: ({ emulator }) => (emulator.machine.console.reset = true),
		release: ({ emulator }) => (emulator.machine.console.reset = false),
	},

	// Console buttons
	PRESS_OPTION: {
		label: "PRESS_OPTION",
		run: ({ emulator }) => (emulator.machine.console.option = true),
		release: ({ emulator }) => (emulator.machine.console.option = false),
	},
	PRESS_SELECT: {
		label: "PRESS_SELECT",
		run: ({ emulator }) => (emulator.machine.console.select = true),
		release: ({ emulator }) => (emulator.machine.console.select = false),
	},
	PRESS_START: {
		label: "PRESS_START",
		run: ({ emulator }) => (emulator.machine.console.start = true),
		release: ({ emulator }) => (emulator.machine.console.start = false),
	},

	// Break - sustained like Shift: the IRQ fires on the down edge only, but the
	// held line is observable through the matrix, so key-up releases it.
	PRESS_BREAK: {
		label: "PRESS_BREAK",
		run: ({ host }) => host.setBreakKey(true),
		release: ({ host }) => host.setBreakKey(false),
	},

	// Joysticks 0-3, one set per port (directions + trigger). Ports 2/3 are the
	// 800's extra jacks; the machine no-ops them on the XL/XE.
	PRESS_JOY0_UP: joyDir(0, 1, "PRESS_JOY0_UP"),
	PRESS_JOY0_DOWN: joyDir(0, 2, "PRESS_JOY0_DOWN"),
	PRESS_JOY0_LEFT: joyDir(0, 4, "PRESS_JOY0_LEFT"),
	PRESS_JOY0_RIGHT: joyDir(0, 8, "PRESS_JOY0_RIGHT"),
	PRESS_JOY0_TRIGGER: joyTrigger(0, "PRESS_JOY0_TRIGGER"),

	PRESS_JOY1_UP: joyDir(1, 1, "PRESS_JOY1_UP"),
	PRESS_JOY1_DOWN: joyDir(1, 2, "PRESS_JOY1_DOWN"),
	PRESS_JOY1_LEFT: joyDir(1, 4, "PRESS_JOY1_LEFT"),
	PRESS_JOY1_RIGHT: joyDir(1, 8, "PRESS_JOY1_RIGHT"),
	PRESS_JOY1_TRIGGER: joyTrigger(1, "PRESS_JOY1_TRIGGER"),

	PRESS_JOY2_UP: joyDir(2, 1, "PRESS_JOY2_UP"),
	PRESS_JOY2_DOWN: joyDir(2, 2, "PRESS_JOY2_DOWN"),
	PRESS_JOY2_LEFT: joyDir(2, 4, "PRESS_JOY2_LEFT"),
	PRESS_JOY2_RIGHT: joyDir(2, 8, "PRESS_JOY2_RIGHT"),
	PRESS_JOY2_TRIGGER: joyTrigger(2, "PRESS_JOY2_TRIGGER"),

	PRESS_JOY3_UP: joyDir(3, 1, "PRESS_JOY3_UP"),
	PRESS_JOY3_DOWN: joyDir(3, 2, "PRESS_JOY3_DOWN"),
	PRESS_JOY3_LEFT: joyDir(3, 4, "PRESS_JOY3_LEFT"),
	PRESS_JOY3_RIGHT: joyDir(3, 8, "PRESS_JOY3_RIGHT"),
	PRESS_JOY3_TRIGGER: joyTrigger(3, "PRESS_JOY3_TRIGGER"),
} satisfies Record<string, CommandSpec>;

let traceCommands = false;

/** Toggle command-dispatch logging (a dev-console aid). Off by default. */
export function setCommandTrace(enabled: boolean): void {
	traceCommands = enabled;
}

for (const key of Object.keys(commands) as Command[]) {
	const spec: CommandSpec = commands[key];
	const run = spec.run;
	spec.run = (ctx) => {
		// eslint-disable-next-line no-console -- command tracing is a debug aid
		if (traceCommands) console.log("COMMAND", key);
		run(ctx);
	};
	const release = spec.release;
	if (release) {
		spec.release = (ctx) => {
			// eslint-disable-next-line no-console -- command tracing is a debug aid
			if (traceCommands) console.log("COMMAND", key, "(release)");
			release(ctx);
		};
	}
}

/** Every bindable command name - the key-binding and palette surface. */
export type Command = keyof typeof commands;

/** The display label for a command (its current-language string). */
export function labelOf(command: Command): string {
	return labels[commands[command].label];
}

/** A label's searchable text: a trailing "[...]" annotation (e.g. "[reboots]") is
 *  a reader's aside, shown but not matched by search. */
export function searchLabel(command: Command): string {
	return labelOf(command).replace(/\s*\[[^\]]*\]$/u, "");
}

/** A command's release half (key up), or undefined for a press-only command. */
export function releaseOf(
	command: Command,
): ((ctx: CommandContext) => void) | undefined {
	return (commands[command] as CommandSpec).release;
}

/** The POKEY keyboard-matrix commands (one shared release register). */
export const MATRIX_COMMANDS: ReadonlySet<Command> = new Set(
	(Object.keys(commands) as Command[]).filter(
		(key) => (commands[key] as CommandSpec).matrix,
	),
);

/**
 * The commands the palette lists, sorted alphabetically by label - its default
 * (empty-query) order. Everything is listed (the palette is the fallback for any
 * unavailable binding) unless a command opts out with `palette: false`.
 * (Recently-used commands will float to the top later.)
 */
export const paletteCommands: readonly Command[] = (
	Object.keys(commands) as Command[]
)
	.filter((command) => (commands[command] as CommandSpec).palette !== false)
	.sort((a, b) => labelOf(a).localeCompare(labelOf(b)));

/*
"Toggle machine type (400/800 / XL/XE)"
"Set RAM size to 16K"
"Set RAM size to 32K"
"Set RAM size to 48K"
"Set RAM size to 64K"
"Set RAM size to 128K"
"Set RAM size to 320K"
"Set RAM size to 576K"
"Set RAM size to 1088K"
"Toggle TV standard (NTSC/PAL)"

"Set machine configuration to Atari 400 (400/800, 16K)"
"Set machine configuration to Atari 800 (400/800, 48K)"
"Set machine configuration to Atari 1200XL (XL/XE, 64K)"
"Set machine configuration to Atari 600XL (XL/XE, 16K)"
"Set machine configuration to Atari 800XL/65XE/800XE (XL/XE, 64K)"
"Set machine configuration to Atari 130XE (XL/XE, 128K)"
"Set machine configuration to Atari XEGS (XL/XE, 64K)"

*/
