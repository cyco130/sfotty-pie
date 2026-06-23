import type { Emulator } from "./emulator.ts";
import type { EmulatorHost } from "./host.ts";

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
		run: ({ emulator }) => emulator.coldStart(),
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
	SET_TYPE_800: {
		label: "SET_TYPE_800",
		run: ({ host }) => host.applyModel("800"),
	},
	SET_TYPE_800XL: {
		label: "SET_TYPE_800XL",
		run: ({ host }) => host.applyModel("800XL"),
	},
	SET_TYPE_130XE: {
		label: "SET_TYPE_130XE",
		run: ({ host }) => host.applyModel("130XE"),
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

/**
 * The flat label catalog. Today it is the English strings; it is shaped to
 * become a per-language translation table later (commands reference these keys,
 * not the strings). No interpolation yet — add it if/when a label needs it.
 */
export const labels = {
	POWER_CYCLE: "Power cycle (cold reset)",
	PAUSE: "Pause emulation",
	RESUME: "Resume emulation",
	TOGGLE_PAUSE: "Pause or resume emulation",
	TURBO_MODE_ENABLE: "Enable turbo mode (run unthrottled, muted)",
	TURBO_MODE_DISABLE: "Disable turbo mode (return to real-time speed)",
	TURBO_MODE_TOGGLE: "Toggle turbo mode",
	AUDIO_MUTE: "Mute audio",
	AUDIO_UNMUTE: "Unmute audio",
	AUDIO_TOGGLE: "Toggle audio (enable, then mute/unmute)",
	MENU_TOGGLE: "Toggle the menu",
	BOOT_IMAGE: "Boot a disk, cartridge, or executable…",
	ATTACH_D1: "Attach a disk to D1:…",
	DETACH_D1: "Detach the disk from D1:",
	ATTACH_CARTRIDGE: "Attach a cartridge… (reboots)",
	DETACH_CARTRIDGE: "Detach the cartridge (reboots)",
	DOWNLOAD_D1: "Download the D1: disk image…",
	SET_TYPE_800: "Set machine type to Atari 800 (reboots)",
	SET_TYPE_800XL: "Set machine type to Atari 800XL (reboots)",
	SET_TYPE_130XE: "Set machine type to Atari 130XE (reboots)",
	SET_TV_NTSC: "Set TV standard to NTSC (reboots)",
	SET_TV_PAL: "Set TV standard to PAL (reboots)",
	SET_TV_TOGGLE: "Toggle TV standard (NTSC/PAL) (reboots)",
	BASIC_ENABLE: "Enable BASIC (reboots)",
	BASIC_DISABLE: "Disable BASIC (reboots)",
	BASIC_TOGGLE: "Toggle BASIC (reboots)",
	PRESS_L: "Press L ($00)",
	PRESS_J: "Press J ($01)",
	PRESS_SEMICOLON: "Press Semicolon (';', $02)",
	PRESS_F1: "Press F1 (Cursor Up, $03)",
	PRESS_F2: "Press F2 (Cursor Down, $04)",
	PRESS_K: "Press K ($05)",
	PRESS_PLUS: "Press Plus ('+', $06)",
	PRESS_ASTERISK: "Press Asterisk ('*', $07)",
	PRESS_O: "Press O ($08)",
	PRESS_CODE_09: "Press key $09 ($09)",
	PRESS_P: "Press P ($0A)",
	PRESS_U: "Press U ($0B)",
	PRESS_RETURN: "Press Return ($0C)",
	PRESS_I: "Press I ($0D)",
	PRESS_MINUS: "Press Minus ('-', $0E)",
	PRESS_EQUALS: "Press Equals ('=', $0F)",
	PRESS_V: "Press V ($10)",
	PRESS_HELP: "Press Help ($11)",
	PRESS_C: "Press C ($12)",
	PRESS_F3: "Press F3 (Cursor Left, $13)",
	PRESS_F4: "Press F4 (Cursor Right, $14)",
	PRESS_B: "Press B ($15)",
	PRESS_X: "Press X ($16)",
	PRESS_Z: "Press Z ($17)",
	PRESS_4: "Press 4 ($18)",
	PRESS_CODE_19: "Press key $19 ($19)",
	PRESS_3: "Press 3 ($1A)",
	PRESS_6: "Press 6 ($1B)",
	PRESS_ESC: "Press Esc ($1C)",
	PRESS_5: "Press 5 ($1D)",
	PRESS_2: "Press 2 ($1E)",
	PRESS_1: "Press 1 ($1F)",
	PRESS_COMMA: "Press Comma (',', $20)",
	PRESS_SPACE: "Press Space ($21)",
	PRESS_PERIOD: "Press Period ('.', $22)",
	PRESS_N: "Press N ($23)",
	PRESS_CODE_24: "Press key $24 ($24)",
	PRESS_M: "Press M ($25)",
	PRESS_SLASH: "Press Slash ('/', $26)",
	PRESS_INVERSE_VIDEO: "Press Inverse Video ($27)",
	PRESS_R: "Press R ($28)",
	PRESS_CODE_29: "Press key $29 ($29)",
	PRESS_E: "Press E ($2A)",
	PRESS_Y: "Press Y ($2B)",
	PRESS_TAB: "Press Tab ($2C)",
	PRESS_T: "Press T ($2D)",
	PRESS_W: "Press W ($2E)",
	PRESS_Q: "Press Q ($2F)",
	PRESS_9: "Press 9 ($30)",
	PRESS_CODE_31: "Press key $31 ($31)",
	PRESS_0: "Press 0 ($32)",
	PRESS_7: "Press 7 ($33)",
	PRESS_BACKSPACE: "Press Backspace ($34)",
	PRESS_8: "Press 8 ($35)",
	PRESS_LESS_THAN: "Press Less Than ('<', $36)",
	PRESS_GREATER_THAN: "Press Greater Than ('>', $37)",
	PRESS_F: "Press F ($38)",
	PRESS_H: "Press H ($39)",
	PRESS_D: "Press D ($3A)",
	PRESS_CODE_3B: "Press key $3B ($3B)",
	PRESS_CAPS: "Press Caps ($3C)",
	PRESS_G: "Press G ($3D)",
	PRESS_S: "Press S ($3E)",
	PRESS_A: "Press A ($3F)",
	PRESS_SHIFT_L: "Press Shift+L ($40)",
	PRESS_SHIFT_J: "Press Shift+J ($41)",
	PRESS_SHIFT_SEMICOLON: "Press Shift+Semicolon (Colon, ':', $42)",
	PRESS_SHIFT_F1: "Press Shift+F1 (Cursor to Upper Left Corner, $43)",
	PRESS_SHIFT_F2: "Press Shift+F2 (Cursor to Lower Left Corner, $44)",
	PRESS_SHIFT_K: "Press Shift+K ($45)",
	PRESS_SHIFT_PLUS: "Press Shift+Plus (Backslash, '\\', $46)",
	PRESS_SHIFT_ASTERISK: "Press Shift+Asterisk (Circumflex, '^', $47)",
	PRESS_SHIFT_O: "Press Shift+O ($48)",
	PRESS_SHIFT_CODE_09: "Press key $49 ($49)",
	PRESS_SHIFT_P: "Press Shift+P ($4A)",
	PRESS_SHIFT_U: "Press Shift+U ($4B)",
	PRESS_SHIFT_RETURN: "Press Shift+Return ($4C)",
	PRESS_SHIFT_I: "Press Shift+I ($4D)",
	PRESS_SHIFT_MINUS: "Press Shift+Minus (Underscore, '_', $4E)",
	PRESS_SHIFT_EQUALS: "Press Shift+Equals (Vertical Line, '|', $4F)",
	PRESS_SHIFT_V: "Press Shift+V ($50)",
	PRESS_SHIFT_HELP: "Press Shift+Help ($51)",
	PRESS_SHIFT_C: "Press Shift+C ($52)",
	PRESS_SHIFT_F3: "Press Shift+F3 (Cursor to Beginning of Line, $53)",
	PRESS_SHIFT_F4: "Press Shift+F4 (Cursor to End of Line, $54)",
	PRESS_SHIFT_B: "Press Shift+B ($55)",
	PRESS_SHIFT_X: "Press Shift+X ($56)",
	PRESS_SHIFT_Z: "Press Shift+Z ($57)",
	PRESS_SHIFT_4: "Press Shift+4 (Dollar Sign, '$', $58)",
	PRESS_SHIFT_CODE_19: "Press key $59 ($59)",
	PRESS_SHIFT_3: "Press Shift+3 (Number Sign, '#', $5A)",
	PRESS_SHIFT_6: "Press Shift+6 (Ampersand, '&', $5B)",
	PRESS_SHIFT_ESC: "Press Shift+Esc ($5C)",
	PRESS_SHIFT_5: "Press Shift+5 (Percent Sign, '%', $5D)",
	PRESS_SHIFT_2: "Press Shift+2 (Quotation Mark, '\"', $5E)",
	PRESS_SHIFT_1: "Press Shift+1 (Exclamation Mark, '!', $5F)",
	PRESS_SHIFT_COMMA: "Press Shift+Comma (Left Square Bracket, '[', $60)",
	PRESS_SHIFT_SPACE: "Press Shift+Space ($61)",
	PRESS_SHIFT_PERIOD: "Press Shift+Period (Right Square Bracket, ']', $62)",
	PRESS_SHIFT_N: "Press Shift+N ($63)",
	PRESS_SHIFT_CODE_24: "Press key $64 ($64)",
	PRESS_SHIFT_M: "Press Shift+M ($65)",
	PRESS_SHIFT_SLASH: "Press Shift+Slash (Question Mark, '?', $66)",
	PRESS_SHIFT_INVERSE_VIDEO: "Press Shift+Inverse Video ($67)",
	PRESS_SHIFT_R: "Press Shift+R ($68)",
	PRESS_SHIFT_CODE_29: "Press key $69 ($69)",
	PRESS_SHIFT_E: "Press Shift+E ($6A)",
	PRESS_SHIFT_Y: "Press Shift+Y ($6B)",
	PRESS_SHIFT_TAB: "Press Shift+Tab (Set Tab Stop, $6C)",
	PRESS_SHIFT_T: "Press Shift+T ($6D)",
	PRESS_SHIFT_W: "Press Shift+W ($6E)",
	PRESS_SHIFT_Q: "Press Shift+Q ($6F)",
	PRESS_SHIFT_9: "Press Shift+9 (Left Parenthesis, '(', $70)",
	PRESS_SHIFT_CODE_31: "Press key $71 ($71)",
	PRESS_SHIFT_0: "Press Shift+0 (Right Parenthesis, ')', $72)",
	PRESS_SHIFT_7: "Press Shift+7 (Apostrophe, ''', $73)",
	PRESS_SHIFT_BACKSPACE: "Press Shift+Backspace (Delete Line, $74)",
	PRESS_SHIFT_8: "Press Shift+8 (Commercial At, '@', $75)",
	PRESS_SHIFT_LESS_THAN: "Press Shift+Less Than (Clear Screen, $76)",
	PRESS_SHIFT_GREATER_THAN: "Press Shift+Greater Than (Insert Line, $77)",
	PRESS_SHIFT_F: "Press Shift+F ($78)",
	PRESS_SHIFT_H: "Press Shift+H ($79)",
	PRESS_SHIFT_D: "Press Shift+D ($7A)",
	PRESS_SHIFT_CODE_3B: "Press key $7B ($7B)",
	PRESS_SHIFT_CAPS: "Press Shift+Caps ($7C)",
	PRESS_SHIFT_G: "Press Shift+G ($7D)",
	PRESS_SHIFT_S: "Press Shift+S ($7E)",
	PRESS_SHIFT_A: "Press Shift+A ($7F)",
	PRESS_CONTROL_L: "Press Control+L (Upper Left Quadrant, '▘', $80)",
	PRESS_CONTROL_J: "Press Control+J (Lower Left Triangle, '◣', $81)",
	PRESS_CONTROL_SEMICOLON: "Press Control+Semicolon (Spade, '♠', $82)",
	PRESS_CONTROL_F1: "Press Control+F1 (Keyboard Enable/Disable, $83)",
	PRESS_CONTROL_F2: "Press Control+F2 (Screen DMA Enable/Disable, $84)",
	PRESS_CONTROL_K: "Press Control+K (Upper Right Quadrant, '▝', $85)",
	PRESS_CONTROL_PLUS: "Press Control+Plus (Cursor Left, $86)",
	PRESS_CONTROL_ASTERISK: "Press Control+Asterisk (Cursor Right, $87)",
	PRESS_CONTROL_O: "Press Control+O (Lower Left Quadrant, '▖', $88)",
	PRESS_CONTROL_CODE_89: "Press key $89 ($89)",
	PRESS_CONTROL_P: "Press Control+P (Club, '♣', $8A)",
	PRESS_CONTROL_U: "Press Control+U (Lower Half Block, '▄', $8B)",
	PRESS_CONTROL_RETURN: "Press Control+Return ($8C)",
	PRESS_CONTROL_I: "Press Control+I (Lower Right Quadrant, '▗', $8D)",
	PRESS_CONTROL_MINUS: "Press Control+Minus (Cursor Up, $8E)",
	PRESS_CONTROL_EQUALS: "Press Control+Equals (Cursor Down, $8F)",
	PRESS_CONTROL_V: "Press Control+V (Left Vertical Bar, '▏', $90)",
	PRESS_CONTROL_HELP: "Press Control+Help ($91)",
	PRESS_CONTROL_C: "Press Control+C (Box Up and Left, '┘', $92)",
	PRESS_CONTROL_F3: "Press Control+F3 (Toggle Key Click, $93)",
	PRESS_CONTROL_F4: "Press Control+F4 (Toggle Character Set, $94)",
	PRESS_CONTROL_B: "Press Control+B (Right Vertical Bar, '▕', $95)",
	PRESS_CONTROL_X: "Press Control+X (Box Up and Horizontal, '┴', $96)",
	PRESS_CONTROL_Z: "Press Control+Z (Box Up and Right, '└', $97)",
	PRESS_CONTROL_4: "Press Control+4 ($98)",
	PRESS_CONTROL_CODE_99: "Press key $99 ($99)",
	PRESS_CONTROL_3: "Press Control+3 (EOF, $9A)",
	PRESS_CONTROL_6: "Press Control+6 ($9B)",
	PRESS_CONTROL_ESC: "Press Control+Esc ($9C)",
	PRESS_CONTROL_5: "Press Control+5 ($9D)",
	PRESS_CONTROL_2: "Press Control+2 (Buzzer, $9E)",
	PRESS_CONTROL_1: "Press Control+1 (Pause/Resume Screen Output, $9F)",
	PRESS_CONTROL_COMMA: "Press Control+Comma (Heart, '♥', $A0)",
	PRESS_CONTROL_SPACE: "Press Control+Space ($A1)",
	PRESS_CONTROL_PERIOD: "Press Control+Period (Diamond, '♦', $A2)",
	PRESS_CONTROL_N: "Press Control+N (Lower Horizontal Bar, '▁', $A3)",
	PRESS_CONTROL_CODE_A4: "Press key $A4 ($A4)",
	PRESS_CONTROL_M: "Press Control+M (Upper Horizontal Bar, '▔', $A5)",
	PRESS_CONTROL_SLASH: "Press Control+Slash ($A6)",
	PRESS_CONTROL_INVERSE_VIDEO:
		"Press Control+Inverse Video (Control Lock, $A7)",
	PRESS_CONTROL_R: "Press Control+R (Horizontal Bar, '─', $A8)",
	PRESS_CONTROL_CODE_A9: "Press key $A9 ($A9)",
	PRESS_CONTROL_E: "Press Control+E (Box Down and Left, '┐', $AA)",
	PRESS_CONTROL_Y: "Press Control+Y (Left Half Block, '▌', $AB)",
	PRESS_CONTROL_TAB: "Press Control+Tab (Clear Tab Stop, $AC)",
	PRESS_CONTROL_T: "Press Control+T (Bullet, '•', $AD)",
	PRESS_CONTROL_W: "Press Control+W (Box Down and Horizontal, '┬', $AE)",
	PRESS_CONTROL_Q: "Press Control+Q (Box Down and Right, '┌', $AF)",
	PRESS_CONTROL_9: "Press Control+9 ($B0)",
	PRESS_CONTROL_CODE_B1: "Press key $B1 ($B1)",
	PRESS_CONTROL_0: "Press Control+0 ($B2)",
	PRESS_CONTROL_7: "Press Control+7 ($B3)",
	PRESS_CONTROL_BACKSPACE: "Press Control+Backspace (Delete, $B4)",
	PRESS_CONTROL_8: "Press Control+8 ($B5)",
	PRESS_CONTROL_LESS_THAN: "Press Control+Less Than (Clear Screen, $B6)",
	PRESS_CONTROL_GREATER_THAN:
		"Press Control+Greater Than (Insert Character, $B7)",
	PRESS_CONTROL_F: "Press Control+F (Upper Right to Lower Left, '╱', $B8)",
	PRESS_CONTROL_H: "Press Control+H (Lower Right Triangle, '◢', $B9)",
	PRESS_CONTROL_D: "Press Control+D (Box Vertical and Left, '┤', $BA)",
	PRESS_CONTROL_CODE_BB: "Press key $BB ($BB)",
	PRESS_CONTROL_CAPS: "Press Control+Caps ($BC)",
	PRESS_CONTROL_G: "Press Control+G (Upper Left to Lower Right, '╲', $BD)",
	PRESS_CONTROL_S: "Press Control+S (Box Vertical and Horizontal, '┼', $BE)",
	PRESS_CONTROL_A: "Press Control+A (Box Vertical and Right, '├', $BF)",
	PRESS_CONTROL_SHIFT_L: "Press Control+Shift+L ($C0)",
	PRESS_CONTROL_SHIFT_J: "Press Control+Shift+J ($C1)",
	PRESS_CONTROL_SHIFT_SEMICOLON: "Press Control+Shift+Semicolon ($C2)",
	PRESS_CONTROL_SHIFT_F1: "Press Control+Shift+F1 ($C3)",
	PRESS_CONTROL_SHIFT_F2: "Press Control+Shift+F2 ($C4)",
	PRESS_CONTROL_SHIFT_K: "Press Control+Shift+K ($C5)",
	PRESS_CONTROL_SHIFT_PLUS: "Press Control+Shift+Plus ($C6)",
	PRESS_CONTROL_SHIFT_ASTERISK: "Press Control+Shift+Asterisk ($C7)",
	PRESS_CONTROL_SHIFT_O: "Press Control+Shift+O ($C8)",
	PRESS_CONTROL_SHIFT_CODE_09: "Press key $C9 ($C9)",
	PRESS_CONTROL_SHIFT_P: "Press Control+Shift+P ($CA)",
	PRESS_CONTROL_SHIFT_U: "Press Control+Shift+U ($CB)",
	PRESS_CONTROL_SHIFT_RETURN: "Press Control+Shift+Return ($CC)",
	PRESS_CONTROL_SHIFT_I: "Press Control+Shift+I ($CD)",
	PRESS_CONTROL_SHIFT_MINUS: "Press Control+Shift+Minus ($CE)",
	PRESS_CONTROL_SHIFT_EQUALS: "Press Control+Shift+Equals ($CF)",
	PRESS_CONTROL_SHIFT_V: "Press Control+Shift+V ($D0)",
	PRESS_CONTROL_SHIFT_HELP: "Press Control+Shift+Help ($D1)",
	PRESS_CONTROL_SHIFT_C: "Press Control+Shift+C ($D2)",
	PRESS_CONTROL_SHIFT_F3: "Press Control+Shift+F3 ($D3)",
	PRESS_CONTROL_SHIFT_F4: "Press Control+Shift+F4 ($D4)",
	PRESS_CONTROL_SHIFT_B: "Press Control+Shift+B ($D5)",
	PRESS_CONTROL_SHIFT_X: "Press Control+Shift+X ($D6)",
	PRESS_CONTROL_SHIFT_Z: "Press Control+Shift+Z ($D7)",
	PRESS_CONTROL_SHIFT_4: "Press Control+Shift+4 ($D8)",
	PRESS_CONTROL_SHIFT_CODE_19: "Press key $D9 ($D9)",
	PRESS_CONTROL_SHIFT_3: "Press Control+Shift+3 ($DA)",
	PRESS_CONTROL_SHIFT_6: "Press Control+Shift+6 ($DB)",
	PRESS_CONTROL_SHIFT_ESC: "Press Control+Shift+Esc ($DC)",
	PRESS_CONTROL_SHIFT_5: "Press Control+Shift+5 ($DD)",
	PRESS_CONTROL_SHIFT_2: "Press Control+Shift+2 ($DE)",
	PRESS_CONTROL_SHIFT_1: "Press Control+Shift+1 ($DF)",
	PRESS_CONTROL_SHIFT_COMMA: "Press Control+Shift+Comma ($E0)",
	PRESS_CONTROL_SHIFT_SPACE: "Press Control+Shift+Space ($E1)",
	PRESS_CONTROL_SHIFT_PERIOD: "Press Control+Shift+Period ($E2)",
	PRESS_CONTROL_SHIFT_N: "Press Control+Shift+N ($E3)",
	PRESS_CONTROL_SHIFT_CODE_24: "Press key $E4 ($E4)",
	PRESS_CONTROL_SHIFT_M: "Press Control+Shift+M ($E5)",
	PRESS_CONTROL_SHIFT_SLASH: "Press Control+Shift+Slash ($E6)",
	PRESS_CONTROL_SHIFT_INVERSE_VIDEO: "Press Control+Shift+Inverse Video ($E7)",
	PRESS_CONTROL_SHIFT_R: "Press Control+Shift+R ($E8)",
	PRESS_CONTROL_SHIFT_CODE_29: "Press key $E9 ($E9)",
	PRESS_CONTROL_SHIFT_E: "Press Control+Shift+E ($EA)",
	PRESS_CONTROL_SHIFT_Y: "Press Control+Shift+Y ($EB)",
	PRESS_CONTROL_SHIFT_TAB: "Press Control+Shift+Tab ($EC)",
	PRESS_CONTROL_SHIFT_T: "Press Control+Shift+T ($ED)",
	PRESS_CONTROL_SHIFT_W: "Press Control+Shift+W ($EE)",
	PRESS_CONTROL_SHIFT_Q: "Press Control+Shift+Q ($EF)",
	PRESS_CONTROL_SHIFT_9: "Press Control+Shift+9 ($F0)",
	PRESS_CONTROL_SHIFT_CODE_31: "Press key $F1 ($F1)",
	PRESS_CONTROL_SHIFT_0: "Press Control+Shift+0 ($F2)",
	PRESS_CONTROL_SHIFT_7: "Press Control+Shift+7 ($F3)",
	PRESS_CONTROL_SHIFT_BACKSPACE: "Press Control+Shift+Backspace ($F4)",
	PRESS_CONTROL_SHIFT_8: "Press Control+Shift+8 ($F5)",
	PRESS_CONTROL_SHIFT_LESS_THAN: "Press Control+Shift+Less Than ($F6)",
	PRESS_CONTROL_SHIFT_GREATER_THAN: "Press Control+Shift+Greater Than ($F7)",
	PRESS_CONTROL_SHIFT_F: "Press Control+Shift+F ($F8)",
	PRESS_CONTROL_SHIFT_H: "Press Control+Shift+H ($F9)",
	PRESS_CONTROL_SHIFT_D: "Press Control+Shift+D ($FA)",
	PRESS_CONTROL_SHIFT_CODE_3B: "Press key $FB ($FB)",
	PRESS_CONTROL_SHIFT_CAPS: "Press Control+Shift+Caps ($FC)",
	PRESS_CONTROL_SHIFT_G: "Press Control+Shift+G ($FD)",
	PRESS_CONTROL_SHIFT_S: "Press Control+Shift+S ($FE)",
	PRESS_CONTROL_SHIFT_A: "Press Control+Shift+A ($FF)",
	RELEASE_POKEY_KEY: "Release POKEY key",
	PRESS_SHIFT: "Press Shift",
	RELEASE_SHIFT: "Release Shift",
	PRESS_RESET: "Press Reset",
	RELEASE_RESET: "Release Reset",
	PRESS_OPTION: "Press Option",
	RELEASE_OPTION: "Release Option",
	PRESS_SELECT: "Press Select",
	RELEASE_SELECT: "Release Select",
	PRESS_START: "Press Start",
	RELEASE_START: "Release Start",
	PRESS_BREAK: "Press Break",
	PRESS_JOY0_UP: "Push joystick 0 up",
	RELEASE_JOY0_UP: "Release joystick 0 up",
	PRESS_JOY0_DOWN: "Push joystick 0 down",
	RELEASE_JOY0_DOWN: "Release joystick 0 down",
	PRESS_JOY0_LEFT: "Push joystick 0 left",
	RELEASE_JOY0_LEFT: "Release joystick 0 left",
	PRESS_JOY0_RIGHT: "Push joystick 0 right",
	RELEASE_JOY0_RIGHT: "Release joystick 0 right",
	PRESS_JOY0_TRIGGER: "Press joystick 0 trigger",
	RELEASE_JOY0_TRIGGER: "Release joystick 0 trigger",
} satisfies Record<string, string>;

export type LabelKey = keyof typeof labels;

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
