// Loads the character set bitmaps extracted from the OS ROM (see
// extract-charsets.ts) and pairs them with their Unicode code points.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	INTERNATIONAL,
	STANDARD,
	atasciiToInternal,
	type MappedChar,
} from "./mapping.ts";

export interface CharsetGlyph {
	codepoint: number;
	name: string;
	atascii: number;
	set: "standard" | "international";
	/** 8 bytes, one per row top to bottom; bit 7 = leftmost pixel */
	bitmap: Uint8Array;
}

function readCharset(name: string): Uint8Array {
	const data = readFileSync(join(import.meta.dirname, "data", name));
	if (data.length !== 1024) {
		throw new Error(`${name}: expected 1024 bytes, got ${data.length}`);
	}
	return new Uint8Array(data);
}

function pick(
	charset: Uint8Array,
	chars: readonly MappedChar[],
	set: CharsetGlyph["set"],
): CharsetGlyph[] {
	return chars.map((char) => {
		const internal = atasciiToInternal(char.atascii);
		return {
			codepoint: char.codepoint,
			name: char.name,
			atascii: char.atascii,
			set,
			bitmap: charset.slice(internal * 8, internal * 8 + 8),
		};
	});
}

/**
 * Returns all font glyphs (standard set + international replacements),
 * sorted by code point.
 */
export function loadGlyphs(): CharsetGlyph[] {
	const standard = readCharset("charset-standard.bin");
	const international = readCharset("charset-international.bin");
	const glyphs = [
		...pick(standard, STANDARD, "standard"),
		...pick(international, INTERNATIONAL, "international"),
	];
	glyphs.sort((a, b) => a.codepoint - b.codepoint);
	return glyphs;
}
