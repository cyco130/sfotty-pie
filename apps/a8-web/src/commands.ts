import type { Emulator } from "./emulator.ts";

export interface CommandContext {
	emulator: Emulator;
}

export const commands = {
	POWER_CYCLE: ({ emulator }) => emulator.coldStart(),

	// Regular key presses
	PRESS_L: ({ emulator }) => emulator.machine.pokeyKeyDown(0x00),
	PRESS_J: ({ emulator }) => emulator.machine.pokeyKeyDown(0x01),
	PRESS_SEMICOLON: ({ emulator }) => emulator.machine.pokeyKeyDown(0x02),
	PRESS_F1: ({ emulator }) => emulator.machine.pokeyKeyDown(0x03),
	PRESS_F2: ({ emulator }) => emulator.machine.pokeyKeyDown(0x04),
	PRESS_K: ({ emulator }) => emulator.machine.pokeyKeyDown(0x05),
	PRESS_PLUS: ({ emulator }) => emulator.machine.pokeyKeyDown(0x06),
	PRESS_ASTERISK: ({ emulator }) => emulator.machine.pokeyKeyDown(0x07),
	PRESS_O: ({ emulator }) => emulator.machine.pokeyKeyDown(0x08),
	PRESS_CODE_09: ({ emulator }) => emulator.machine.pokeyKeyDown(0x09),
	PRESS_P: ({ emulator }) => emulator.machine.pokeyKeyDown(0x0a),
	PRESS_U: ({ emulator }) => emulator.machine.pokeyKeyDown(0x0b),
	PRESS_RETURN: ({ emulator }) => emulator.machine.pokeyKeyDown(0x0c),
	PRESS_I: ({ emulator }) => emulator.machine.pokeyKeyDown(0x0d),
	PRESS_MINUS: ({ emulator }) => emulator.machine.pokeyKeyDown(0x0e),
	PRESS_EQUALS: ({ emulator }) => emulator.machine.pokeyKeyDown(0x0f),

	PRESS_V: ({ emulator }) => emulator.machine.pokeyKeyDown(0x10),
	PRESS_HELP: ({ emulator }) => emulator.machine.pokeyKeyDown(0x11),
	PRESS_C: ({ emulator }) => emulator.machine.pokeyKeyDown(0x12),
	PRESS_F3: ({ emulator }) => emulator.machine.pokeyKeyDown(0x13),
	PRESS_F4: ({ emulator }) => emulator.machine.pokeyKeyDown(0x14),
	PRESS_B: ({ emulator }) => emulator.machine.pokeyKeyDown(0x15),
	PRESS_X: ({ emulator }) => emulator.machine.pokeyKeyDown(0x16),
	PRESS_Z: ({ emulator }) => emulator.machine.pokeyKeyDown(0x17),
	PRESS_4: ({ emulator }) => emulator.machine.pokeyKeyDown(0x18),
	PRESS_CODE_19: ({ emulator }) => emulator.machine.pokeyKeyDown(0x19),
	PRESS_3: ({ emulator }) => emulator.machine.pokeyKeyDown(0x1a),
	PRESS_6: ({ emulator }) => emulator.machine.pokeyKeyDown(0x1b),
	PRESS_ESC: ({ emulator }) => emulator.machine.pokeyKeyDown(0x1c),
	PRESS_5: ({ emulator }) => emulator.machine.pokeyKeyDown(0x1d),
	PRESS_2: ({ emulator }) => emulator.machine.pokeyKeyDown(0x1e),
	PRESS_1: ({ emulator }) => emulator.machine.pokeyKeyDown(0x1f),

	PRESS_COMMA: ({ emulator }) => emulator.machine.pokeyKeyDown(0x20),
	PRESS_SPACE: ({ emulator }) => emulator.machine.pokeyKeyDown(0x21),
	PRESS_FULL_STOP: ({ emulator }) => emulator.machine.pokeyKeyDown(0x22),
	PRESS_N: ({ emulator }) => emulator.machine.pokeyKeyDown(0x23),
	PRESS_CODE_24: ({ emulator }) => emulator.machine.pokeyKeyDown(0x24),
	PRESS_M: ({ emulator }) => emulator.machine.pokeyKeyDown(0x25),
	PRESS_SLASH: ({ emulator }) => emulator.machine.pokeyKeyDown(0x26),
	PRESS_INVERSE_VIDEO: ({ emulator }) => emulator.machine.pokeyKeyDown(0x27),
	PRESS_R: ({ emulator }) => emulator.machine.pokeyKeyDown(0x28),
	PRESS_CODE_29: ({ emulator }) => emulator.machine.pokeyKeyDown(0x29),
	PRESS_E: ({ emulator }) => emulator.machine.pokeyKeyDown(0x2a),
	PRESS_Y: ({ emulator }) => emulator.machine.pokeyKeyDown(0x2b),
	PRESS_TAB: ({ emulator }) => emulator.machine.pokeyKeyDown(0x2c),
	PRESS_T: ({ emulator }) => emulator.machine.pokeyKeyDown(0x2d),
	PRESS_W: ({ emulator }) => emulator.machine.pokeyKeyDown(0x2e),
	PRESS_Q: ({ emulator }) => emulator.machine.pokeyKeyDown(0x2f),

	PRESS_9: ({ emulator }) => emulator.machine.pokeyKeyDown(0x30),
	PRESS_CODE_31: ({ emulator }) => emulator.machine.pokeyKeyDown(0x31),
	PRESS_0: ({ emulator }) => emulator.machine.pokeyKeyDown(0x32),
	PRESS_7: ({ emulator }) => emulator.machine.pokeyKeyDown(0x33),
	PRESS_BACKSPACE: ({ emulator }) => emulator.machine.pokeyKeyDown(0x34),
	PRESS_8: ({ emulator }) => emulator.machine.pokeyKeyDown(0x35),
	PRESS_LESS_THAN: ({ emulator }) => emulator.machine.pokeyKeyDown(0x36),
	PRESS_GREATER_THAN: ({ emulator }) => emulator.machine.pokeyKeyDown(0x37),
	PRESS_F: ({ emulator }) => emulator.machine.pokeyKeyDown(0x38),
	PRESS_H: ({ emulator }) => emulator.machine.pokeyKeyDown(0x39),
	PRESS_D: ({ emulator }) => emulator.machine.pokeyKeyDown(0x3a),
	PRESS_CODE_3B: ({ emulator }) => emulator.machine.pokeyKeyDown(0x3b),
	PRESS_CAPS: ({ emulator }) => emulator.machine.pokeyKeyDown(0x3c),
	PRESS_G: ({ emulator }) => emulator.machine.pokeyKeyDown(0x3d),
	PRESS_S: ({ emulator }) => emulator.machine.pokeyKeyDown(0x3e),
	PRESS_A: ({ emulator }) => emulator.machine.pokeyKeyDown(0x3f),

	PRESS_SHIFT_L: ({ emulator }) => emulator.machine.pokeyKeyDown(0x40),
	PRESS_SHIFT_J: ({ emulator }) => emulator.machine.pokeyKeyDown(0x41),
	PRESS_SHIFT_SEMICOLON: ({ emulator }) => emulator.machine.pokeyKeyDown(0x42),
	PRESS_SHIFT_F1: ({ emulator }) => emulator.machine.pokeyKeyDown(0x43),
	PRESS_SHIFT_F2: ({ emulator }) => emulator.machine.pokeyKeyDown(0x44),
	PRESS_SHIFT_K: ({ emulator }) => emulator.machine.pokeyKeyDown(0x45),
	PRESS_SHIFT_PLUS: ({ emulator }) => emulator.machine.pokeyKeyDown(0x46),
	PRESS_SHIFT_ASTERISK: ({ emulator }) => emulator.machine.pokeyKeyDown(0x47),
	PRESS_SHIFT_O: ({ emulator }) => emulator.machine.pokeyKeyDown(0x48),
	PRESS_SHIFT_CODE_09: ({ emulator }) => emulator.machine.pokeyKeyDown(0x49),
	PRESS_SHIFT_P: ({ emulator }) => emulator.machine.pokeyKeyDown(0x4a),
	PRESS_SHIFT_U: ({ emulator }) => emulator.machine.pokeyKeyDown(0x4b),
	PRESS_SHIFT_RETURN: ({ emulator }) => emulator.machine.pokeyKeyDown(0x4c),
	PRESS_SHIFT_I: ({ emulator }) => emulator.machine.pokeyKeyDown(0x4d),
	PRESS_SHIFT_MINUS: ({ emulator }) => emulator.machine.pokeyKeyDown(0x4e),
	PRESS_SHIFT_EQUALS: ({ emulator }) => emulator.machine.pokeyKeyDown(0x4f),

	PRESS_SHIFT_V: ({ emulator }) => emulator.machine.pokeyKeyDown(0x50),
	PRESS_SHIFT_HELP: ({ emulator }) => emulator.machine.pokeyKeyDown(0x51),
	PRESS_SHIFT_C: ({ emulator }) => emulator.machine.pokeyKeyDown(0x52),
	PRESS_SHIFT_F3: ({ emulator }) => emulator.machine.pokeyKeyDown(0x53),
	PRESS_SHIFT_F4: ({ emulator }) => emulator.machine.pokeyKeyDown(0x54),
	PRESS_SHIFT_B: ({ emulator }) => emulator.machine.pokeyKeyDown(0x55),
	PRESS_SHIFT_X: ({ emulator }) => emulator.machine.pokeyKeyDown(0x56),
	PRESS_SHIFT_Z: ({ emulator }) => emulator.machine.pokeyKeyDown(0x57),
	PRESS_SHIFT_4: ({ emulator }) => emulator.machine.pokeyKeyDown(0x58),
	PRESS_SHIFT_CODE_19: ({ emulator }) => emulator.machine.pokeyKeyDown(0x59),
	PRESS_SHIFT_3: ({ emulator }) => emulator.machine.pokeyKeyDown(0x5a),
	PRESS_SHIFT_6: ({ emulator }) => emulator.machine.pokeyKeyDown(0x5b),
	PRESS_SHIFT_ESC: ({ emulator }) => emulator.machine.pokeyKeyDown(0x5c),
	PRESS_SHIFT_5: ({ emulator }) => emulator.machine.pokeyKeyDown(0x5d),
	PRESS_SHIFT_2: ({ emulator }) => emulator.machine.pokeyKeyDown(0x5e),
	PRESS_SHIFT_1: ({ emulator }) => emulator.machine.pokeyKeyDown(0x5f),

	PRESS_SHIFT_COMMA: ({ emulator }) => emulator.machine.pokeyKeyDown(0x60),
	PRESS_SHIFT_SPACE: ({ emulator }) => emulator.machine.pokeyKeyDown(0x61),
	PRESS_SHIFT_FULL_STOP: ({ emulator }) => emulator.machine.pokeyKeyDown(0x62),
	PRESS_SHIFT_N: ({ emulator }) => emulator.machine.pokeyKeyDown(0x63),
	PRESS_SHIFT_CODE_24: ({ emulator }) => emulator.machine.pokeyKeyDown(0x64),
	PRESS_SHIFT_M: ({ emulator }) => emulator.machine.pokeyKeyDown(0x65),
	PRESS_SHIFT_SLASH: ({ emulator }) => emulator.machine.pokeyKeyDown(0x66),
	PRESS_SHIFT_INVERSE_VIDEO: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0x67),
	PRESS_SHIFT_R: ({ emulator }) => emulator.machine.pokeyKeyDown(0x68),
	PRESS_SHIFT_CODE_29: ({ emulator }) => emulator.machine.pokeyKeyDown(0x69),
	PRESS_SHIFT_E: ({ emulator }) => emulator.machine.pokeyKeyDown(0x6a),
	PRESS_SHIFT_Y: ({ emulator }) => emulator.machine.pokeyKeyDown(0x6b),
	PRESS_SHIFT_TAB: ({ emulator }) => emulator.machine.pokeyKeyDown(0x6c),
	PRESS_SHIFT_T: ({ emulator }) => emulator.machine.pokeyKeyDown(0x6d),
	PRESS_SHIFT_W: ({ emulator }) => emulator.machine.pokeyKeyDown(0x6e),
	PRESS_SHIFT_Q: ({ emulator }) => emulator.machine.pokeyKeyDown(0x6f),

	PRESS_SHIFT_9: ({ emulator }) => emulator.machine.pokeyKeyDown(0x70),
	PRESS_SHIFT_CODE_31: ({ emulator }) => emulator.machine.pokeyKeyDown(0x71),
	PRESS_SHIFT_0: ({ emulator }) => emulator.machine.pokeyKeyDown(0x72),
	PRESS_SHIFT_7: ({ emulator }) => emulator.machine.pokeyKeyDown(0x73),
	PRESS_SHIFT_BACKSPACE: ({ emulator }) => emulator.machine.pokeyKeyDown(0x74),
	PRESS_SHIFT_8: ({ emulator }) => emulator.machine.pokeyKeyDown(0x75),
	PRESS_SHIFT_LESS_THAN: ({ emulator }) => emulator.machine.pokeyKeyDown(0x76),
	PRESS_SHIFT_GREATER_THAN: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0x77),
	PRESS_SHIFT_F: ({ emulator }) => emulator.machine.pokeyKeyDown(0x78),
	PRESS_SHIFT_H: ({ emulator }) => emulator.machine.pokeyKeyDown(0x79),
	PRESS_SHIFT_D: ({ emulator }) => emulator.machine.pokeyKeyDown(0x7a),
	PRESS_SHIFT_CODE_3B: ({ emulator }) => emulator.machine.pokeyKeyDown(0x7b),
	PRESS_SHIFT_CAPS: ({ emulator }) => emulator.machine.pokeyKeyDown(0x7c),
	PRESS_SHIFT_G: ({ emulator }) => emulator.machine.pokeyKeyDown(0x7d),
	PRESS_SHIFT_S: ({ emulator }) => emulator.machine.pokeyKeyDown(0x7e),
	PRESS_SHIFT_A: ({ emulator }) => emulator.machine.pokeyKeyDown(0x7f),

	PRESS_CONTROL_L: ({ emulator }) => emulator.machine.pokeyKeyDown(0x80),
	PRESS_CONTROL_J: ({ emulator }) => emulator.machine.pokeyKeyDown(0x81),
	PRESS_CONTROL_SEMICOLON: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0x82),
	PRESS_CONTROL_F1: ({ emulator }) => emulator.machine.pokeyKeyDown(0x83),
	PRESS_CONTROL_F2: ({ emulator }) => emulator.machine.pokeyKeyDown(0x84),
	PRESS_CONTROL_K: ({ emulator }) => emulator.machine.pokeyKeyDown(0x85),
	PRESS_CONTROL_PLUS: ({ emulator }) => emulator.machine.pokeyKeyDown(0x86),
	PRESS_CONTROL_ASTERISK: ({ emulator }) => emulator.machine.pokeyKeyDown(0x87),
	PRESS_CONTROL_O: ({ emulator }) => emulator.machine.pokeyKeyDown(0x88),
	PRESS_CONTROL_CODE_89: ({ emulator }) => emulator.machine.pokeyKeyDown(0x89),
	PRESS_CONTROL_P: ({ emulator }) => emulator.machine.pokeyKeyDown(0x8a),
	PRESS_CONTROL_U: ({ emulator }) => emulator.machine.pokeyKeyDown(0x8b),
	PRESS_CONTROL_RETURN: ({ emulator }) => emulator.machine.pokeyKeyDown(0x8c),
	PRESS_CONTROL_I: ({ emulator }) => emulator.machine.pokeyKeyDown(0x8d),
	PRESS_CONTROL_MINUS: ({ emulator }) => emulator.machine.pokeyKeyDown(0x8e),
	PRESS_CONTROL_EQUALS: ({ emulator }) => emulator.machine.pokeyKeyDown(0x8f),

	PRESS_CONTROL_V: ({ emulator }) => emulator.machine.pokeyKeyDown(0x90),
	PRESS_CONTROL_HELP: ({ emulator }) => emulator.machine.pokeyKeyDown(0x91),
	PRESS_CONTROL_C: ({ emulator }) => emulator.machine.pokeyKeyDown(0x92),
	PRESS_CONTROL_F3: ({ emulator }) => emulator.machine.pokeyKeyDown(0x93),
	PRESS_CONTROL_F4: ({ emulator }) => emulator.machine.pokeyKeyDown(0x94),
	PRESS_CONTROL_B: ({ emulator }) => emulator.machine.pokeyKeyDown(0x95),
	PRESS_CONTROL_X: ({ emulator }) => emulator.machine.pokeyKeyDown(0x96),
	PRESS_CONTROL_Z: ({ emulator }) => emulator.machine.pokeyKeyDown(0x97),
	PRESS_CONTROL_4: ({ emulator }) => emulator.machine.pokeyKeyDown(0x98),
	PRESS_CONTROL_CODE_99: ({ emulator }) => emulator.machine.pokeyKeyDown(0x99),
	PRESS_CONTROL_3: ({ emulator }) => emulator.machine.pokeyKeyDown(0x9a),
	PRESS_CONTROL_6: ({ emulator }) => emulator.machine.pokeyKeyDown(0x9b),
	PRESS_CONTROL_ESC: ({ emulator }) => emulator.machine.pokeyKeyDown(0x9c),
	PRESS_CONTROL_5: ({ emulator }) => emulator.machine.pokeyKeyDown(0x9d),
	PRESS_CONTROL_2: ({ emulator }) => emulator.machine.pokeyKeyDown(0x9e),
	PRESS_CONTROL_1: ({ emulator }) => emulator.machine.pokeyKeyDown(0x9f),

	PRESS_CONTROL_COMMA: ({ emulator }) => emulator.machine.pokeyKeyDown(0xa0),
	PRESS_CONTROL_SPACE: ({ emulator }) => emulator.machine.pokeyKeyDown(0xa1),
	PRESS_CONTROL_FULL_STOP: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xa2),
	PRESS_CONTROL_N: ({ emulator }) => emulator.machine.pokeyKeyDown(0xa3),
	PRESS_CONTROL_CODE_A4: ({ emulator }) => emulator.machine.pokeyKeyDown(0xa4),
	PRESS_CONTROL_M: ({ emulator }) => emulator.machine.pokeyKeyDown(0xa5),
	PRESS_CONTROL_SLASH: ({ emulator }) => emulator.machine.pokeyKeyDown(0xa6),
	PRESS_CONTROL_INVERSE_VIDEO: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xa7),
	PRESS_CONTROL_R: ({ emulator }) => emulator.machine.pokeyKeyDown(0xa8),
	PRESS_CONTROL_CODE_A9: ({ emulator }) => emulator.machine.pokeyKeyDown(0xa9),
	PRESS_CONTROL_E: ({ emulator }) => emulator.machine.pokeyKeyDown(0xaa),
	PRESS_CONTROL_Y: ({ emulator }) => emulator.machine.pokeyKeyDown(0xab),
	PRESS_CONTROL_TAB: ({ emulator }) => emulator.machine.pokeyKeyDown(0xac),
	PRESS_CONTROL_T: ({ emulator }) => emulator.machine.pokeyKeyDown(0xad),
	PRESS_CONTROL_W: ({ emulator }) => emulator.machine.pokeyKeyDown(0xae),
	PRESS_CONTROL_Q: ({ emulator }) => emulator.machine.pokeyKeyDown(0xaf),

	PRESS_CONTROL_9: ({ emulator }) => emulator.machine.pokeyKeyDown(0xb0),
	PRESS_CONTROL_CODE_B1: ({ emulator }) => emulator.machine.pokeyKeyDown(0xb1),
	PRESS_CONTROL_0: ({ emulator }) => emulator.machine.pokeyKeyDown(0xb2),
	PRESS_CONTROL_7: ({ emulator }) => emulator.machine.pokeyKeyDown(0xb3),
	PRESS_CONTROL_BACKSPACE: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xb4),
	PRESS_CONTROL_8: ({ emulator }) => emulator.machine.pokeyKeyDown(0xb5),
	PRESS_CONTROL_LESS_THAN: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xb6),
	PRESS_CONTROL_GREATER_THAN: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xb7),
	PRESS_CONTROL_F: ({ emulator }) => emulator.machine.pokeyKeyDown(0xb8),
	PRESS_CONTROL_H: ({ emulator }) => emulator.machine.pokeyKeyDown(0xb9),
	PRESS_CONTROL_D: ({ emulator }) => emulator.machine.pokeyKeyDown(0xba),
	PRESS_CONTROL_CODE_BB: ({ emulator }) => emulator.machine.pokeyKeyDown(0xbb),
	PRESS_CONTROL_CAPS: ({ emulator }) => emulator.machine.pokeyKeyDown(0xbc),
	PRESS_CONTROL_G: ({ emulator }) => emulator.machine.pokeyKeyDown(0xbd),
	PRESS_CONTROL_S: ({ emulator }) => emulator.machine.pokeyKeyDown(0xbe),
	PRESS_CONTROL_A: ({ emulator }) => emulator.machine.pokeyKeyDown(0xbf),

	PRESS_CONTROL_SHIFT_L: ({ emulator }) => emulator.machine.pokeyKeyDown(0xc0),
	PRESS_CONTROL_SHIFT_J: ({ emulator }) => emulator.machine.pokeyKeyDown(0xc1),
	PRESS_CONTROL_SHIFT_SEMICOLON: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xc2),
	PRESS_CONTROL_SHIFT_F1: ({ emulator }) => emulator.machine.pokeyKeyDown(0xc3),
	PRESS_CONTROL_SHIFT_F2: ({ emulator }) => emulator.machine.pokeyKeyDown(0xc4),
	PRESS_CONTROL_SHIFT_K: ({ emulator }) => emulator.machine.pokeyKeyDown(0xc5),
	PRESS_CONTROL_SHIFT_PLUS: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xc6),
	PRESS_CONTROL_SHIFT_ASTERISK: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xc7),
	PRESS_CONTROL_SHIFT_O: ({ emulator }) => emulator.machine.pokeyKeyDown(0xc8),
	PRESS_CONTROL_SHIFT_CODE_09: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xc9),
	PRESS_CONTROL_SHIFT_P: ({ emulator }) => emulator.machine.pokeyKeyDown(0xca),
	PRESS_CONTROL_SHIFT_U: ({ emulator }) => emulator.machine.pokeyKeyDown(0xcb),
	PRESS_CONTROL_SHIFT_RETURN: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xcc),
	PRESS_CONTROL_SHIFT_I: ({ emulator }) => emulator.machine.pokeyKeyDown(0xcd),
	PRESS_CONTROL_SHIFT_MINUS: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xce),
	PRESS_CONTROL_SHIFT_EQUALS: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xcf),

	PRESS_CONTROL_SHIFT_V: ({ emulator }) => emulator.machine.pokeyKeyDown(0xd0),
	PRESS_CONTROL_SHIFT_HELP: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xd1),
	PRESS_CONTROL_SHIFT_C: ({ emulator }) => emulator.machine.pokeyKeyDown(0xd2),
	PRESS_CONTROL_SHIFT_F3: ({ emulator }) => emulator.machine.pokeyKeyDown(0xd3),
	PRESS_CONTROL_SHIFT_F4: ({ emulator }) => emulator.machine.pokeyKeyDown(0xd4),
	PRESS_CONTROL_SHIFT_B: ({ emulator }) => emulator.machine.pokeyKeyDown(0xd5),
	PRESS_CONTROL_SHIFT_X: ({ emulator }) => emulator.machine.pokeyKeyDown(0xd6),
	PRESS_CONTROL_SHIFT_Z: ({ emulator }) => emulator.machine.pokeyKeyDown(0xd7),
	PRESS_CONTROL_SHIFT_4: ({ emulator }) => emulator.machine.pokeyKeyDown(0xd8),
	PRESS_CONTROL_SHIFT_CODE_19: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xd9),
	PRESS_CONTROL_SHIFT_3: ({ emulator }) => emulator.machine.pokeyKeyDown(0xda),
	PRESS_CONTROL_SHIFT_6: ({ emulator }) => emulator.machine.pokeyKeyDown(0xdb),
	PRESS_CONTROL_SHIFT_ESC: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xdc),
	PRESS_CONTROL_SHIFT_5: ({ emulator }) => emulator.machine.pokeyKeyDown(0xdd),
	PRESS_CONTROL_SHIFT_2: ({ emulator }) => emulator.machine.pokeyKeyDown(0xde),
	PRESS_CONTROL_SHIFT_1: ({ emulator }) => emulator.machine.pokeyKeyDown(0xdf),

	PRESS_CONTROL_SHIFT_COMMA: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xe0),
	PRESS_CONTROL_SHIFT_SPACE: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xe1),
	PRESS_CONTROL_SHIFT_FULL_STOP: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xe2),
	PRESS_CONTROL_SHIFT_N: ({ emulator }) => emulator.machine.pokeyKeyDown(0xe3),
	PRESS_CONTROL_SHIFT_CODE_24: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xe4),
	PRESS_CONTROL_SHIFT_M: ({ emulator }) => emulator.machine.pokeyKeyDown(0xe5),
	PRESS_CONTROL_SHIFT_SLASH: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xe6),
	PRESS_CONTROL_SHIFT_INVERSE_VIDEO: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xe7),
	PRESS_CONTROL_SHIFT_R: ({ emulator }) => emulator.machine.pokeyKeyDown(0xe8),
	PRESS_CONTROL_SHIFT_CODE_29: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xe9),
	PRESS_CONTROL_SHIFT_E: ({ emulator }) => emulator.machine.pokeyKeyDown(0xea),
	PRESS_CONTROL_SHIFT_Y: ({ emulator }) => emulator.machine.pokeyKeyDown(0xeb),
	PRESS_CONTROL_SHIFT_TAB: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xec),
	PRESS_CONTROL_SHIFT_T: ({ emulator }) => emulator.machine.pokeyKeyDown(0xed),
	PRESS_CONTROL_SHIFT_W: ({ emulator }) => emulator.machine.pokeyKeyDown(0xee),
	PRESS_CONTROL_SHIFT_Q: ({ emulator }) => emulator.machine.pokeyKeyDown(0xef),

	PRESS_CONTROL_SHIFT_9: ({ emulator }) => emulator.machine.pokeyKeyDown(0xf0),
	PRESS_CONTROL_SHIFT_CODE_31: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xf1),
	PRESS_CONTROL_SHIFT_0: ({ emulator }) => emulator.machine.pokeyKeyDown(0xf2),
	PRESS_CONTROL_SHIFT_7: ({ emulator }) => emulator.machine.pokeyKeyDown(0xf3),
	PRESS_CONTROL_SHIFT_BACKSPACE: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xf4),
	PRESS_CONTROL_SHIFT_8: ({ emulator }) => emulator.machine.pokeyKeyDown(0xf5),
	PRESS_CONTROL_SHIFT_LESS_THAN: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xf6),
	PRESS_CONTROL_SHIFT_GREATER_THAN: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xf7),
	PRESS_CONTROL_SHIFT_F: ({ emulator }) => emulator.machine.pokeyKeyDown(0xf8),
	PRESS_CONTROL_SHIFT_H: ({ emulator }) => emulator.machine.pokeyKeyDown(0xf9),
	PRESS_CONTROL_SHIFT_D: ({ emulator }) => emulator.machine.pokeyKeyDown(0xfa),
	PRESS_CONTROL_SHIFT_CODE_3B: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xfb),
	PRESS_CONTROL_SHIFT_CAPS: ({ emulator }) =>
		emulator.machine.pokeyKeyDown(0xfc),
	PRESS_CONTROL_SHIFT_G: ({ emulator }) => emulator.machine.pokeyKeyDown(0xfd),
	PRESS_CONTROL_SHIFT_S: ({ emulator }) => emulator.machine.pokeyKeyDown(0xfe),
	PRESS_CONTROL_SHIFT_A: ({ emulator }) => emulator.machine.pokeyKeyDown(0xff),

	RELEASE_POKEY_KEY: ({ emulator }) => emulator.machine.pokeyKeyUp(),

	PRESS_SHIFT: ({ emulator }) => emulator.machine.shiftKeyDown(),
	RELEASE_SHIFT: ({ emulator }) => emulator.machine.shiftKeyUp(),

	PRESS_RESET: ({ emulator }) => emulator.machine.resetButtonDown(),
	RELEASE_RESET: ({ emulator }) => emulator.machine.resetButtonUp(),

	// Console buttons
	PRESS_OPTION: ({ emulator }) => emulator.machine.consoleKeyDown(4),
	RELEASE_OPTION: ({ emulator }) => emulator.machine.consoleKeyUp(4),
	PRESS_SELECT: ({ emulator }) => emulator.machine.consoleKeyDown(2),
	RELEASE_SELECT: ({ emulator }) => emulator.machine.consoleKeyUp(2),
	PRESS_START: ({ emulator }) => emulator.machine.consoleKeyDown(1),
	RELEASE_START: ({ emulator }) => emulator.machine.consoleKeyUp(1),

	// Break
	PRESS_BREAK: ({ emulator }) => emulator.machine.breakKeyDown(),

	// Joystick 0 (direction masks: 1 = up, 2 = down, 4 = left, 8 = right)
	PRESS_JOY0_UP: ({ emulator }) => emulator.machine.joystickDown(0, 1),
	RELEASE_JOY0_UP: ({ emulator }) => emulator.machine.joystickUp(0, 1),
	PRESS_JOY0_DOWN: ({ emulator }) => emulator.machine.joystickDown(0, 2),
	RELEASE_JOY0_DOWN: ({ emulator }) => emulator.machine.joystickUp(0, 2),
	PRESS_JOY0_LEFT: ({ emulator }) => emulator.machine.joystickDown(0, 4),
	RELEASE_JOY0_LEFT: ({ emulator }) => emulator.machine.joystickUp(0, 4),
	PRESS_JOY0_RIGHT: ({ emulator }) => emulator.machine.joystickDown(0, 8),
	RELEASE_JOY0_RIGHT: ({ emulator }) => emulator.machine.joystickUp(0, 8),
	PRESS_JOY0_TRIGGER: ({ emulator }) => emulator.machine.joystickTriggerDown(0),
	RELEASE_JOY0_TRIGGER: ({ emulator }) => emulator.machine.joystickTriggerUp(0),

	// TODO: settings commands (TOGGLE_KEYBOARD_LAYOUT_MODE and friends) come
	// back when raw mode and an options store exist.
} satisfies Record<string, (ctx: CommandContext) => void>;

for (const [key, value] of Object.entries(commands)) {
	commands[key as keyof typeof commands] = (ctx) => {
		// eslint-disable-next-line no-console -- command tracing is a debug aid
		console.log("COMMAND", key);
		value(ctx);
	};
}

export const descriptions: Record<keyof typeof commands, string> = {
	POWER_CYCLE: "Power cycle (cold reset)",

	PRESS_L: "Press L (key code $00)",
	PRESS_J: "Press J (key code $01)",
	PRESS_SEMICOLON: "Press Semicolon (';', key code $02)",
	PRESS_F1: "Press F1 (Cursor Up function, key code $03)",
	PRESS_F2: "Press F2 (Cursor Down function, key code $04)",
	PRESS_K: "Press K (key code $05)",
	PRESS_PLUS: "Press Plus ('+', key code $06)",
	PRESS_ASTERISK: "Press Asterisk ('*', key code $07)",
	PRESS_O: "Press O (key code $08)",
	PRESS_CODE_09: "Press key $09 (key code $09)",
	PRESS_P: "Press P (key code $0A)",
	PRESS_U: "Press U (key code $0B)",
	PRESS_RETURN: "Press Return (key code $0C)",
	PRESS_I: "Press I (key code $0D)",
	PRESS_MINUS: "Press Minus ('-', key code $0E)",
	PRESS_EQUALS: "Press Equals ('=', key code $0F)",
	PRESS_V: "Press V (key code $10)",
	PRESS_HELP: "Press Help (key code $11)",
	PRESS_C: "Press C (key code $12)",
	PRESS_F3: "Press F3 (Cursor Left function, key code $13)",
	PRESS_F4: "Press F4 (Cursor Right function, key code $14)",
	PRESS_B: "Press B (key code $15)",
	PRESS_X: "Press X (key code $16)",
	PRESS_Z: "Press Z (key code $17)",
	PRESS_4: "Press 4 (key code $18)",
	PRESS_CODE_19: "Press key $19 (key code $19)",
	PRESS_3: "Press 3 (key code $1A)",
	PRESS_6: "Press 6 (key code $1B)",
	PRESS_ESC: "Press Esc ('␛', key code $1C)",
	PRESS_5: "Press 5 (key code $1D)",
	PRESS_2: "Press 2 (key code $1E)",
	PRESS_1: "Press 1 (key code $1F)",
	PRESS_COMMA: "Press Comma (',', key code $20)",
	PRESS_SPACE: "Press Space (key code $21)",
	PRESS_FULL_STOP: "Press Period ('.', key code $22)",
	PRESS_N: "Press N (key code $23)",
	PRESS_CODE_24: "Press key $24 (key code $24)",
	PRESS_M: "Press M (key code $25)",
	PRESS_SLASH: "Press Slash ('/', key code $26)",
	PRESS_INVERSE_VIDEO: "Press Inverse Video (key code $27)",
	PRESS_R: "Press R (key code $28)",
	PRESS_CODE_29: "Press key $29 (key code $29)",
	PRESS_E: "Press E (key code $2A)",
	PRESS_Y: "Press Y (key code $2B)",
	PRESS_TAB: "Press Tab ('▶', key code $2C)",
	PRESS_T: "Press T (key code $2D)",
	PRESS_W: "Press W (key code $2E)",
	PRESS_Q: "Press Q (key code $2F)",
	PRESS_9: "Press 9 (key code $30)",
	PRESS_CODE_31: "Press key $31 (key code $31)",
	PRESS_0: "Press 0 (key code $32)",
	PRESS_7: "Press 7 (key code $33)",
	PRESS_BACKSPACE: "Press Backspace ('◀', key code $34)",
	PRESS_8: "Press 8 (key code $35)",
	PRESS_LESS_THAN: "Press Less Than ('<', key code $36)",
	PRESS_GREATER_THAN: "Press Greater Than ('>', key code $37)",
	PRESS_F: "Press F (key code $38)",
	PRESS_H: "Press H (key code $39)",
	PRESS_D: "Press D (key code $3A)",
	PRESS_CODE_3B: "Press key $3B (key code $3B)",
	PRESS_CAPS: "Press Caps (key code $3C)",
	PRESS_G: "Press G (key code $3D)",
	PRESS_S: "Press S (key code $3E)",
	PRESS_A: "Press A (key code $3F)",

	PRESS_SHIFT_L: "Press Shift+L (key code $40)",
	PRESS_SHIFT_J: "Press Shift+J (key code $41)",
	PRESS_SHIFT_SEMICOLON: "Press Shift+Semicolon (Colon, ':', key code $42)",
	PRESS_SHIFT_F1: "Press Shift+F1 (key code $43)",
	PRESS_SHIFT_F2: "Press Shift+F2 (key code $44)",
	PRESS_SHIFT_K: "Press Shift+K (key code $45)",
	PRESS_SHIFT_PLUS: "Press Shift+Plus (Backslash, '\\', key code $46)",
	PRESS_SHIFT_ASTERISK: "Press Shift+Asterisk (Circumflex, '^', key code $47)",
	PRESS_SHIFT_O: "Press Shift+O (key code $48)",
	PRESS_SHIFT_CODE_09: "Press key $49 (key code $49)",
	PRESS_SHIFT_P: "Press Shift+P (key code $4A)",
	PRESS_SHIFT_U: "Press Shift+U (key code $4B)",
	PRESS_SHIFT_RETURN: "Press Shift+Return (key code $4C)",
	PRESS_SHIFT_I: "Press Shift+I (key code $4D)",
	PRESS_SHIFT_MINUS: "Press Shift+Minus (Underscore, '_', key code $4E)",
	PRESS_SHIFT_EQUALS: "Press Shift+Equals (Vertical Line, '|', key code $4F)",
	PRESS_SHIFT_V: "Press Shift+V (key code $50)",
	PRESS_SHIFT_HELP: "Press Shift+Help (key code $51)",
	PRESS_SHIFT_C: "Press Shift+C (key code $52)",
	PRESS_SHIFT_F3: "Press Shift+F3 (key code $53)",
	PRESS_SHIFT_F4: "Press Shift+F4 (key code $54)",
	PRESS_SHIFT_B: "Press Shift+B (key code $55)",
	PRESS_SHIFT_X: "Press Shift+X (key code $56)",
	PRESS_SHIFT_Z: "Press Shift+Z (key code $57)",
	PRESS_SHIFT_4: "Press Shift+4 (Dollar Sign, '$', key code $58)",
	PRESS_SHIFT_CODE_19: "Press key $19 (key code $59)",
	PRESS_SHIFT_3: "Press Shift+3 (Number Sign, '#', key code $5A)",
	PRESS_SHIFT_6: "Press Shift+6 (Ampersand, '&', key code $5B)",
	PRESS_SHIFT_ESC: "Press Shift+Esc (key code $5C)",
	PRESS_SHIFT_5: "Press Shift+5 (Percent Sign, '%', key code $5D)",
	PRESS_SHIFT_2: "Press Shift+2 (Quotation Mark, '\"', key code $5E)",
	PRESS_SHIFT_1: "Press Shift+1 (Exclamation Mark, '!', key code $5F)",
	PRESS_SHIFT_COMMA:
		"Press Shift+Comma (Left Square Bracket, '[', key code $60)",
	PRESS_SHIFT_SPACE: "Press Shift+Space (key code $61)",
	PRESS_SHIFT_FULL_STOP:
		"Press Shift+Full Stop (Right Square Bracket, ']', key code $62)",
	PRESS_SHIFT_N: "Press Shift+N (key code $63)",
	PRESS_SHIFT_CODE_24: "Press key $24 (key code $64)",
	PRESS_SHIFT_M: "Press Shift+M (key code $65)",
	PRESS_SHIFT_SLASH: "Press Shift+Slash (Question Mark, '?', key code $66)",
	PRESS_SHIFT_INVERSE_VIDEO: "Press Shift+Inverse Video (key code $67)",
	PRESS_SHIFT_R: "Press Shift+R (key code $68)",
	PRESS_SHIFT_CODE_29: "Press key $29 (key code $69)",
	PRESS_SHIFT_E: "Press Shift+E (key code $6A)",
	PRESS_SHIFT_Y: "Press Shift+Y (key code $6B)",
	PRESS_SHIFT_TAB:
		"Press Shift+Tab (Set Tab Stop function, inverted '→' key code $6C)",
	PRESS_SHIFT_T: "Press Shift+T (key code $6D)",
	PRESS_SHIFT_W: "Press Shift+W (key code $6E)",
	PRESS_SHIFT_Q: "Press Shift+Q (key code $6F)",
	PRESS_SHIFT_9: "Press Shift+9 (Left Parenthesis, '(', key code $70)",
	PRESS_SHIFT_CODE_31: "Press key $31 (key code $71)",
	PRESS_SHIFT_0: "Press Shift+0 (Right Parenthesis, ')', key code $72)",
	PRESS_SHIFT_7: "Press Shift+7 (Apostrophe, ''', key code $73)",
	PRESS_SHIFT_BACKSPACE:
		"Press Shift+Backspace (Delete Line function, inverted '↑', key code $74)",
	PRESS_SHIFT_8: "Press Shift+8 (Commercial At, '@', key code $75)",
	PRESS_SHIFT_LESS_THAN:
		"Press Shift+Less Than (Clear Screen function, key code $76)",
	PRESS_SHIFT_GREATER_THAN:
		"Press Shift+Greater Than (Insert Line function, inverted '↓', key code $77)",
	PRESS_SHIFT_F: "Press Shift+F (key code $78)",
	PRESS_SHIFT_H: "Press Shift+H (key code $79)",
	PRESS_SHIFT_D: "Press Shift+D (key code $7A)",
	PRESS_SHIFT_CODE_3B: "Press key $3B (key code $7B)",
	PRESS_SHIFT_CAPS: "Press Shift+Caps (key code $7C)",
	PRESS_SHIFT_G: "Press Shift+G (key code $7D)",
	PRESS_SHIFT_S: "Press Shift+S (key code $7E)",
	PRESS_SHIFT_A: "Press Shift+A (key code $7F)",

	PRESS_CONTROL_L: "Press Control+L (Quadrant Upper Left, '▘', key code $80)",
	PRESS_CONTROL_J:
		"Press Control+J (Black Lower Left Triangle, '◣', key code $81)",
	PRESS_CONTROL_SEMICOLON:
		"Press Control+Semicolon (Black Spade Suit, '♠', key code $82)",
	PRESS_CONTROL_F1:
		"Press Control+F1 (Keyboard Enable/Disable function, key code $83)",
	PRESS_CONTROL_F2:
		"Press Control+F2 (Screen DMA Enable/Disable function, key code $84)",
	PRESS_CONTROL_K: "Press Control+K (Quadrant Upper Right, '▝', key code $85)",
	PRESS_CONTROL_PLUS:
		"Press Control+Plus (Cursor Left function, '←', key code $86)",
	PRESS_CONTROL_ASTERISK:
		"Press Control+Asterisk (Cursor Right function, '→', key code $87)",
	PRESS_CONTROL_O: "Press Control+O (Quadrant Lower Left, '▖', key code $88)",
	PRESS_CONTROL_CODE_89: "Press key $89 (key code $89)",
	PRESS_CONTROL_P: "Press Control+P (Black Club Suit, '♣', key code $8A)",
	PRESS_CONTROL_U: "Press Control+U (Lower Half Block, '▄', key code $8B)",
	PRESS_CONTROL_RETURN: "Press Control+Return (key code $8C)",
	PRESS_CONTROL_I: "Press Control+I (Quadrant Lower Right, '▗', key code $8D)",
	PRESS_CONTROL_MINUS:
		"Press Control+Minus (Cursor Up function, '↑', key code $8E)",
	PRESS_CONTROL_EQUALS:
		"Press Control+Equals (Cursor Down function, '↓', key code $8F)",
	PRESS_CONTROL_V:
		"Press Control+V (Left One Quarter Block, '▎', key code $90)",
	PRESS_CONTROL_HELP: "Press Control+Help (key code $91)",
	PRESS_CONTROL_C:
		"Press Control+C (Box Drawings Light Up and Left, '┘', key code $92)",
	PRESS_CONTROL_F3:
		"Press Control+F3 (Key Clock Enable/Disable function, key code $93)",
	PRESS_CONTROL_F4:
		"Press Control+F4 (Toggle Domestic/International Character Set function, key code $94)",
	PRESS_CONTROL_B:
		"Press Control+B (Right One Quarter Block, '🮇', key code $95)",
	PRESS_CONTROL_X:
		"Press Control+X (Box Drawings Light Up and Horizontal, '┴', key code $96)",
	PRESS_CONTROL_Z:
		"Press Control+Z (Box Drawings Light Up and Right, '└', key code $97)",
	PRESS_CONTROL_4: "Press Control+4 (key code $98)",
	PRESS_CONTROL_CODE_99: "Press key $99 (key code $99)",
	PRESS_CONTROL_3: "Press Control+3 (EOF function, key code $9A)",
	PRESS_CONTROL_6: "Press Control+6 (key code $9B)",
	PRESS_CONTROL_ESC: "Press Control+Esc (key code $9C)",
	PRESS_CONTROL_5: "Press Control+5 (key code $9D)",
	PRESS_CONTROL_2:
		"Press Control+2 (Buzzer function, inverted '🢰', key code $9E)",
	PRESS_CONTROL_1:
		"Press Control+1 (Pause/Resume Screen Output function, key code $9F)",
	PRESS_CONTROL_COMMA:
		"Press Control+Comma (Black Heart Suit, '♥', key code $A0)",
	PRESS_CONTROL_SPACE: "Press Control+Space (key code $A1)",
	PRESS_CONTROL_FULL_STOP:
		"Press Control+Full Stop (Black Diamond Suit, '♦', key code $A2)",
	PRESS_CONTROL_N:
		"Press Control+N (Lower One Quarter Block, '▂', key code $A3)",
	PRESS_CONTROL_CODE_A4: "Press key $A4 (key code $A4)",
	PRESS_CONTROL_M:
		"Press Control+M (Upper One Quarter Block, '🮂', key code $A5)",
	PRESS_CONTROL_SLASH: "Press Control+Slash (key code $A6)",
	PRESS_CONTROL_INVERSE_VIDEO:
		"Press Control+Inverse Video (Control Lock function, key code $A7)",
	PRESS_CONTROL_R:
		"Press Control+R (Box Drawings Light Horizontal, '─', key code $A8)",
	PRESS_CONTROL_CODE_A9: "Press key $A9 (key code $A9)",
	PRESS_CONTROL_E:
		"Press Control+E (Box Drawings Light Down and Left, '┐', key code $AA)",
	PRESS_CONTROL_Y: "Press Control+Y (Left Half Block, '▌', key code $AB)",
	PRESS_CONTROL_TAB:
		"Press Control+Tab (Clear Tab Stop function, inverted '←', key code $AC)",
	PRESS_CONTROL_T: "Press Control+T (Bullet, '•', key code $AD)",
	PRESS_CONTROL_W:
		"Press Control+W (Box Drawings Light Down and Horizontal, '┬', key code $AE)",
	PRESS_CONTROL_Q:
		"Press Control+Q (Box Drawings Light Down and Right, '┌', key code $AF)",
	PRESS_CONTROL_9: "Press Control+9 (key code $B0)",
	PRESS_CONTROL_CODE_B1: "Press key $B1 (key code $B1)",
	PRESS_CONTROL_0: "Press Control+0 (key code $B2)",
	PRESS_CONTROL_7: "Press Control+7 (key code $B3)",
	PRESS_CONTROL_BACKSPACE:
		"Press Control+Backspace (Delete function, inverted '◀', key code $B4)",
	PRESS_CONTROL_8: "Press Control+8 (key code $B5)",
	PRESS_CONTROL_LESS_THAN:
		"Press Control+Less Than (Clear Screen function, key code $B6)",
	PRESS_CONTROL_GREATER_THAN:
		"Press Control+Greater Than (Insert Character function, inverted '▶', key code $B7)",
	PRESS_CONTROL_F:
		"Press Control+F (Box Drawings Light Diagonal Upper Right to Lower Left, '╱', key code $B8)",
	PRESS_CONTROL_H:
		"Press Control+H (Black Lower Right Triangle, '◢', key code $B9)",
	PRESS_CONTROL_D:
		"Press Control+D (Box Drawings Light Vertical and Left, '┤', key code $BA)",
	PRESS_CONTROL_CODE_BB: "Press key $BB (key code $BB)",
	PRESS_CONTROL_CAPS: "Press Control+Caps (key code $BC)",
	PRESS_CONTROL_G:
		"Press Control+G (Box Drawings Light Diagonal Upper Left to Lower Right, '╲', key code $BD)",
	PRESS_CONTROL_S:
		"Press Control+S (Box Drawings Light Vertical and Horizontal, '┼', key code $BE)",
	PRESS_CONTROL_A:
		"Press Control+A (Box Drawings Light Vertical and Right, '├', key code $BF)",

	// TODO: The following eight combinations (C0-C7) are not possible on a real A8 keyboard
	PRESS_CONTROL_SHIFT_L: "Press Control+Shift+L (key code $C0)",
	PRESS_CONTROL_SHIFT_J: "Press Control+Shift+J (key code $C1)",
	PRESS_CONTROL_SHIFT_SEMICOLON: "Press Control+Shift+Semicolon (key code $C2)",
	PRESS_CONTROL_SHIFT_F1:
		"Press Control+Shift+F1 (Cursor Up function, key code $C3)",
	PRESS_CONTROL_SHIFT_F2:
		"Press Control+Shift+F2 (Cursor Down function, key code $C4)",
	PRESS_CONTROL_SHIFT_K: "Press Control+Shift+K (key code $C5)",
	PRESS_CONTROL_SHIFT_PLUS: "Press Control+Shift+Plus (key code $C6)",
	PRESS_CONTROL_SHIFT_ASTERISK: "Press Control+Shift+Asterisk (key code $C7)",
	PRESS_CONTROL_SHIFT_O: "Press Control+Shift+O (key code $C8)",
	PRESS_CONTROL_SHIFT_CODE_09: "Press key $C9 (key code $C9)",
	PRESS_CONTROL_SHIFT_P: "Press Control+Shift+P (key code $CA)",
	PRESS_CONTROL_SHIFT_U: "Press Control+Shift+U (key code $CB)",
	PRESS_CONTROL_SHIFT_RETURN: "Press Control+Shift+Return (key code $CC)",
	PRESS_CONTROL_SHIFT_I: "Press Control+Shift+I (key code $CD)",
	PRESS_CONTROL_SHIFT_MINUS: "Press Control+Shift+Minus (key code $CE)",
	PRESS_CONTROL_SHIFT_EQUALS: "Press Control+Shift+Equals (key code $CF)",
	// TODO: The following eight combinations (D0-D7) are not possible on a real A8 keyboard
	PRESS_CONTROL_SHIFT_V: "Press Control+Shift+V (key code $D0)",
	PRESS_CONTROL_SHIFT_HELP: "Press Control+Shift+Help (key code $D1)",
	PRESS_CONTROL_SHIFT_C: "Press Control+Shift+C (key code $D2)",
	PRESS_CONTROL_SHIFT_F3:
		"Press Control+Shift+F3 (Cursor Left function, key code $D3)",
	PRESS_CONTROL_SHIFT_F4:
		"Press Control+Shift+F4 (Cursor Right function, key code $D4)",
	PRESS_CONTROL_SHIFT_B: "Press Control+Shift+B (key code $D5)",
	PRESS_CONTROL_SHIFT_X: "Press Control+Shift+X (key code $D6)",
	PRESS_CONTROL_SHIFT_Z: "Press Control+Shift+Z (key code $D7)",
	PRESS_CONTROL_SHIFT_4: "Press Control+Shift+4 (key code $D8)",
	PRESS_CONTROL_SHIFT_CODE_19: "Press key $D9 (key code $D9)",
	PRESS_CONTROL_SHIFT_3: "Press Control+Shift+3 (key code $DA)",
	PRESS_CONTROL_SHIFT_6: "Press Control+Shift+6 (key code $DB)",
	PRESS_CONTROL_SHIFT_ESC: "Press Control+Shift+Esc (key code $DC)",
	PRESS_CONTROL_SHIFT_5: "Press Control+Shift+5 (key code $DD)",
	PRESS_CONTROL_SHIFT_2: "Press Control+Shift+2 (key code $DE)",
	PRESS_CONTROL_SHIFT_1: "Press Control+Shift+1 (key code $DF)",
	PRESS_CONTROL_SHIFT_COMMA: "Press Control+Shift+Comma (key code $E0)",
	PRESS_CONTROL_SHIFT_SPACE: "Press Control+Shift+Space (key code $E1)",
	PRESS_CONTROL_SHIFT_FULL_STOP: "Press Control+Shift+Full Stop (key code $E2)",
	PRESS_CONTROL_SHIFT_N: "Press Control+Shift+N (key code $E3)",
	PRESS_CONTROL_SHIFT_CODE_24: "Press key $E4 (key code $E4)",
	PRESS_CONTROL_SHIFT_M: "Press Control+Shift+M (key code $E5)",
	PRESS_CONTROL_SHIFT_SLASH: "Press Control+Shift+Slash (key code $E6)",
	PRESS_CONTROL_SHIFT_INVERSE_VIDEO:
		"Press Control+Shift+Inverse Video (key code $E7)",
	PRESS_CONTROL_SHIFT_R: "Press Control+Shift+R (key code $E8)",
	PRESS_CONTROL_SHIFT_CODE_29: "Press key $E9 (key code $E9)",
	PRESS_CONTROL_SHIFT_E: "Press Control+Shift+E (key code $EA)",
	PRESS_CONTROL_SHIFT_Y: "Press Control+Shift+Y (key code $EB)",
	PRESS_CONTROL_SHIFT_TAB: "Press Control+Shift+Tab (key code $EC)",
	PRESS_CONTROL_SHIFT_T: "Press Control+Shift+T (key code $ED)",
	PRESS_CONTROL_SHIFT_W: "Press Control+Shift+W (key code $EE)",
	PRESS_CONTROL_SHIFT_Q: "Press Control+Shift+Q (key code $EF)",
	PRESS_CONTROL_SHIFT_9: "Press Control+Shift+9 (key code $F0)",
	PRESS_CONTROL_SHIFT_CODE_31: "Press key $F1 (key code $F1)",
	PRESS_CONTROL_SHIFT_0: "Press Control+Shift+0 (key code $F2)",
	PRESS_CONTROL_SHIFT_7: "Press Control+Shift+7 (key code $F3)",
	PRESS_CONTROL_SHIFT_BACKSPACE: "Press Control+Shift+Backspace (key code $F4)",
	PRESS_CONTROL_SHIFT_8: "Press Control+Shift+8 (key code $F5)",
	PRESS_CONTROL_SHIFT_LESS_THAN: "Press Control+Shift+Less Than (key code $F6)",
	PRESS_CONTROL_SHIFT_GREATER_THAN:
		"Press Control+Shift+Greater Than (key code $F7)",
	PRESS_CONTROL_SHIFT_F: "Press Control+Shift+F (key code $F8)",
	PRESS_CONTROL_SHIFT_H: "Press Control+Shift+H (key code $F9)",
	PRESS_CONTROL_SHIFT_D: "Press Control+Shift+D (key code $FA)",
	PRESS_CONTROL_SHIFT_CODE_3B: "Press key $FB (key code $FB)",
	PRESS_CONTROL_SHIFT_CAPS: "Press Control+Shift+Caps (key code $FC)",
	PRESS_CONTROL_SHIFT_G: "Press Control+Shift+G (key code $FD)",
	PRESS_CONTROL_SHIFT_S: "Press Control+Shift+S (key code $FE)",
	PRESS_CONTROL_SHIFT_A: "Press Control+Shift+A (key code $FF)",

	RELEASE_POKEY_KEY: "Release regular POKEY key",

	PRESS_RESET: "Press Reset",
	RELEASE_RESET: "Release Reset",

	PRESS_SHIFT: "Press Shift",
	RELEASE_SHIFT: "Release Shift",

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
};

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
