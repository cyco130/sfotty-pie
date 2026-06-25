import type { Emulator } from "./emulator.ts";
import type { EmulatorHost } from "./host.ts";
import { labels, type LabelKey } from "./messages.ts";

export interface CommandContext {
	/** The live machine — for the key-matrix and joystick commands. */
	emulator: Emulator;
	/** The application host — for app-level commands (audio, pause, menu). */
	host: EmulatorHost;
}

/** A command: a static label key (into {@link labels}) plus its action. */
interface CommandSpec {
	label: LabelKey;
	run: (ctx: CommandContext) => void;
}

/** Factory for the POKEY matrix key presses, which differ only by key code. */
const press = (code: number, label: LabelKey): CommandSpec => ({
	label,
	run: ({ emulator }) => emulator.machine.pokeyKeyDown(code),
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

	// The menu sidebar.
	MENU_TOGGLE: {
		label: "MENU_TOGGLE",
		run: ({ host }) => host.togglePanel("menu"),
	},

	// Full-screen the whole app (chrome included), so the on-screen controls
	// stay reachable. A no-op-safe toggle; also bound to a double-click on the
	// screen.
	TOGGLE_FULLSCREEN: {
		label: "TOGGLE_FULLSCREEN",
		run: ({ host }) => host.toggleFullscreen(),
	},

	// Boot a file as a fresh machine image (opens the file picker).
	BOOT_IMAGE: { label: "BOOT_IMAGE", run: ({ host }) => host.pickBootImage() },

	// Attach a disk to D1: of the running machine (no reboot, BASIC kept).
	ATTACH_D1: { label: "ATTACH_D1", run: ({ host }) => host.pickAttachDisk() },
	// Detach the disk from D1: (live).
	DETACH_D1: { label: "DETACH_D1", run: ({ host }) => host.detachDisk() },
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

	RELEASE_POKEY_KEY: {
		label: "RELEASE_POKEY_KEY",
		run: ({ emulator }) => emulator.machine.pokeyKeyUp(),
	},

	PRESS_SHIFT: {
		label: "PRESS_SHIFT",
		run: ({ emulator }) => emulator.machine.shiftKeyDown(),
	},
	RELEASE_SHIFT: {
		label: "RELEASE_SHIFT",
		run: ({ emulator }) => emulator.machine.shiftKeyUp(),
	},

	PRESS_RESET: {
		label: "PRESS_RESET",
		run: ({ emulator }) => emulator.machine.resetButtonDown(),
	},
	RELEASE_RESET: {
		label: "RELEASE_RESET",
		run: ({ emulator }) => emulator.machine.resetButtonUp(),
	},

	// Console buttons
	PRESS_OPTION: {
		label: "PRESS_OPTION",
		run: ({ emulator }) => emulator.machine.consoleKeyDown(4),
	},
	RELEASE_OPTION: {
		label: "RELEASE_OPTION",
		run: ({ emulator }) => emulator.machine.consoleKeyUp(4),
	},
	PRESS_SELECT: {
		label: "PRESS_SELECT",
		run: ({ emulator }) => emulator.machine.consoleKeyDown(2),
	},
	RELEASE_SELECT: {
		label: "RELEASE_SELECT",
		run: ({ emulator }) => emulator.machine.consoleKeyUp(2),
	},
	PRESS_START: {
		label: "PRESS_START",
		run: ({ emulator }) => emulator.machine.consoleKeyDown(1),
	},
	RELEASE_START: {
		label: "RELEASE_START",
		run: ({ emulator }) => emulator.machine.consoleKeyUp(1),
	},

	// Break
	PRESS_BREAK: {
		label: "PRESS_BREAK",
		run: ({ emulator }) => emulator.machine.breakKeyDown(),
	},

	// Joystick 0 (direction masks: 1 = up, 2 = down, 4 = left, 8 = right)
	PRESS_JOY0_UP: {
		label: "PRESS_JOY0_UP",
		run: ({ emulator }) => emulator.machine.joystickDown(0, 1),
	},
	RELEASE_JOY0_UP: {
		label: "RELEASE_JOY0_UP",
		run: ({ emulator }) => emulator.machine.joystickUp(0, 1),
	},
	PRESS_JOY0_DOWN: {
		label: "PRESS_JOY0_DOWN",
		run: ({ emulator }) => emulator.machine.joystickDown(0, 2),
	},
	RELEASE_JOY0_DOWN: {
		label: "RELEASE_JOY0_DOWN",
		run: ({ emulator }) => emulator.machine.joystickUp(0, 2),
	},
	PRESS_JOY0_LEFT: {
		label: "PRESS_JOY0_LEFT",
		run: ({ emulator }) => emulator.machine.joystickDown(0, 4),
	},
	RELEASE_JOY0_LEFT: {
		label: "RELEASE_JOY0_LEFT",
		run: ({ emulator }) => emulator.machine.joystickUp(0, 4),
	},
	PRESS_JOY0_RIGHT: {
		label: "PRESS_JOY0_RIGHT",
		run: ({ emulator }) => emulator.machine.joystickDown(0, 8),
	},
	RELEASE_JOY0_RIGHT: {
		label: "RELEASE_JOY0_RIGHT",
		run: ({ emulator }) => emulator.machine.joystickUp(0, 8),
	},
	PRESS_JOY0_TRIGGER: {
		label: "PRESS_JOY0_TRIGGER",
		run: ({ emulator }) => emulator.machine.joystickTriggerDown(0),
	},
	RELEASE_JOY0_TRIGGER: {
		label: "RELEASE_JOY0_TRIGGER",
		run: ({ emulator }) => emulator.machine.joystickTriggerUp(0),
	},

	// TODO: settings commands (TOGGLE_KEYBOARD_LAYOUT_MODE and friends) come
	// back when raw mode and an options store exist.
} satisfies Record<string, CommandSpec>;

let traceCommands = false;

/** Toggle command-dispatch logging (a dev-console aid). Off by default. */
export function setCommandTrace(enabled: boolean): void {
	traceCommands = enabled;
}

for (const key of Object.keys(commands) as Command[]) {
	const spec = commands[key];
	const run = spec.run;
	spec.run = (ctx) => {
		// eslint-disable-next-line no-console -- command tracing is a debug aid
		if (traceCommands) console.log("COMMAND", key);
		run(ctx);
	};
}

/** Every bindable command name — the key-binding and palette surface. */
export type Command = keyof typeof commands;

/** The display label for a command (its current-language string). */
export function labelOf(command: Command): string {
	return labels[commands[command].label];
}

/**
 * Every command the palette lists, sorted alphabetically by label — its
 * default (empty-query) order. (Recently-used commands will float to the top
 * later.)
 */
export const paletteCommands: readonly Command[] = (
	Object.keys(commands) as Command[]
).sort((a, b) => labelOf(a).localeCompare(labelOf(b)));

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
