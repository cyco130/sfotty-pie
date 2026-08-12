// ATASCII code -> Unicode code point mapping for the font glyphs, generated
// from the a8-web keyboard reference (apps/a8-web/src/keyboard-docs.ts) and
// checked in as plain data so the package stands alone.
//
// STANDARD covers the full domestic character set (ATASCII $00-$7F). The
// international character set replaces the 29 control-graphics characters
// (ATASCII $00-$1A, $60, $7B) with accented Latin letters; INTERNATIONAL
// lists just those replacements. The two sets map to disjoint Unicode code
// points, so a single font carries both.

export interface MappedChar {
	/** ATASCII code, $00-$7F */
	atascii: number;
	/** Unicode code point the glyph maps to */
	codepoint: number;
	/** Unicode character name */
	name: string;
}

export const STANDARD: readonly MappedChar[] = [
	{ atascii: 0x00, codepoint: 0x2665, name: "BLACK HEART SUIT" }, // ♥
	{
		atascii: 0x01,
		codepoint: 0x251c,
		name: "BOX DRAWINGS LIGHT VERTICAL AND RIGHT",
	}, // ├
	{ atascii: 0x02, codepoint: 0x2595, name: "RIGHT ONE EIGHTH BLOCK" }, // ▕
	{ atascii: 0x03, codepoint: 0x2518, name: "BOX DRAWINGS LIGHT UP AND LEFT" }, // ┘
	{
		atascii: 0x04,
		codepoint: 0x2524,
		name: "BOX DRAWINGS LIGHT VERTICAL AND LEFT",
	}, // ┤
	{
		atascii: 0x05,
		codepoint: 0x2510,
		name: "BOX DRAWINGS LIGHT DOWN AND LEFT",
	}, // ┐
	{
		atascii: 0x06,
		codepoint: 0x2571,
		name: "BOX DRAWINGS LIGHT DIAGONAL UPPER RIGHT TO LOWER LEFT",
	}, // ╱
	{
		atascii: 0x07,
		codepoint: 0x2572,
		name: "BOX DRAWINGS LIGHT DIAGONAL UPPER LEFT TO LOWER RIGHT",
	}, // ╲
	{ atascii: 0x08, codepoint: 0x25e2, name: "BLACK LOWER RIGHT TRIANGLE" }, // ◢
	{ atascii: 0x09, codepoint: 0x2597, name: "QUADRANT LOWER RIGHT" }, // ▗
	{ atascii: 0x0a, codepoint: 0x25e3, name: "BLACK LOWER LEFT TRIANGLE" }, // ◣
	{ atascii: 0x0b, codepoint: 0x259d, name: "QUADRANT UPPER RIGHT" }, // ▝
	{ atascii: 0x0c, codepoint: 0x2598, name: "QUADRANT UPPER LEFT" }, // ▘
	{ atascii: 0x0d, codepoint: 0x2594, name: "UPPER ONE EIGHTH BLOCK" }, // ▔
	{ atascii: 0x0e, codepoint: 0x2581, name: "LOWER ONE EIGHTH BLOCK" }, // ▁
	{ atascii: 0x0f, codepoint: 0x2596, name: "QUADRANT LOWER LEFT" }, // ▖
	{ atascii: 0x10, codepoint: 0x2663, name: "BLACK CLUB SUIT" }, // ♣
	{
		atascii: 0x11,
		codepoint: 0x250c,
		name: "BOX DRAWINGS LIGHT DOWN AND RIGHT",
	}, // ┌
	{ atascii: 0x12, codepoint: 0x2500, name: "BOX DRAWINGS LIGHT HORIZONTAL" }, // ─
	{
		atascii: 0x13,
		codepoint: 0x253c,
		name: "BOX DRAWINGS LIGHT VERTICAL AND HORIZONTAL",
	}, // ┼
	{ atascii: 0x14, codepoint: 0x2022, name: "BULLET" }, // •
	{ atascii: 0x15, codepoint: 0x2584, name: "LOWER HALF BLOCK" }, // ▄
	{ atascii: 0x16, codepoint: 0x258f, name: "LEFT ONE EIGHTH BLOCK" }, // ▏
	{
		atascii: 0x17,
		codepoint: 0x252c,
		name: "BOX DRAWINGS LIGHT DOWN AND HORIZONTAL",
	}, // ┬
	{
		atascii: 0x18,
		codepoint: 0x2534,
		name: "BOX DRAWINGS LIGHT UP AND HORIZONTAL",
	}, // ┴
	{ atascii: 0x19, codepoint: 0x258c, name: "LEFT HALF BLOCK" }, // ▌
	{ atascii: 0x1a, codepoint: 0x2514, name: "BOX DRAWINGS LIGHT UP AND RIGHT" }, // └
	{ atascii: 0x1b, codepoint: 0x241b, name: "SYMBOL FOR ESCAPE" }, // ␛
	{ atascii: 0x1c, codepoint: 0x2191, name: "UPWARDS ARROW" }, // ↑
	{ atascii: 0x1d, codepoint: 0x2193, name: "DOWNWARDS ARROW" }, // ↓
	{ atascii: 0x1e, codepoint: 0x2190, name: "LEFTWARDS ARROW" }, // ←
	{ atascii: 0x1f, codepoint: 0x2192, name: "RIGHTWARDS ARROW" }, // →
	{ atascii: 0x20, codepoint: 0x0020, name: "SPACE" }, //
	{ atascii: 0x21, codepoint: 0x0021, name: "EXCLAMATION MARK" }, // !
	{ atascii: 0x22, codepoint: 0x0022, name: "QUOTATION MARK" }, // "
	{ atascii: 0x23, codepoint: 0x0023, name: "NUMBER SIGN" }, // #
	{ atascii: 0x24, codepoint: 0x0024, name: "DOLLAR SIGN" }, // $
	{ atascii: 0x25, codepoint: 0x0025, name: "PERCENT SIGN" }, // %
	{ atascii: 0x26, codepoint: 0x0026, name: "AMPERSAND" }, // &
	{ atascii: 0x27, codepoint: 0x0027, name: "APOSTROPHE" }, // '
	{ atascii: 0x28, codepoint: 0x0028, name: "LEFT PARENTHESIS" }, // (
	{ atascii: 0x29, codepoint: 0x0029, name: "RIGHT PARENTHESIS" }, // )
	{ atascii: 0x2a, codepoint: 0x002a, name: "ASTERISK" }, // *
	{ atascii: 0x2b, codepoint: 0x002b, name: "PLUS SIGN" }, // +
	{ atascii: 0x2c, codepoint: 0x002c, name: "COMMA" }, // ,
	{ atascii: 0x2d, codepoint: 0x002d, name: "HYPHEN-MINUS" }, // -
	{ atascii: 0x2e, codepoint: 0x002e, name: "FULL STOP" }, // .
	{ atascii: 0x2f, codepoint: 0x002f, name: "SOLIDUS" }, // /
	{ atascii: 0x30, codepoint: 0x0030, name: "DIGIT ZERO" }, // 0
	{ atascii: 0x31, codepoint: 0x0031, name: "DIGIT ONE" }, // 1
	{ atascii: 0x32, codepoint: 0x0032, name: "DIGIT TWO" }, // 2
	{ atascii: 0x33, codepoint: 0x0033, name: "DIGIT THREE" }, // 3
	{ atascii: 0x34, codepoint: 0x0034, name: "DIGIT FOUR" }, // 4
	{ atascii: 0x35, codepoint: 0x0035, name: "DIGIT FIVE" }, // 5
	{ atascii: 0x36, codepoint: 0x0036, name: "DIGIT SIX" }, // 6
	{ atascii: 0x37, codepoint: 0x0037, name: "DIGIT SEVEN" }, // 7
	{ atascii: 0x38, codepoint: 0x0038, name: "DIGIT EIGHT" }, // 8
	{ atascii: 0x39, codepoint: 0x0039, name: "DIGIT NINE" }, // 9
	{ atascii: 0x3a, codepoint: 0x003a, name: "COLON" }, // :
	{ atascii: 0x3b, codepoint: 0x003b, name: "SEMICOLON" }, // ;
	{ atascii: 0x3c, codepoint: 0x003c, name: "LESS-THAN SIGN" }, // <
	{ atascii: 0x3d, codepoint: 0x003d, name: "EQUALS SIGN" }, // =
	{ atascii: 0x3e, codepoint: 0x003e, name: "GREATER-THAN SIGN" }, // >
	{ atascii: 0x3f, codepoint: 0x003f, name: "QUESTION MARK" }, // ?
	{ atascii: 0x40, codepoint: 0x0040, name: "COMMERCIAL AT" }, // @
	{ atascii: 0x41, codepoint: 0x0041, name: "LATIN CAPITAL LETTER A" }, // A
	{ atascii: 0x42, codepoint: 0x0042, name: "LATIN CAPITAL LETTER B" }, // B
	{ atascii: 0x43, codepoint: 0x0043, name: "LATIN CAPITAL LETTER C" }, // C
	{ atascii: 0x44, codepoint: 0x0044, name: "LATIN CAPITAL LETTER D" }, // D
	{ atascii: 0x45, codepoint: 0x0045, name: "LATIN CAPITAL LETTER E" }, // E
	{ atascii: 0x46, codepoint: 0x0046, name: "LATIN CAPITAL LETTER F" }, // F
	{ atascii: 0x47, codepoint: 0x0047, name: "LATIN CAPITAL LETTER G" }, // G
	{ atascii: 0x48, codepoint: 0x0048, name: "LATIN CAPITAL LETTER H" }, // H
	{ atascii: 0x49, codepoint: 0x0049, name: "LATIN CAPITAL LETTER I" }, // I
	{ atascii: 0x4a, codepoint: 0x004a, name: "LATIN CAPITAL LETTER J" }, // J
	{ atascii: 0x4b, codepoint: 0x004b, name: "LATIN CAPITAL LETTER K" }, // K
	{ atascii: 0x4c, codepoint: 0x004c, name: "LATIN CAPITAL LETTER L" }, // L
	{ atascii: 0x4d, codepoint: 0x004d, name: "LATIN CAPITAL LETTER M" }, // M
	{ atascii: 0x4e, codepoint: 0x004e, name: "LATIN CAPITAL LETTER N" }, // N
	{ atascii: 0x4f, codepoint: 0x004f, name: "LATIN CAPITAL LETTER O" }, // O
	{ atascii: 0x50, codepoint: 0x0050, name: "LATIN CAPITAL LETTER P" }, // P
	{ atascii: 0x51, codepoint: 0x0051, name: "LATIN CAPITAL LETTER Q" }, // Q
	{ atascii: 0x52, codepoint: 0x0052, name: "LATIN CAPITAL LETTER R" }, // R
	{ atascii: 0x53, codepoint: 0x0053, name: "LATIN CAPITAL LETTER S" }, // S
	{ atascii: 0x54, codepoint: 0x0054, name: "LATIN CAPITAL LETTER T" }, // T
	{ atascii: 0x55, codepoint: 0x0055, name: "LATIN CAPITAL LETTER U" }, // U
	{ atascii: 0x56, codepoint: 0x0056, name: "LATIN CAPITAL LETTER V" }, // V
	{ atascii: 0x57, codepoint: 0x0057, name: "LATIN CAPITAL LETTER W" }, // W
	{ atascii: 0x58, codepoint: 0x0058, name: "LATIN CAPITAL LETTER X" }, // X
	{ atascii: 0x59, codepoint: 0x0059, name: "LATIN CAPITAL LETTER Y" }, // Y
	{ atascii: 0x5a, codepoint: 0x005a, name: "LATIN CAPITAL LETTER Z" }, // Z
	{ atascii: 0x5b, codepoint: 0x005b, name: "LEFT SQUARE BRACKET" }, // [
	{ atascii: 0x5c, codepoint: 0x005c, name: "REVERSE SOLIDUS" }, // \
	{ atascii: 0x5d, codepoint: 0x005d, name: "RIGHT SQUARE BRACKET" }, // ]
	{ atascii: 0x5e, codepoint: 0x005e, name: "CIRCUMFLEX ACCENT" }, // ^
	{ atascii: 0x5f, codepoint: 0x005f, name: "LOW LINE" }, // _
	{ atascii: 0x60, codepoint: 0x2666, name: "BLACK DIAMOND SUIT" }, // ♦
	{ atascii: 0x61, codepoint: 0x0061, name: "LATIN SMALL LETTER A" }, // a
	{ atascii: 0x62, codepoint: 0x0062, name: "LATIN SMALL LETTER B" }, // b
	{ atascii: 0x63, codepoint: 0x0063, name: "LATIN SMALL LETTER C" }, // c
	{ atascii: 0x64, codepoint: 0x0064, name: "LATIN SMALL LETTER D" }, // d
	{ atascii: 0x65, codepoint: 0x0065, name: "LATIN SMALL LETTER E" }, // e
	{ atascii: 0x66, codepoint: 0x0066, name: "LATIN SMALL LETTER F" }, // f
	{ atascii: 0x67, codepoint: 0x0067, name: "LATIN SMALL LETTER G" }, // g
	{ atascii: 0x68, codepoint: 0x0068, name: "LATIN SMALL LETTER H" }, // h
	{ atascii: 0x69, codepoint: 0x0069, name: "LATIN SMALL LETTER I" }, // i
	{ atascii: 0x6a, codepoint: 0x006a, name: "LATIN SMALL LETTER J" }, // j
	{ atascii: 0x6b, codepoint: 0x006b, name: "LATIN SMALL LETTER K" }, // k
	{ atascii: 0x6c, codepoint: 0x006c, name: "LATIN SMALL LETTER L" }, // l
	{ atascii: 0x6d, codepoint: 0x006d, name: "LATIN SMALL LETTER M" }, // m
	{ atascii: 0x6e, codepoint: 0x006e, name: "LATIN SMALL LETTER N" }, // n
	{ atascii: 0x6f, codepoint: 0x006f, name: "LATIN SMALL LETTER O" }, // o
	{ atascii: 0x70, codepoint: 0x0070, name: "LATIN SMALL LETTER P" }, // p
	{ atascii: 0x71, codepoint: 0x0071, name: "LATIN SMALL LETTER Q" }, // q
	{ atascii: 0x72, codepoint: 0x0072, name: "LATIN SMALL LETTER R" }, // r
	{ atascii: 0x73, codepoint: 0x0073, name: "LATIN SMALL LETTER S" }, // s
	{ atascii: 0x74, codepoint: 0x0074, name: "LATIN SMALL LETTER T" }, // t
	{ atascii: 0x75, codepoint: 0x0075, name: "LATIN SMALL LETTER U" }, // u
	{ atascii: 0x76, codepoint: 0x0076, name: "LATIN SMALL LETTER V" }, // v
	{ atascii: 0x77, codepoint: 0x0077, name: "LATIN SMALL LETTER W" }, // w
	{ atascii: 0x78, codepoint: 0x0078, name: "LATIN SMALL LETTER X" }, // x
	{ atascii: 0x79, codepoint: 0x0079, name: "LATIN SMALL LETTER Y" }, // y
	{ atascii: 0x7a, codepoint: 0x007a, name: "LATIN SMALL LETTER Z" }, // z
	{ atascii: 0x7b, codepoint: 0x2660, name: "BLACK SPADE SUIT" }, // ♠
	{ atascii: 0x7c, codepoint: 0x007c, name: "VERTICAL LINE" }, // |
	{ atascii: 0x7d, codepoint: 0x2196, name: "NORTH WEST ARROW" }, // ↖
	{ atascii: 0x7e, codepoint: 0x25c0, name: "BLACK LEFT-POINTING TRIANGLE" }, // ◀
	{ atascii: 0x7f, codepoint: 0x25b6, name: "BLACK RIGHT-POINTING TRIANGLE" }, // ▶
];

export const INTERNATIONAL: readonly MappedChar[] = [
	{ atascii: 0x00, codepoint: 0x00e1, name: "LATIN SMALL LETTER A WITH ACUTE" }, // á
	{ atascii: 0x01, codepoint: 0x00f9, name: "LATIN SMALL LETTER U WITH GRAVE" }, // ù
	{
		atascii: 0x02,
		codepoint: 0x00d1,
		name: "LATIN CAPITAL LETTER N WITH TILDE",
	}, // Ñ
	{
		atascii: 0x03,
		codepoint: 0x00c9,
		name: "LATIN CAPITAL LETTER E WITH ACUTE",
	}, // É
	{
		atascii: 0x04,
		codepoint: 0x00e7,
		name: "LATIN SMALL LETTER C WITH CEDILLA",
	}, // ç
	{
		atascii: 0x05,
		codepoint: 0x00f4,
		name: "LATIN SMALL LETTER O WITH CIRCUMFLEX",
	}, // ô
	{ atascii: 0x06, codepoint: 0x00f2, name: "LATIN SMALL LETTER O WITH GRAVE" }, // ò
	{ atascii: 0x07, codepoint: 0x00ec, name: "LATIN SMALL LETTER I WITH GRAVE" }, // ì
	{ atascii: 0x08, codepoint: 0x00a3, name: "POUND SIGN" }, // £
	{
		atascii: 0x09,
		codepoint: 0x00ef,
		name: "LATIN SMALL LETTER I WITH DIAERESIS",
	}, // ï
	{
		atascii: 0x0a,
		codepoint: 0x00fc,
		name: "LATIN SMALL LETTER U WITH DIAERESIS",
	}, // ü
	{
		atascii: 0x0b,
		codepoint: 0x00e4,
		name: "LATIN SMALL LETTER A WITH DIAERESIS",
	}, // ä
	{
		atascii: 0x0c,
		codepoint: 0x00d6,
		name: "LATIN CAPITAL LETTER O WITH DIAERESIS",
	}, // Ö
	{ atascii: 0x0d, codepoint: 0x00fa, name: "LATIN SMALL LETTER U WITH ACUTE" }, // ú
	{ atascii: 0x0e, codepoint: 0x00f3, name: "LATIN SMALL LETTER O WITH ACUTE" }, // ó
	{
		atascii: 0x0f,
		codepoint: 0x00f6,
		name: "LATIN SMALL LETTER O WITH DIAERESIS",
	}, // ö
	{
		atascii: 0x10,
		codepoint: 0x00dc,
		name: "LATIN CAPITAL LETTER U WITH DIAERESIS",
	}, // Ü
	{
		atascii: 0x11,
		codepoint: 0x00e2,
		name: "LATIN SMALL LETTER A WITH CIRCUMFLEX",
	}, // â
	{
		atascii: 0x12,
		codepoint: 0x00fb,
		name: "LATIN SMALL LETTER U WITH CIRCUMFLEX",
	}, // û
	{
		atascii: 0x13,
		codepoint: 0x00ee,
		name: "LATIN SMALL LETTER I WITH CIRCUMFLEX",
	}, // î
	{ atascii: 0x14, codepoint: 0x00e9, name: "LATIN SMALL LETTER E WITH ACUTE" }, // é
	{ atascii: 0x15, codepoint: 0x00e8, name: "LATIN SMALL LETTER E WITH GRAVE" }, // è
	{ atascii: 0x16, codepoint: 0x00f1, name: "LATIN SMALL LETTER N WITH TILDE" }, // ñ
	{
		atascii: 0x17,
		codepoint: 0x00ea,
		name: "LATIN SMALL LETTER E WITH CIRCUMFLEX",
	}, // ê
	{
		atascii: 0x18,
		codepoint: 0x00e5,
		name: "LATIN SMALL LETTER A WITH RING ABOVE",
	}, // å
	{ atascii: 0x19, codepoint: 0x00e0, name: "LATIN SMALL LETTER A WITH GRAVE" }, // à
	{
		atascii: 0x1a,
		codepoint: 0x00c5,
		name: "LATIN CAPITAL LETTER A WITH RING ABOVE",
	}, // Å
	{ atascii: 0x60, codepoint: 0x00a1, name: "INVERTED EXCLAMATION MARK" }, // ¡
	{
		atascii: 0x7b,
		codepoint: 0x00c4,
		name: "LATIN CAPITAL LETTER A WITH DIAERESIS",
	}, // Ä
];

/**
 * Converts an ATASCII code ($00-$7F) to the character's index in the
 * hardware character set ("internal" screen code order).
 */
export function atasciiToInternal(code: number): number {
	if (code < 0x20) return code + 0x40;
	if (code < 0x60) return code - 0x20;
	return code;
}
