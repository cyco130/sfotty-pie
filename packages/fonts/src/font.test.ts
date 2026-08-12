// Round-trip validation of the generated fonts. The TTF is re-parsed with
// the independent minimal parser below (written against the OpenType spec,
// not sharing code with the builder), each glyph is rasterized back onto the
// 8x8 grid with the non-zero winding rule, and the result must match the
// source bitmap from the OS ROM exactly.

import { brotliDecompressSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { loadGlyphs } from "./charset.ts";
import { buildFonts } from "./font.ts";
import { INTERNATIONAL, STANDARD } from "./mapping.ts";
import { KNOWN_TAGS } from "./woff2.ts";

const { ttf, woff2 } = buildFonts("1.2.0");
const glyphs = loadGlyphs();

// --- Minimal independent sfnt parser ---------------------------------------

function view(data: Uint8Array): DataView {
	return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function parseTables(font: Uint8Array): Map<string, Uint8Array> {
	const v = view(font);
	const numTables = v.getUint16(4);
	const tables = new Map<string, Uint8Array>();
	for (let i = 0; i < numTables; i++) {
		const entry = 12 + i * 16;
		const tag = String.fromCharCode(
			font[entry]!,
			font[entry + 1]!,
			font[entry + 2]!,
			font[entry + 3]!,
		);
		const offset = v.getUint32(entry + 8);
		const length = v.getUint32(entry + 12);
		tables.set(tag, font.subarray(offset, offset + length));
	}
	return tables;
}

function parseCmap(cmap: Uint8Array): Map<number, number> {
	const v = view(cmap);
	const numRecords = v.getUint16(2);
	let subtableOffset = -1;
	for (let i = 0; i < numRecords; i++) {
		const platform = v.getUint16(4 + i * 8);
		const encoding = v.getUint16(4 + i * 8 + 2);
		if (platform === 3 && encoding === 1) {
			subtableOffset = v.getUint32(4 + i * 8 + 4);
		}
	}
	expect(subtableOffset).toBeGreaterThanOrEqual(0);
	expect(v.getUint16(subtableOffset)).toBe(4); // format

	const segCount = v.getUint16(subtableOffset + 6) / 2;
	const endCodes = subtableOffset + 14;
	const startCodes = endCodes + segCount * 2 + 2;
	const idDeltas = startCodes + segCount * 2;
	const idRangeOffsets = idDeltas + segCount * 2;

	const map = new Map<number, number>();
	for (let seg = 0; seg < segCount; seg++) {
		const start = v.getUint16(startCodes + seg * 2);
		const end = v.getUint16(endCodes + seg * 2);
		const delta = v.getUint16(idDeltas + seg * 2);
		const rangeOffset = v.getUint16(idRangeOffsets + seg * 2);
		for (let code = start; code <= end && code !== 0xffff; code++) {
			let gid: number;
			if (rangeOffset === 0) {
				gid = (code + delta) & 0xffff;
			} else {
				const addr =
					idRangeOffsets + seg * 2 + rangeOffset + (code - start) * 2;
				gid = v.getUint16(addr);
				if (gid !== 0) gid = (gid + delta) & 0xffff;
			}
			if (gid !== 0) map.set(code, gid);
		}
	}
	return map;
}

interface ParsedPoint {
	x: number;
	y: number;
}

function parseGlyph(
	glyf: Uint8Array,
	loca: Uint8Array,
	gid: number,
): ParsedPoint[][] {
	const lv = view(loca);
	const start = lv.getUint32(gid * 4);
	const end = lv.getUint32(gid * 4 + 4);
	if (start === end) return [];

	const v = view(glyf);
	let pos = start;
	const numContours = v.getInt16(pos);
	expect(numContours).toBeGreaterThan(0); // no composites in this font
	pos += 10; // skip bbox

	const endPts: number[] = [];
	for (let i = 0; i < numContours; i++) {
		endPts.push(v.getUint16(pos));
		pos += 2;
	}
	const numPoints = endPts[endPts.length - 1]! + 1;
	pos += 2 + v.getUint16(pos); // instructions

	// Flags, with repeat support (the builder doesn't emit repeats, but the
	// parser follows the spec rather than the builder).
	const flags: number[] = [];
	while (flags.length < numPoints) {
		const flag = glyf[pos++]!;
		flags.push(flag);
		if (flag & 0x08) {
			let repeat = glyf[pos++]!;
			while (repeat-- > 0) flags.push(flag);
		}
	}

	const xs: number[] = [];
	let x = 0;
	for (const flag of flags) {
		if (flag & 0x02) {
			const dx = glyf[pos++]!;
			x += flag & 0x10 ? dx : -dx;
		} else if (!(flag & 0x10)) {
			x += v.getInt16(pos);
			pos += 2;
		}
		xs.push(x);
	}
	const ys: number[] = [];
	let y = 0;
	for (const flag of flags) {
		if (flag & 0x04) {
			const dy = glyf[pos++]!;
			y += flag & 0x20 ? dy : -dy;
		} else if (!(flag & 0x20)) {
			y += v.getInt16(pos);
			pos += 2;
		}
		ys.push(y);
	}

	const contours: ParsedPoint[][] = [];
	let first = 0;
	for (const last of endPts) {
		const contour: ParsedPoint[] = [];
		for (let i = first; i <= last; i++) {
			expect(flags[i]! & 0x01).toBe(1); // all points on-curve
			contour.push({ x: xs[i]!, y: ys[i]! });
		}
		contours.push(contour);
		first = last + 1;
	}
	return contours;
}

// Non-zero winding test, exact for our axis-aligned edges since pixel
// centers never lie on an edge.
function isInside(contours: ParsedPoint[][], px: number, py: number): boolean {
	let winding = 0;
	for (const contour of contours) {
		for (let i = 0; i < contour.length; i++) {
			const a = contour[i]!;
			const b = contour[(i + 1) % contour.length]!;
			if (a.y <= py && b.y > py) {
				const t = (py - a.y) / (b.y - a.y);
				if (a.x + t * (b.x - a.x) > px) winding++;
			} else if (b.y <= py && a.y > py) {
				const t = (py - a.y) / (b.y - a.y);
				if (a.x + t * (b.x - a.x) > px) winding--;
			}
		}
	}
	return winding !== 0;
}

function rasterize(contours: ParsedPoint[][]): Uint8Array {
	const bitmap = new Uint8Array(8);
	for (let r = 0; r < 8; r++) {
		for (let c = 0; c < 8; c++) {
			// Pixel row r spans y (6-r)*256 to (7-r)*256 (row 7 descends
			// below the baseline); centers land between edge coordinates.
			if (isInside(contours, c * 256 + 128, (6 - r) * 256 + 128)) {
				bitmap[r] = bitmap[r]! | (0x80 >> c);
			}
		}
	}
	return bitmap;
}

const tables = parseTables(ttf);

// --- Tests ------------------------------------------------------------------

describe("mapping", () => {
	test("standard set covers every ATASCII code once", () => {
		expect(STANDARD).toHaveLength(128);
		expect(new Set(STANDARD.map((c) => c.atascii)).size).toBe(128);
	});

	test("international set replaces the 29 control graphics", () => {
		expect(INTERNATIONAL).toHaveLength(29);
		const codes = INTERNATIONAL.map((c) => c.atascii);
		for (let i = 0; i <= 0x1a; i++) expect(codes).toContain(i);
		expect(codes).toContain(0x60);
		expect(codes).toContain(0x7b);
	});

	test("code points are unique and stay in the BMP", () => {
		const all = [...STANDARD, ...INTERNATIONAL].map((c) => c.codepoint);
		expect(new Set(all).size).toBe(all.length);
		for (const cp of all) {
			expect(cp).toBeGreaterThanOrEqual(0x20);
			expect(cp).toBeLessThanOrEqual(0xffff);
		}
	});
});

describe("ttf", () => {
	test("whole-font checksum validates", () => {
		let sum = 0;
		const v = view(ttf);
		for (let i = 0; i < ttf.length; i += 4) sum = (sum + v.getUint32(i)) >>> 0;
		expect(ttf.length % 4).toBe(0);
		expect(sum).toBe(0xb1b0afba);
	});

	test("head declares the 2048/8 pixel grid", () => {
		const head = tables.get("head")!;
		expect(view(head).getUint16(18)).toBe(2048); // unitsPerEm
		expect(view(head).getInt16(50)).toBe(1); // long loca format
	});

	test("every glyph advances exactly one cell", () => {
		const hmtx = tables.get("hmtx")!;
		const maxp = tables.get("maxp")!;
		const numGlyphs = view(maxp).getUint16(4);
		expect(numGlyphs).toBe(1 + glyphs.length);
		for (let gid = 0; gid < numGlyphs; gid++) {
			expect(view(hmtx).getUint16(gid * 4)).toBe(2048);
		}
	});

	test("cmap maps exactly the 157 mapped code points", () => {
		const cmap = parseCmap(tables.get("cmap")!);
		expect(cmap.size).toBe(157);
		for (const glyph of glyphs) {
			expect(cmap.has(glyph.codepoint)).toBe(true);
		}
	});

	test(".notdef has an outline, space does not", () => {
		const glyf = tables.get("glyf")!;
		const loca = tables.get("loca")!;
		const cmap = parseCmap(tables.get("cmap")!);
		expect(parseGlyph(glyf, loca, 0).length).toBeGreaterThan(0);
		expect(parseGlyph(glyf, loca, cmap.get(0x20)!)).toHaveLength(0);
	});

	test("every glyph rasterizes back to its ROM bitmap", () => {
		const glyf = tables.get("glyf")!;
		const loca = tables.get("loca")!;
		const cmap = parseCmap(tables.get("cmap")!);
		for (const glyph of glyphs) {
			const contours = parseGlyph(glyf, loca, cmap.get(glyph.codepoint)!);
			expect(
				rasterize(contours),
				`U+${glyph.codepoint.toString(16)} ${glyph.name}`,
			).toEqual(glyph.bitmap);
		}
	});
});

describe("woff2", () => {
	test("header, directory, and payload reconstruct the TTF", () => {
		const v = view(woff2);
		expect(v.getUint32(0)).toBe(0x774f4632); // 'wOF2'
		expect(v.getUint32(4)).toBe(0x00010000); // TrueType flavor
		expect(v.getUint32(8)).toBe(woff2.length);
		const numTables = v.getUint16(12);
		expect(numTables).toBe(parseTables(ttf).size);
		expect(v.getUint32(16)).toBe(ttf.length); // totalSfntSize
		expect(v.getUint16(24)).toBe(1); // majorVersion
		expect(v.getUint16(26)).toBe(2); // minorVersion

		// Walk the table directory.
		let pos = 48;
		const entries: { tag: string; length: number }[] = [];
		for (let i = 0; i < numTables; i++) {
			const flags = woff2[pos++]!;
			let tag: string;
			if ((flags & 0x3f) === 0x3f) {
				tag = String.fromCharCode(
					woff2[pos]!,
					woff2[pos + 1]!,
					woff2[pos + 2]!,
					woff2[pos + 3]!,
				);
				pos += 4;
			} else {
				tag = KNOWN_TAGS[flags & 0x3f]!;
			}
			// glyf and loca must use transformation version 3 (null
			// transform); everything else version 0.
			const transform = flags >>> 6;
			expect(transform).toBe(tag === "glyf" || tag === "loca" ? 3 : 0);
			let length = 0;
			for (;;) {
				const byte = woff2[pos++]!;
				length = length * 128 + (byte & 0x7f);
				if ((byte & 0x80) === 0) break;
			}
			entries.push({ tag, length });
		}

		expect(v.getUint32(20)).toBe(woff2.length - pos); // totalCompressedSize
		const stream = new Uint8Array(brotliDecompressSync(woff2.subarray(pos)));
		expect(stream.length).toBe(entries.reduce((sum, e) => sum + e.length, 0));

		// Each table's bytes must match the TTF's.
		const ttfTables = parseTables(ttf);
		let offset = 0;
		for (const { tag, length } of entries) {
			const expected = ttfTables.get(tag)!;
			expect(expected.length).toBe(length);
			expect(stream.subarray(offset, offset + length)).toEqual(expected);
			offset += length;
		}
	});
});
