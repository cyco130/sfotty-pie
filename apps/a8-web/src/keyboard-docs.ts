// Atari 8-bit keyboard reference: one entry per physical key in KEYS, with
// the per-key character/function data deduplicated into the FUNCTIONS table.
// KEYS entries reference FUNCTIONS by key (see FunctionRef).

export interface FunctionDescription {
	name: string;
	pseudoAtascii?: number;
	asciiEquivalent?: string;
	ansiEquivalent?: string;
	ctrlKeyEquivalent?: string;
	pcKeyEquivalent?: string;
	// Serviced directly in the keyboard IRQ before KEYDEF translation, so it
	// can't be remapped.
	handledInKeyboardIrq?: boolean;
	notes?: string[];
}

export interface PrintableAtascii {
	code: number;
	glyph: string;
	name: string;
	replacesAscii?: string;
	altGlyph?: {
		glyph: string;
		name: string;
	};
}

export interface AtasciiFunction extends FunctionDescription {
	code: number;
	glyph: string;
	glyphName: string;
	replacesAscii?: string;
}

// A key press yields a printable ATASCII glyph (PrintableAtascii), a control
// code with a named function (AtasciiFunction), or a pseudo-ATASCII / IRQ
// function with no character at all (plain FunctionDescription).
export type KeyFunction =
	| PrintableAtascii
	| AtasciiFunction
	| FunctionDescription;

// Each entry is keyed by its glyph if it's a plain ASCII printable character, by
// its ATASCII hex code ("0x1b") if it's an Atari graphics / control / pseudo
// code, or by a short name ("RESET") if it has no ATASCII representation at all.
export const FUNCTIONS = {
	"0x00": {
		code: 0x00, // 0
		glyph: "♥",
		name: "BLACK HEART SUIT",
		replacesAscii: "NUL (Null)",
		altGlyph: {
			glyph: "á",
			name: "LATIN SMALL LETTER A WITH ACUTE",
		},
	},
	"0x01": {
		code: 0x01, // 1
		glyph: "├",
		name: "BOX DRAWINGS LIGHT VERTICAL AND RIGHT",
		replacesAscii: "SOH (Start of Heading)",
		altGlyph: {
			glyph: "ù",
			name: "LATIN SMALL LETTER U WITH GRAVE",
		},
	},
	"0x02": {
		code: 0x02, // 2
		glyph: "▕",
		name: "RIGHT ONE EIGHTH BLOCK",
		replacesAscii: "STX (Start of Text)",
		altGlyph: {
			glyph: "Ñ",
			name: "LATIN CAPITAL LETTER N WITH TILDE",
		},
	},
	"0x03": {
		code: 0x03, // 3
		glyph: "┘",
		name: "BOX DRAWINGS LIGHT UP AND LEFT",
		replacesAscii: "ETX (End of Text)",
		altGlyph: {
			glyph: "É",
			name: "LATIN CAPITAL LETTER E WITH ACUTE",
		},
	},
	"0x04": {
		code: 0x04, // 4
		glyph: "┤",
		name: "BOX DRAWINGS LIGHT VERTICAL AND LEFT",
		replacesAscii: "EOT (End of Transmission)",
		altGlyph: {
			glyph: "ç",
			name: "LATIN SMALL LETTER C WITH CEDILLA",
		},
	},
	"0x05": {
		code: 0x05, // 5
		glyph: "┐",
		name: "BOX DRAWINGS LIGHT DOWN AND LEFT",
		replacesAscii: "ENQ (Enquiry)",
		altGlyph: {
			glyph: "ô",
			name: "LATIN SMALL LETTER O WITH CIRCUMFLEX",
		},
	},
	"0x06": {
		code: 0x06, // 6
		glyph: "╱",
		name: "BOX DRAWINGS LIGHT DIAGONAL UPPER RIGHT TO LOWER LEFT",
		replacesAscii: "ACK (Acknowledgement)",
		altGlyph: {
			glyph: "ò",
			name: "LATIN SMALL LETTER O WITH GRAVE",
		},
	},
	"0x07": {
		code: 0x07, // 7
		glyph: "╲",
		name: "BOX DRAWINGS LIGHT DIAGONAL UPPER LEFT TO LOWER RIGHT",
		replacesAscii: "BEL (Bell)",
		altGlyph: {
			glyph: "ì",
			name: "LATIN SMALL LETTER I WITH GRAVE",
		},
	},
	"0x08": {
		code: 0x08, // 8
		glyph: "◢",
		name: "BLACK LOWER RIGHT TRIANGLE",
		replacesAscii: "BS (Backspace)",
		altGlyph: {
			glyph: "£",
			name: "POUND SIGN",
		},
	},
	"0x09": {
		code: 0x09, // 9
		glyph: "▗",
		name: "QUADRANT LOWER RIGHT",
		replacesAscii: "HT (Horizontal Tab)",
		altGlyph: {
			glyph: "ï",
			name: "LATIN SMALL LETTER I WITH DIAERESIS",
		},
	},
	"0x0a": {
		code: 0x0a, // 10
		glyph: "◣",
		name: "BLACK LOWER LEFT TRIANGLE",
		replacesAscii: "LF (Line Feed)",
		altGlyph: {
			glyph: "ü",
			name: "LATIN SMALL LETTER U WITH DIAERESIS",
		},
	},
	"0x0b": {
		code: 0x0b, // 11
		glyph: "▝",
		name: "QUADRANT UPPER RIGHT",
		replacesAscii: "VT (Vertical Tab)",
		altGlyph: {
			glyph: "ä",
			name: "LATIN SMALL LETTER A WITH DIAERESIS",
		},
	},
	"0x0c": {
		code: 0x0c, // 12
		glyph: "▘",
		name: "QUADRANT UPPER LEFT",
		replacesAscii: "FF (Form Feed)",
		altGlyph: {
			glyph: "Ö",
			name: "LATIN CAPITAL LETTER O WITH DIAERESIS",
		},
	},
	"0x0d": {
		code: 0x0d, // 13
		glyph: "▔",
		name: "UPPER ONE EIGHTH BLOCK",
		replacesAscii: "CR (Carriage Return)",
		altGlyph: {
			glyph: "ú",
			name: "LATIN SMALL LETTER U WITH ACUTE",
		},
	},
	"0x0e": {
		code: 0x0e, // 14
		glyph: "▁",
		name: "LOWER ONE EIGHTH BLOCK",
		replacesAscii: "SO (Shift Out)",
		altGlyph: {
			glyph: "ó",
			name: "LATIN SMALL LETTER O WITH ACUTE",
		},
	},
	"0x0f": {
		code: 0x0f, // 15
		glyph: "▖",
		name: "QUADRANT LOWER LEFT",
		replacesAscii: "SI (Shift In)",
		altGlyph: {
			glyph: "ö",
			name: "LATIN SMALL LETTER O WITH DIAERESIS",
		},
	},
	"0x10": {
		code: 0x10, // 16
		glyph: "♣",
		name: "BLACK CLUB SUIT",
		replacesAscii: "DLE (Data Link Escape)",
		altGlyph: {
			glyph: "Ü",
			name: "LATIN CAPITAL LETTER U WITH DIAERESIS",
		},
	},
	"0x11": {
		code: 0x11, // 17
		glyph: "┌",
		name: "BOX DRAWINGS LIGHT DOWN AND RIGHT",
		replacesAscii: "DC1 (Device Control 1)",
		altGlyph: {
			glyph: "â",
			name: "LATIN SMALL LETTER A WITH CIRCUMFLEX",
		},
	},
	"0x12": {
		code: 0x12, // 18
		glyph: "─",
		name: "BOX DRAWINGS LIGHT HORIZONTAL",
		replacesAscii: "DC2 (Device Control 2)",
		altGlyph: {
			glyph: "û",
			name: "LATIN SMALL LETTER U WITH CIRCUMFLEX",
		},
	},
	"0x13": {
		code: 0x13, // 19
		glyph: "┼",
		name: "BOX DRAWINGS LIGHT VERTICAL AND HORIZONTAL",
		replacesAscii: "DC3 (Device Control 3)",
		altGlyph: {
			glyph: "î",
			name: "LATIN SMALL LETTER I WITH CIRCUMFLEX",
		},
	},
	"0x14": {
		code: 0x14, // 20
		glyph: "•",
		name: "BULLET",
		replacesAscii: "DC4 (Device Control 4)",
		altGlyph: {
			glyph: "é",
			name: "LATIN SMALL LETTER E WITH ACUTE",
		},
	},
	"0x15": {
		code: 0x15, // 21
		glyph: "▄",
		name: "LOWER HALF BLOCK",
		replacesAscii: "NAK (Negative Acknowledgement)",
		altGlyph: {
			glyph: "è",
			name: "LATIN SMALL LETTER E WITH GRAVE",
		},
	},
	"0x16": {
		code: 0x16, // 22
		glyph: "▏",
		name: "LEFT ONE EIGHTH BLOCK",
		replacesAscii: "SYN (Synchronous Idle)",
		altGlyph: {
			glyph: "ñ",
			name: "LATIN SMALL LETTER N WITH TILDE",
		},
	},
	"0x17": {
		code: 0x17, // 23
		glyph: "┬",
		name: "BOX DRAWINGS LIGHT DOWN AND HORIZONTAL",
		replacesAscii: "ETB (End of Transmission Block)",
		altGlyph: {
			glyph: "ê",
			name: "LATIN SMALL LETTER E WITH CIRCUMFLEX",
		},
	},
	"0x18": {
		code: 0x18, // 24
		glyph: "┴",
		name: "BOX DRAWINGS LIGHT UP AND HORIZONTAL",
		replacesAscii: "CAN (Cancel)",
		altGlyph: {
			glyph: "å",
			name: "LATIN SMALL LETTER A WITH RING ABOVE",
		},
	},
	"0x19": {
		code: 0x19, // 25
		glyph: "▌",
		name: "LEFT HALF BLOCK",
		replacesAscii: "EM (End of Medium)",
		altGlyph: {
			glyph: "à",
			name: "LATIN SMALL LETTER A WITH GRAVE",
		},
	},
	"0x1a": {
		code: 0x1a, // 26
		glyph: "└",
		name: "BOX DRAWINGS LIGHT UP AND RIGHT",
		replacesAscii: "SUB (Substitute)",
		altGlyph: {
			glyph: "Å",
			name: "LATIN CAPITAL LETTER A WITH RING ABOVE",
		},
	},
	"0x1b": {
		code: 0x1b, // 27
		glyph: "␛",
		glyphName: "SYMBOL FOR ESCAPE",
		name: "Escape",
		asciiEquivalent: "\x1b",
		pcKeyEquivalent: "Esc",
	},
	"0x1c": {
		code: 0x1c, // 28
		glyph: "↑",
		glyphName: "UPWARDS ARROW",
		replacesAscii: "FS (File Separator)",
		name: "Cursor up",
		ansiEquivalent: "\x1b[A",
		ctrlKeyEquivalent: "Ctrl+P",
		pcKeyEquivalent: "↑",
	},
	"0x1d": {
		code: 0x1d, // 29
		glyph: "↓",
		glyphName: "DOWNWARDS ARROW",
		replacesAscii: "GS (Group Separator)",
		name: "Cursor down",
		ansiEquivalent: "\x1b[B",
		ctrlKeyEquivalent: "Ctrl+N",
		pcKeyEquivalent: "↓",
	},
	"0x1e": {
		code: 0x1e, // 30
		glyph: "←",
		glyphName: "LEFTWARDS ARROW",
		replacesAscii: "RS (Record Separator)",
		name: "Cursor left",
		ansiEquivalent: "\x1b[D",
		ctrlKeyEquivalent: "Ctrl+B",
		pcKeyEquivalent: "←",
	},
	"0x1f": {
		code: 0x1f, // 31
		glyph: "→",
		glyphName: "RIGHTWARDS ARROW",
		replacesAscii: "US (Unit Separator)",
		name: "Cursor right",
		ansiEquivalent: "\x1b[C",
		ctrlKeyEquivalent: "Ctrl+F",
		pcKeyEquivalent: "→",
	},
	" ": {
		code: 0x20, // 32
		glyph: " ",
		name: "SPACE",
	},
	"!": {
		code: 0x21, // 33
		glyph: "!",
		name: "EXCLAMATION MARK",
	},
	'"': {
		code: 0x22, // 34
		glyph: '"',
		name: "QUOTATION MARK",
	},
	"#": {
		code: 0x23, // 35
		glyph: "#",
		name: "NUMBER SIGN",
	},
	$: {
		code: 0x24, // 36
		glyph: "$",
		name: "DOLLAR SIGN",
	},
	"%": {
		code: 0x25, // 37
		glyph: "%",
		name: "PERCENT SIGN",
	},
	"&": {
		code: 0x26, // 38
		glyph: "&",
		name: "AMPERSAND",
	},
	"'": {
		code: 0x27, // 39
		glyph: "'",
		name: "APOSTROPHE",
	},
	"(": {
		code: 0x28, // 40
		glyph: "(",
		name: "LEFT PARENTHESIS",
	},
	")": {
		code: 0x29, // 41
		glyph: ")",
		name: "RIGHT PARENTHESIS",
	},
	"*": {
		code: 0x2a, // 42
		glyph: "*",
		name: "ASTERISK",
	},
	"+": {
		code: 0x2b, // 43
		glyph: "+",
		name: "PLUS SIGN",
	},
	",": {
		code: 0x2c, // 44
		glyph: ",",
		name: "COMMA",
	},
	"-": {
		code: 0x2d, // 45
		glyph: "-",
		name: "HYPHEN-MINUS",
	},
	".": {
		code: 0x2e, // 46
		glyph: ".",
		name: "FULL STOP",
	},
	"/": {
		code: 0x2f, // 47
		glyph: "/",
		name: "SOLIDUS",
	},
	"0": {
		code: 0x30, // 48
		glyph: "0",
		name: "DIGIT ZERO",
	},
	"1": {
		code: 0x31, // 49
		glyph: "1",
		name: "DIGIT ONE",
	},
	"2": {
		code: 0x32, // 50
		glyph: "2",
		name: "DIGIT TWO",
	},
	"3": {
		code: 0x33, // 51
		glyph: "3",
		name: "DIGIT THREE",
	},
	"4": {
		code: 0x34, // 52
		glyph: "4",
		name: "DIGIT FOUR",
	},
	"5": {
		code: 0x35, // 53
		glyph: "5",
		name: "DIGIT FIVE",
	},
	"6": {
		code: 0x36, // 54
		glyph: "6",
		name: "DIGIT SIX",
	},
	"7": {
		code: 0x37, // 55
		glyph: "7",
		name: "DIGIT SEVEN",
	},
	"8": {
		code: 0x38, // 56
		glyph: "8",
		name: "DIGIT EIGHT",
	},
	"9": {
		code: 0x39, // 57
		glyph: "9",
		name: "DIGIT NINE",
	},
	":": {
		code: 0x3a, // 58
		glyph: ":",
		name: "COLON",
	},
	";": {
		code: 0x3b, // 59
		glyph: ";",
		name: "SEMICOLON",
	},
	"<": {
		code: 0x3c, // 60
		glyph: "<",
		name: "LESS-THAN SIGN",
	},
	"=": {
		code: 0x3d, // 61
		glyph: "=",
		name: "EQUALS SIGN",
	},
	">": {
		code: 0x3e, // 62
		glyph: ">",
		name: "GREATER-THAN SIGN",
	},
	"?": {
		code: 0x3f, // 63
		glyph: "?",
		name: "QUESTION MARK",
	},
	"@": {
		code: 0x40, // 64
		glyph: "@",
		name: "COMMERCIAL AT",
	},
	A: {
		code: 0x41, // 65
		glyph: "A",
		name: "LATIN CAPITAL LETTER A",
	},
	B: {
		code: 0x42, // 66
		glyph: "B",
		name: "LATIN CAPITAL LETTER B",
	},
	C: {
		code: 0x43, // 67
		glyph: "C",
		name: "LATIN CAPITAL LETTER C",
	},
	D: {
		code: 0x44, // 68
		glyph: "D",
		name: "LATIN CAPITAL LETTER D",
	},
	E: {
		code: 0x45, // 69
		glyph: "E",
		name: "LATIN CAPITAL LETTER E",
	},
	F: {
		code: 0x46, // 70
		glyph: "F",
		name: "LATIN CAPITAL LETTER F",
	},
	G: {
		code: 0x47, // 71
		glyph: "G",
		name: "LATIN CAPITAL LETTER G",
	},
	H: {
		code: 0x48, // 72
		glyph: "H",
		name: "LATIN CAPITAL LETTER H",
	},
	I: {
		code: 0x49, // 73
		glyph: "I",
		name: "LATIN CAPITAL LETTER I",
	},
	J: {
		code: 0x4a, // 74
		glyph: "J",
		name: "LATIN CAPITAL LETTER J",
	},
	K: {
		code: 0x4b, // 75
		glyph: "K",
		name: "LATIN CAPITAL LETTER K",
	},
	L: {
		code: 0x4c, // 76
		glyph: "L",
		name: "LATIN CAPITAL LETTER L",
	},
	M: {
		code: 0x4d, // 77
		glyph: "M",
		name: "LATIN CAPITAL LETTER M",
	},
	N: {
		code: 0x4e, // 78
		glyph: "N",
		name: "LATIN CAPITAL LETTER N",
	},
	O: {
		code: 0x4f, // 79
		glyph: "O",
		name: "LATIN CAPITAL LETTER O",
	},
	P: {
		code: 0x50, // 80
		glyph: "P",
		name: "LATIN CAPITAL LETTER P",
	},
	Q: {
		code: 0x51, // 81
		glyph: "Q",
		name: "LATIN CAPITAL LETTER Q",
	},
	R: {
		code: 0x52, // 82
		glyph: "R",
		name: "LATIN CAPITAL LETTER R",
	},
	S: {
		code: 0x53, // 83
		glyph: "S",
		name: "LATIN CAPITAL LETTER S",
	},
	T: {
		code: 0x54, // 84
		glyph: "T",
		name: "LATIN CAPITAL LETTER T",
	},
	U: {
		code: 0x55, // 85
		glyph: "U",
		name: "LATIN CAPITAL LETTER U",
	},
	V: {
		code: 0x56, // 86
		glyph: "V",
		name: "LATIN CAPITAL LETTER V",
	},
	W: {
		code: 0x57, // 87
		glyph: "W",
		name: "LATIN CAPITAL LETTER W",
	},
	X: {
		code: 0x58, // 88
		glyph: "X",
		name: "LATIN CAPITAL LETTER X",
	},
	Y: {
		code: 0x59, // 89
		glyph: "Y",
		name: "LATIN CAPITAL LETTER Y",
	},
	Z: {
		code: 0x5a, // 90
		glyph: "Z",
		name: "LATIN CAPITAL LETTER Z",
	},
	"[": {
		code: 0x5b, // 91
		glyph: "[",
		name: "LEFT SQUARE BRACKET",
	},
	"\\": {
		code: 0x5c, // 92
		glyph: "\\",
		name: "REVERSE SOLIDUS",
	},
	"]": {
		code: 0x5d, // 93
		glyph: "]",
		name: "RIGHT SQUARE BRACKET",
	},
	"^": {
		code: 0x5e, // 94
		glyph: "^",
		name: "CIRCUMFLEX ACCENT",
	},
	_: {
		code: 0x5f, // 95
		glyph: "_",
		name: "LOW LINE",
	},
	"0x60": {
		code: 0x60, // 96
		glyph: "♦",
		name: "BLACK DIAMOND SUIT",
		replacesAscii: "GRAVE ACCENT (`)",
		altGlyph: {
			glyph: "¡",
			name: "INVERTED EXCLAMATION MARK",
		},
	},
	a: {
		code: 0x61, // 97
		glyph: "a",
		name: "LATIN SMALL LETTER A",
	},
	b: {
		code: 0x62, // 98
		glyph: "b",
		name: "LATIN SMALL LETTER B",
	},
	c: {
		code: 0x63, // 99
		glyph: "c",
		name: "LATIN SMALL LETTER C",
	},
	d: {
		code: 0x64, // 100
		glyph: "d",
		name: "LATIN SMALL LETTER D",
	},
	e: {
		code: 0x65, // 101
		glyph: "e",
		name: "LATIN SMALL LETTER E",
	},
	f: {
		code: 0x66, // 102
		glyph: "f",
		name: "LATIN SMALL LETTER F",
	},
	g: {
		code: 0x67, // 103
		glyph: "g",
		name: "LATIN SMALL LETTER G",
	},
	h: {
		code: 0x68, // 104
		glyph: "h",
		name: "LATIN SMALL LETTER H",
	},
	i: {
		code: 0x69, // 105
		glyph: "i",
		name: "LATIN SMALL LETTER I",
	},
	j: {
		code: 0x6a, // 106
		glyph: "j",
		name: "LATIN SMALL LETTER J",
	},
	k: {
		code: 0x6b, // 107
		glyph: "k",
		name: "LATIN SMALL LETTER K",
	},
	l: {
		code: 0x6c, // 108
		glyph: "l",
		name: "LATIN SMALL LETTER L",
	},
	m: {
		code: 0x6d, // 109
		glyph: "m",
		name: "LATIN SMALL LETTER M",
	},
	n: {
		code: 0x6e, // 110
		glyph: "n",
		name: "LATIN SMALL LETTER N",
	},
	o: {
		code: 0x6f, // 111
		glyph: "o",
		name: "LATIN SMALL LETTER O",
	},
	p: {
		code: 0x70, // 112
		glyph: "p",
		name: "LATIN SMALL LETTER P",
	},
	q: {
		code: 0x71, // 113
		glyph: "q",
		name: "LATIN SMALL LETTER Q",
	},
	r: {
		code: 0x72, // 114
		glyph: "r",
		name: "LATIN SMALL LETTER R",
	},
	s: {
		code: 0x73, // 115
		glyph: "s",
		name: "LATIN SMALL LETTER S",
	},
	t: {
		code: 0x74, // 116
		glyph: "t",
		name: "LATIN SMALL LETTER T",
	},
	u: {
		code: 0x75, // 117
		glyph: "u",
		name: "LATIN SMALL LETTER U",
	},
	v: {
		code: 0x76, // 118
		glyph: "v",
		name: "LATIN SMALL LETTER V",
	},
	w: {
		code: 0x77, // 119
		glyph: "w",
		name: "LATIN SMALL LETTER W",
	},
	x: {
		code: 0x78, // 120
		glyph: "x",
		name: "LATIN SMALL LETTER X",
	},
	y: {
		code: 0x79, // 121
		glyph: "y",
		name: "LATIN SMALL LETTER Y",
	},
	z: {
		code: 0x7a, // 122
		glyph: "z",
		name: "LATIN SMALL LETTER Z",
	},
	"0x7b": {
		code: 0x7b, // 123
		glyph: "♠",
		name: "BLACK SPADE SUIT",
		replacesAscii: "LEFT CURLY BRACKET ({)",
		altGlyph: {
			glyph: "Ä",
			name: "LATIN CAPITAL LETTER A WITH DIAERESIS",
		},
	},
	"|": {
		code: 0x7c, // 124
		glyph: "|",
		name: "VERTICAL LINE",
	},
	"0x7d": {
		code: 0x7d, // 125
		glyph: "↖",
		glyphName: "NORTH WEST ARROW",
		replacesAscii: "RIGHT CURLY BRACKET (})",
		name: "Clear screen",
		asciiEquivalent: "\f",
		ansiEquivalent: "\x1b[2J\x1b[H",
		ctrlKeyEquivalent: "Ctrl+L",
	},
	"0x7e": {
		code: 0x7e, // 126
		glyph: "◀",
		glyphName: "BLACK LEFT-POINTING TRIANGLE",
		replacesAscii: "TILDE (~)",
		name: "Backspace",
		asciiEquivalent: "\b",
		ansiEquivalent: "\b \b",
		ctrlKeyEquivalent: "Ctrl+H",
		pcKeyEquivalent: "Backspace",
	},
	"0x7f": {
		code: 0x7f, // 127
		glyph: "▶",
		glyphName: "BLACK RIGHT-POINTING TRIANGLE",
		replacesAscii: "DELETE (DEL)",
		name: "Tab",
		asciiEquivalent: "\t",
		ansiEquivalent: "\t",
		ctrlKeyEquivalent: "Ctrl+I",
		pcKeyEquivalent: "Tab",
	},
	"0x81": {
		name: "Toggle inverse video",
		pseudoAtascii: 0x81, // 129
	},
	"0x82": {
		name: "Toggle lowercase mode",
		pseudoAtascii: 0x82, // 130
		pcKeyEquivalent: "Caps Lock",
		notes: [
			"Differs by OS: the 400/800 OS always switches to lowercase mode, whereas the XL/XE OS toggles between lowercase and uppercase.",
		],
	},
	"0x83": {
		name: "Switch to uppercase mode",
		pseudoAtascii: 0x83, // 131
	},
	"0x84": {
		name: "Switch to graphics mode",
		pseudoAtascii: 0x84, // 132
	},
	"0x85": {
		name: "Generate end-of-file condition",
		pseudoAtascii: 0x85, // 133
		asciiEquivalent: "\x04",
		ctrlKeyEquivalent: "Ctrl+D",
	},
	"0x89": {
		name: "Toggle key click enable/disable",
		pseudoAtascii: 0x89, // 137
	},
	"0x8e": {
		name: "Cursor to upper left corner",
		pseudoAtascii: 0x8e, // 142
		ansiEquivalent: "\x1b[H",
		pcKeyEquivalent: "Ctrl+Home",
	},
	"0x8f": {
		name: "Cursor to lower left corner",
		pseudoAtascii: 0x8f, // 143
	},
	"0x90": {
		name: "Cursor to beginning of physical line",
		pseudoAtascii: 0x90, // 144
		asciiEquivalent: "\r",
		ansiEquivalent: "\x1b[G",
		ctrlKeyEquivalent: "Ctrl+A",
		pcKeyEquivalent: "Home",
	},
	"0x91": {
		name: "Cursor to end of physical line",
		pseudoAtascii: 0x91, // 145
		ctrlKeyEquivalent: "Ctrl+E",
		pcKeyEquivalent: "End",
	},
	"0x9b": {
		code: 0x9b, // 155
		glyph: "␛",
		glyphName: "SYMBOL FOR ESCAPE",
		name: "End of line",
		asciiEquivalent: "\n",
		ansiEquivalent: "\r\n",
		ctrlKeyEquivalent: "Ctrl+M",
		pcKeyEquivalent: "Enter",
	},
	"0x9c": {
		code: 0x9c, // 156
		glyph: "↑",
		glyphName: "UPWARDS ARROW",
		replacesAscii: "FS (File Separator)",
		name: "Delete line",
		ansiEquivalent: "\x1b[M",
	},
	"0x9d": {
		code: 0x9d, // 157
		glyph: "↓",
		glyphName: "DOWNWARDS ARROW",
		replacesAscii: "GS (Group Separator)",
		name: "Insert line",
		ansiEquivalent: "\x1b[L",
	},
	"0x9e": {
		code: 0x9e, // 158
		glyph: "←",
		glyphName: "LEFTWARDS ARROW",
		replacesAscii: "RS (Record Separator)",
		name: "Clear tab stop",
		ansiEquivalent: "\x1b[0g",
	},
	"0x9f": {
		code: 0x9f, // 159
		glyph: "→",
		glyphName: "RIGHTWARDS ARROW",
		replacesAscii: "US (Unit Separator)",
		name: "Set tab stop",
		ansiEquivalent: "\x1bH",
	},
	"0xfd": {
		code: 0xfd, // 253
		glyph: "↖",
		glyphName: "NORTH WEST ARROW",
		replacesAscii: "RIGHT CURLY BRACKET (})",
		name: "Bell",
		asciiEquivalent: "\x07",
		ansiEquivalent: "\x07",
		ctrlKeyEquivalent: "Ctrl+G",
	},
	"0xfe": {
		code: 0xfe, // 254
		glyph: "◀",
		glyphName: "BLACK LEFT-POINTING TRIANGLE",
		replacesAscii: "TILDE (~)",
		name: "Delete character",
		asciiEquivalent: "\x7f",
		ansiEquivalent: "\x1b[P",
		ctrlKeyEquivalent: "Ctrl+D",
		pcKeyEquivalent: "Delete",
	},
	"0xff": {
		code: 0xff, // 255
		glyph: "▶",
		glyphName: "BLACK RIGHT-POINTING TRIANGLE",
		replacesAscii: "DELETE (DEL)",
		name: "Insert character",
		ansiEquivalent: "\x1b[@",
	},
	BREAK: {
		name: "Break",
		ctrlKeyEquivalent: "Ctrl+C",
		pcKeyEquivalent: "Ctrl+Break",
	},
	CHARSET: {
		name: "Toggle domestic/international character set",
		handledInKeyboardIrq: true,
		notes: [
			"On the 1988 revision of the Arabic 65XE OS, also toggled by SHIFT+HELP.",
			"Status reflected on LED L2 on the 1200XL.",
		],
	},
	CONTROL: {
		name: "Control",
		pcKeyEquivalent: "Ctrl",
		notes: ["Modifier: selects each key's control character or function."],
	},
	HELP: {
		name: "Help",
		pcKeyEquivalent: "F1",
		notes: [
			"Sets the HELPFG flag ($02DC) for applications to read; has no screen-editor function.",
		],
	},
	KBD_ENABLE: {
		name: "Toggle keyboard enable/disable",
		handledInKeyboardIrq: true,
		notes: ["Status reflected on LED L1 on the 1200XL."],
	},
	OPTION: {
		name: "Option",
		notes: [
			"Read directly from the CONSOL register ($D01F); no fixed OS function.",
			"Held at power-on, disables the built-in BASIC (XL/XE); on the XEGS it also disables the built-in Missile Command.",
		],
	},
	PAUSE: {
		name: "Toggle screen output pause/resume",
		pcKeyEquivalent: "Pause",
		handledInKeyboardIrq: true,
	},
	RESET: {
		name: "Reset",
		notes: [
			"On 400/800, it generates a RESET NMI via ANTIC.",
			"On XL/XE, it generates a real CPU reset.",
		],
	},
	SCREEN_DMA: {
		name: "Toggle screen DMA enable/disable",
		handledInKeyboardIrq: true,
	},
	SELECT: {
		name: "Select",
		notes: [
			"Read directly from the CONSOL register ($D01F); no fixed OS function.",
			"On the XEGS, the power-on console keys choose the boot target: the default is the built-in Missile Command with no keyboard attached, or the computer (BASIC) with a keyboard attached. SELECT inverts that default, OPTION alone disables both BASIC and Missile Command, and OPTION+SELECT together restore the default. START still forces a cassette boot in every case (in game mode it enables Missile Command rather than launching it directly).",
		],
	},
	SHIFT: {
		name: "Shift",
		pcKeyEquivalent: "Shift",
		notes: ["Modifier: selects each key's shifted character or function."],
	},
	START: {
		name: "Start",
		notes: [
			"Read directly from the CONSOL register ($D01F); no fixed OS function.",
			"Held at power-on, boots from cassette instead of disk.",
		],
	},
} satisfies Record<string, KeyFunction>;

// A key into the FUNCTIONS table above.
export type FunctionRef = keyof typeof FUNCTIONS;

export interface Key {
	name: string;
	labels: [primary: string, secondary?: string, tertiary?: string];
	pokeyCode?: number;
	consoleBit?: number;
	row: number; // 0..3: normal rows, 4: space, 5: console, 6: F1-F4.
	column: number; // Index in the row
	function?: FunctionRef; // Absent for modifiers (SHIFT/CONTROL) and console keys.
	withShift?: FunctionRef;
	withControl?: FunctionRef;
	isControlAndShiftScannable?: boolean;
	notes?: string[]; // Layout/labeling differences between Atari models.
}

export const KEYS: Key[] = [
	{
		name: "ESC",
		labels: ["ESC"],
		row: 0,
		column: 0,
		pokeyCode: 0x1c, // 28
		function: "0x1b",
		withShift: "0x1b",
		withControl: "0x1b",
	},
	{
		name: "1",
		labels: ["1", "!"],
		row: 0,
		column: 1,
		pokeyCode: 0x1f, // 31
		function: "1",
		withShift: "!",
		withControl: "PAUSE",
	},
	{
		name: "2",
		labels: ["2", '"'],
		row: 0,
		column: 2,
		pokeyCode: 0x1e, // 30
		function: "2",
		withShift: '"',
		withControl: "0xfd",
	},
	{
		name: "3",
		labels: ["3", "#"],
		row: 0,
		column: 3,
		pokeyCode: 0x1a, // 26
		function: "3",
		withShift: "#",
		withControl: "0x85",
	},
	{
		name: "4",
		labels: ["4", "$"],
		row: 0,
		column: 4,
		pokeyCode: 0x18, // 24
		function: "4",
		withShift: "$",
	},
	{
		name: "5",
		labels: ["5", "%"],
		row: 0,
		column: 5,
		pokeyCode: 0x1d, // 29
		function: "5",
		withShift: "%",
	},
	{
		name: "6",
		labels: ["6", "&"],
		row: 0,
		column: 6,
		pokeyCode: 0x1b, // 27
		function: "6",
		withShift: "&",
	},
	{
		name: "7",
		labels: ["7", "'"],
		row: 0,
		column: 7,
		pokeyCode: 0x33, // 51
		function: "7",
		withShift: "'",
	},
	{
		name: "8",
		labels: ["8", "@"],
		row: 0,
		column: 8,
		pokeyCode: 0x35, // 53
		function: "8",
		withShift: "@",
	},
	{
		name: "9",
		labels: ["9", "("],
		row: 0,
		column: 9,
		pokeyCode: 0x30, // 48
		function: "9",
		withShift: "(",
	},
	{
		name: "0",
		labels: ["0", ")"],
		row: 0,
		column: 10,
		pokeyCode: 0x32, // 50
		function: "0",
		withShift: ")",
	},
	{
		name: "<",
		labels: ["<", "CLEAR"],
		row: 0,
		column: 11,
		pokeyCode: 0x36, // 54
		function: "<",
		withShift: "0x7d",
		withControl: "0x7d",
	},
	{
		name: ">",
		labels: [">", "INSERT"],
		row: 0,
		column: 12,
		pokeyCode: 0x37, // 55
		function: ">",
		withShift: "0x9d",
		withControl: "0xff",
	},
	{
		name: "BACK SPACE",
		labels: ["BACK SPACE", "DELETE"],
		row: 0,
		column: 13,
		pokeyCode: 0x34, // 52
		function: "0x7e",
		withShift: "0x9c",
		withControl: "0xfe",
		notes: ['Labeled "BACK S" on the 400/800 and "Bk Sp" on the XE.'],
	},
	{
		name: "BREAK",
		labels: ["BREAK"],
		row: 0,
		column: 14,
		function: "BREAK",
		notes: ["Moved to the console row on the 1200XL."],
	},
	{
		name: "TAB",
		labels: ["TAB", "SET", "CLR"],
		row: 1,
		column: 0,
		pokeyCode: 0x2c, // 44
		function: "0x7f",
		withShift: "0x9f",
		withControl: "0x9e",
	},
	{
		name: "Q",
		labels: ["Q"],
		row: 1,
		column: 1,
		pokeyCode: 0x2f, // 47
		function: "q",
		withShift: "Q",
		withControl: "0x11",
	},
	{
		name: "W",
		labels: ["W"],
		row: 1,
		column: 2,
		pokeyCode: 0x2e, // 46
		function: "w",
		withShift: "W",
		withControl: "0x17",
	},
	{
		name: "E",
		labels: ["E"],
		row: 1,
		column: 3,
		pokeyCode: 0x2a, // 42
		function: "e",
		withShift: "E",
		withControl: "0x05",
	},
	{
		name: "R",
		labels: ["R"],
		row: 1,
		column: 4,
		pokeyCode: 0x28, // 40
		function: "r",
		withShift: "R",
		withControl: "0x12",
	},
	{
		name: "T",
		labels: ["T"],
		row: 1,
		column: 5,
		pokeyCode: 0x2d, // 45
		function: "t",
		withShift: "T",
		withControl: "0x14",
	},
	{
		name: "Y",
		labels: ["Y"],
		row: 1,
		column: 6,
		pokeyCode: 0x2b, // 43
		function: "y",
		withShift: "Y",
		withControl: "0x19",
	},
	{
		name: "U",
		labels: ["U"],
		row: 1,
		column: 7,
		pokeyCode: 0x0b, // 11
		function: "u",
		withShift: "U",
		withControl: "0x15",
	},
	{
		name: "I",
		labels: ["I"],
		row: 1,
		column: 8,
		pokeyCode: 0x0d, // 13
		function: "i",
		withShift: "I",
		withControl: "0x09",
	},
	{
		name: "O",
		labels: ["O"],
		row: 1,
		column: 9,
		pokeyCode: 0x08, // 8
		function: "o",
		withShift: "O",
		withControl: "0x0f",
	},
	{
		name: "P",
		labels: ["P"],
		row: 1,
		column: 10,
		pokeyCode: 0x0a, // 10
		function: "p",
		withShift: "P",
		withControl: "0x10",
	},
	{
		name: "-",
		labels: ["-", "_", "↑"],
		row: 1,
		column: 11,
		pokeyCode: 0x0e, // 14
		function: "-",
		withShift: "_",
		withControl: "0x1c",
	},
	{
		name: "=",
		labels: ["=", "|", "↓"],
		row: 1,
		column: 12,
		pokeyCode: 0x0f, // 15
		function: "=",
		withShift: "|",
		withControl: "0x1d",
	},
	{
		name: "RETURN",
		labels: ["RETURN"],
		row: 1,
		column: 13,
		pokeyCode: 0x0c, // 12
		function: "0x9b",
		withShift: "0x9b",
		withControl: "0x9b",
	},
	{
		name: "CONTROL",
		labels: ["CONTROL"],
		row: 2,
		column: 0,
		function: "CONTROL",
		notes: ['Labeled "CTRL" on the 400/800.'],
	},
	{
		name: "A",
		labels: ["A"],
		row: 2,
		column: 1,
		pokeyCode: 0x3f, // 63
		function: "a",
		withShift: "A",
		withControl: "0x01",
	},
	{
		name: "S",
		labels: ["S"],
		row: 2,
		column: 2,
		pokeyCode: 0x3e, // 62
		function: "s",
		withShift: "S",
		withControl: "0x13",
	},
	{
		name: "D",
		labels: ["D"],
		row: 2,
		column: 3,
		pokeyCode: 0x3a, // 58
		function: "d",
		withShift: "D",
		withControl: "0x04",
	},
	{
		name: "F",
		labels: ["F"],
		row: 2,
		column: 4,
		pokeyCode: 0x38, // 56
		function: "f",
		withShift: "F",
		withControl: "0x06",
	},
	{
		name: "G",
		labels: ["G"],
		row: 2,
		column: 5,
		pokeyCode: 0x3d, // 61
		function: "g",
		withShift: "G",
		withControl: "0x07",
	},
	{
		name: "H",
		labels: ["H"],
		row: 2,
		column: 6,
		pokeyCode: 0x39, // 57
		function: "h",
		withShift: "H",
		withControl: "0x08",
	},
	{
		name: "J",
		labels: ["J"],
		row: 2,
		column: 7,
		pokeyCode: 0x01, // 1
		function: "j",
		withShift: "J",
		withControl: "0x0a",
		isControlAndShiftScannable: false,
	},
	{
		name: "K",
		labels: ["K"],
		row: 2,
		column: 8,
		pokeyCode: 0x05, // 5
		function: "k",
		withShift: "K",
		withControl: "0x0b",
		isControlAndShiftScannable: false,
	},
	{
		name: "L",
		labels: ["L"],
		row: 2,
		column: 9,
		pokeyCode: 0x00, // 0
		function: "l",
		withShift: "L",
		withControl: "0x0c",
		isControlAndShiftScannable: false,
	},
	{
		name: ";",
		labels: [";", ":"],
		row: 2,
		column: 10,
		pokeyCode: 0x02, // 2
		function: ";",
		withShift: ":",
		withControl: "0x7b",
		isControlAndShiftScannable: false,
	},
	{
		name: "+",
		labels: ["+", "\\", "←"],
		row: 2,
		column: 11,
		pokeyCode: 0x06, // 6
		function: "+",
		withShift: "\\",
		withControl: "0x1e",
		isControlAndShiftScannable: false,
	},
	{
		name: "*",
		labels: ["*", "^", "→"],
		row: 2,
		column: 12,
		pokeyCode: 0x07, // 7
		function: "*",
		withShift: "^",
		withControl: "0x1f",
		isControlAndShiftScannable: false,
	},
	{
		name: "CAPS",
		labels: ["CAPS"],
		row: 2,
		column: 13,
		pokeyCode: 0x3c, // 60
		function: "0x82",
		withShift: "0x83",
		withControl: "0x84",
		notes: [
			'On the 400/800, the primary label is "LOWR" and CAPS is the secondary label.',
		],
	},
	{
		name: "SHIFT",
		labels: ["SHIFT"],
		row: 3,
		column: 0,
		function: "SHIFT",
	},
	{
		name: "Z",
		labels: ["Z"],
		row: 3,
		column: 1,
		pokeyCode: 0x17, // 23
		function: "z",
		withShift: "Z",
		withControl: "0x1a",
		isControlAndShiftScannable: false,
	},
	{
		name: "X",
		labels: ["X"],
		row: 3,
		column: 2,
		pokeyCode: 0x16, // 22
		function: "x",
		withShift: "X",
		withControl: "0x18",
		isControlAndShiftScannable: false,
	},
	{
		name: "C",
		labels: ["C"],
		row: 3,
		column: 3,
		pokeyCode: 0x12, // 18
		function: "c",
		withShift: "C",
		withControl: "0x03",
		isControlAndShiftScannable: false,
	},
	{
		name: "V",
		labels: ["V"],
		row: 3,
		column: 4,
		pokeyCode: 0x10, // 16
		function: "v",
		withShift: "V",
		withControl: "0x16",
		isControlAndShiftScannable: false,
	},
	{
		name: "B",
		labels: ["B"],
		row: 3,
		column: 5,
		pokeyCode: 0x15, // 21
		function: "b",
		withShift: "B",
		withControl: "0x02",
		isControlAndShiftScannable: false,
	},
	{
		name: "N",
		labels: ["N"],
		row: 3,
		column: 6,
		pokeyCode: 0x23, // 35
		function: "n",
		withShift: "N",
		withControl: "0x0e",
	},
	{
		name: "M",
		labels: ["M"],
		row: 3,
		column: 7,
		pokeyCode: 0x25, // 37
		function: "m",
		withShift: "M",
		withControl: "0x0d",
	},
	{
		name: ",",
		labels: [",", "["],
		row: 3,
		column: 8,
		pokeyCode: 0x20, // 32
		function: ",",
		withShift: "[",
		withControl: "0x00",
	},
	{
		name: ".",
		labels: [".", "]"],
		row: 3,
		column: 9,
		pokeyCode: 0x22, // 34
		function: ".",
		withShift: "]",
		withControl: "0x60",
	},
	{
		name: "/",
		labels: ["/", "?"],
		row: 3,
		column: 10,
		pokeyCode: 0x26, // 38
		function: "/",
		withShift: "?",
	},
	{
		name: "◩",
		labels: ["◩"],
		row: 3,
		column: 11,
		pokeyCode: 0x27, // 39
		function: "0x81",
		withShift: "0x81",
		withControl: "0x81",
		notes: [
			"On the 400/800, labeled with the Atari Fuji logo.",
			"Moved to the console row on the 1200XL.",
			"Swapped with the adjacent right SHIFT between the 400/800 and XL/XE.",
		],
	},
	{
		name: "SHIFT",
		labels: ["SHIFT"],
		row: 3,
		column: 12,
		function: "SHIFT",
		notes: ["Swapped with the adjacent ◩ key between the 400/800 and XL/XE."],
	},
	{
		name: "SPACE",
		labels: ["SPACE"],
		row: 4,
		column: 0,
		pokeyCode: 0x21, // 33
		function: " ",
		withShift: " ",
		withControl: " ",
	},
	{
		name: "RESET",
		labels: ["RESET"],
		row: 5,
		column: 0,
		function: "RESET",
		notes: ['Labeled "SYSTEM RESET" on the 400/800.'],
	},
	{
		name: "OPTION",
		labels: ["OPTION"],
		row: 5,
		column: 1,
		function: "OPTION",
		consoleBit: 2,
	},
	{
		name: "SELECT",
		labels: ["SELECT"],
		row: 5,
		column: 2,
		function: "SELECT",
		consoleBit: 1,
	},
	{
		name: "START",
		labels: ["START"],
		row: 5,
		column: 3,
		function: "START",
		consoleBit: 0,
	},
	{
		name: "HELP",
		labels: ["HELP"],
		row: 5,
		column: 4,
		pokeyCode: 0x11, // 17
		function: "HELP",
		isControlAndShiftScannable: false,
		notes: ["XL/XE only."],
	},
	{
		name: "F1",
		labels: ["F1"],
		row: 6,
		column: 0,
		pokeyCode: 0x03, // 3
		function: "0x1c",
		withShift: "0x8e",
		withControl: "KBD_ENABLE",
		isControlAndShiftScannable: false,
		notes: ["1200XL only."],
	},
	{
		name: "F2",
		labels: ["F2"],
		row: 6,
		column: 1,
		pokeyCode: 0x04, // 4
		function: "0x1d",
		withShift: "0x8f",
		withControl: "SCREEN_DMA",
		isControlAndShiftScannable: false,
		notes: ["1200XL only."],
	},
	{
		name: "F3",
		labels: ["F3"],
		row: 6,
		column: 2,
		pokeyCode: 0x13, // 19
		function: "0x1e",
		withShift: "0x90",
		withControl: "0x89",
		isControlAndShiftScannable: false,
		notes: ["1200XL only."],
	},
	{
		name: "F4",
		labels: ["F4"],
		row: 6,
		column: 3,
		pokeyCode: 0x14, // 20
		function: "0x1f",
		withShift: "0x91",
		withControl: "CHARSET",
		isControlAndShiftScannable: false,
		notes: ["1200XL only."],
	},
];
