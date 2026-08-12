// Assembles the font: charset bitmaps -> traced outlines -> TTF -> WOFF2.

import { loadGlyphs } from "./charset.ts";
import { PX, buildTtf, type GlyphOutline, type TtfOptions } from "./sfnt.ts";
import { traceBitmap } from "./trace.ts";
import { buildWoff2 } from "./woff2.ts";

export const FAMILY_NAME = "A8 Screen";
export const PS_NAME = "A8Screen-Regular";

// Hollow box, drawn in the same 8x8 grid as the real glyphs.
const NOTDEF_BITMAP = Uint8Array.of(
	0x00,
	0x7e,
	0x42,
	0x42,
	0x42,
	0x42,
	0x7e,
	0x00,
);

/**
 * Traces a character bitmap into font-unit contours. The grid's y axis
 * points down while the font's points up; the baseline sits at the bottom of
 * pixel row 6, so grid row 7 (descenders) lands below y=0. The y flip
 * mirrors contour orientation, so each contour is reversed to keep outer
 * contours clockwise in font coordinates, as TrueType convention wants.
 */
export function bitmapToOutline(bitmap: Uint8Array): GlyphOutline {
	return {
		contours: traceBitmap(bitmap).map((contour) =>
			contour
				.map((point) => ({ x: point.x * PX, y: (7 - point.y) * PX }))
				.reverse(),
		),
	};
}

export function buildFonts(version: string): {
	ttf: Uint8Array;
	woff2: Uint8Array;
} {
	const glyphs = loadGlyphs();

	const outlines: GlyphOutline[] = [
		bitmapToOutline(NOTDEF_BITMAP), // glyph 0: .notdef
		...glyphs.map((glyph) => bitmapToOutline(glyph.bitmap)),
	];
	const cmap = new Map<number, number>();
	glyphs.forEach((glyph, i) => {
		if (cmap.has(glyph.codepoint)) {
			throw new Error(`duplicate code point U+${glyph.codepoint.toString(16)}`);
		}
		cmap.set(glyph.codepoint, i + 1);
	});

	const options: TtfOptions = {
		familyName: FAMILY_NAME,
		styleName: "Regular",
		version,
		psName: PS_NAME,
		copyright:
			"Glyph bitmaps from the Atari 8-bit OS character sets. Font software (c) Fatih Aygun and contributors.",
		license: "MIT license",
		vendorId: "SFPI",
	};

	const ttf = buildTtf(outlines, cmap, options);
	const [major = 0, minor = 0] = version.split(".").map(Number);
	const woff2 = buildWoff2(ttf, { major, minor });
	return { ttf, woff2 };
}
