import { expect, test } from "vitest";
import { GLYPH_TO_ATASCII } from "./keyboard-docs.ts";

test("GLYPH_TO_ATASCII covers graphics, international, and ASCII glyphs", () => {
	expect(GLYPH_TO_ATASCII.get("♥")).toBe(0x00);
	expect(GLYPH_TO_ATASCII.get("♦")).toBe(0x60);
	expect(GLYPH_TO_ATASCII.get("♠")).toBe(0x7b);
	// International-set glyphs map to the same codes as their graphics.
	expect(GLYPH_TO_ATASCII.get("á")).toBe(0x00);
	expect(GLYPH_TO_ATASCII.get("Ñ")).toBe(0x02);
	expect(GLYPH_TO_ATASCII.get("¡")).toBe(0x60);
	expect(GLYPH_TO_ATASCII.get("Ä")).toBe(0x7b);
	// Plain ASCII maps to itself.
	expect(GLYPH_TO_ATASCII.get("A")).toBe(0x41);
	expect(GLYPH_TO_ATASCII.get("|")).toBe(0x7c);
});

test("GLYPH_TO_ATASCII prefers the lower code where glyphs collide", () => {
	// The cursor controls share glyphs with the $9C-$9F editing functions,
	// clear/backspace/tab with $FD-$FF, and ESC with EOL.
	expect(GLYPH_TO_ATASCII.get("↑")).toBe(0x1c);
	expect(GLYPH_TO_ATASCII.get("↓")).toBe(0x1d);
	expect(GLYPH_TO_ATASCII.get("←")).toBe(0x1e);
	expect(GLYPH_TO_ATASCII.get("→")).toBe(0x1f);
	expect(GLYPH_TO_ATASCII.get("↖")).toBe(0x7d);
	expect(GLYPH_TO_ATASCII.get("◀")).toBe(0x7e);
	expect(GLYPH_TO_ATASCII.get("▶")).toBe(0x7f);
	expect(GLYPH_TO_ATASCII.get("␛")).toBe(0x1b);
});
