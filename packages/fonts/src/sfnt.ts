// Builds a TrueType (sfnt) font from traced glyph outlines. Purpose-built
// for the 8x8 character-cell fonts in this package rather than general: every
// glyph advances one full cell, there are no composites, no hinting, and all
// outline points are on-curve (pixel squares have no curves).
//
// Metrics: 2048 units per em with one pixel = 256 units, so the 8x8 cell is
// exactly one em and lines tile like the real screen. Capitals sit on the
// baseline at the bottom of pixel row 6; descenders dip into row 7.

export const UPM = 2048;
export const PX = UPM / 8;
export const ASCENT = 7 * PX;
export const DESCENT = -1 * PX;
export const CAP_HEIGHT = 6 * PX; // capitals occupy rows 1-6
export const X_HEIGHT = 5 * PX; // lowercase occupies rows 2-6

export interface OutlinePoint {
	x: number;
	y: number;
}

export interface GlyphOutline {
	/** Closed contours in font units; empty array for blank glyphs. */
	contours: OutlinePoint[][];
}

export interface TtfOptions {
	familyName: string;
	styleName: string;
	/** Package semver, e.g. "0.3.0" */
	version: string;
	psName: string;
	copyright: string;
	license: string;
	vendorId: string; // exactly 4 ASCII chars
}

class ByteWriter {
	private buf = new Uint8Array(4096);
	private len = 0;

	get length(): number {
		return this.len;
	}

	private ensure(n: number) {
		if (this.len + n <= this.buf.length) return;
		let size = this.buf.length * 2;
		while (size < this.len + n) size *= 2;
		const next = new Uint8Array(size);
		next.set(this.buf);
		this.buf = next;
	}

	u8(v: number) {
		this.ensure(1);
		this.buf[this.len++] = v & 0xff;
	}

	u16(v: number) {
		this.ensure(2);
		this.buf[this.len++] = (v >>> 8) & 0xff;
		this.buf[this.len++] = v & 0xff;
	}

	i16(v: number) {
		this.u16(v < 0 ? v + 0x10000 : v);
	}

	u32(v: number) {
		this.ensure(4);
		this.buf[this.len++] = (v >>> 24) & 0xff;
		this.buf[this.len++] = (v >>> 16) & 0xff;
		this.buf[this.len++] = (v >>> 8) & 0xff;
		this.buf[this.len++] = v & 0xff;
	}

	tag(s: string) {
		if (s.length !== 4) throw new Error(`bad tag "${s}"`);
		for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i));
	}

	bytes(data: Uint8Array) {
		this.ensure(data.length);
		this.buf.set(data, this.len);
		this.len += data.length;
	}

	pad4() {
		while (this.len % 4 !== 0) this.u8(0);
	}

	toUint8Array(): Uint8Array {
		return this.buf.slice(0, this.len);
	}
}

function checksum(data: Uint8Array): number {
	let sum = 0;
	for (let i = 0; i < data.length; i += 4) {
		const word =
			((data[i] ?? 0) << 24) |
			((data[i + 1] ?? 0) << 16) |
			((data[i + 2] ?? 0) << 8) |
			(data[i + 3] ?? 0);
		sum = (sum + word) >>> 0;
	}
	return sum;
}

interface GlyphBbox {
	xMin: number;
	yMin: number;
	xMax: number;
	yMax: number;
}

function bboxOf(glyph: GlyphOutline): GlyphBbox | undefined {
	let xMin = Infinity;
	let yMin = Infinity;
	let xMax = -Infinity;
	let yMax = -Infinity;
	for (const contour of glyph.contours) {
		for (const p of contour) {
			if (p.x < xMin) xMin = p.x;
			if (p.y < yMin) yMin = p.y;
			if (p.x > xMax) xMax = p.x;
			if (p.y > yMax) yMax = p.y;
		}
	}
	if (xMin === Infinity) return undefined;
	return { xMin, yMin, xMax, yMax };
}

function buildGlyf(glyphs: GlyphOutline[]): {
	glyf: Uint8Array;
	loca: Uint8Array;
	maxPoints: number;
	maxContours: number;
} {
	const glyf = new ByteWriter();
	const loca = new ByteWriter();
	let maxPoints = 0;
	let maxContours = 0;

	for (const glyph of glyphs) {
		loca.u32(glyf.length);
		const bbox = bboxOf(glyph);
		if (!bbox) continue; // blank glyph: zero-length glyf entry

		const points = glyph.contours.flat();
		maxPoints = Math.max(maxPoints, points.length);
		maxContours = Math.max(maxContours, glyph.contours.length);

		glyf.i16(glyph.contours.length);
		glyf.i16(bbox.xMin);
		glyf.i16(bbox.yMin);
		glyf.i16(bbox.xMax);
		glyf.i16(bbox.yMax);
		let end = -1;
		for (const contour of glyph.contours) {
			end += contour.length;
			glyf.u16(end);
		}
		glyf.u16(0); // no instructions
		// Flags: every point on-curve, full 16-bit deltas.
		for (let i = 0; i < points.length; i++) glyf.u8(0x01);
		let prev = 0;
		for (const p of points) {
			glyf.i16(p.x - prev);
			prev = p.x;
		}
		prev = 0;
		for (const p of points) {
			glyf.i16(p.y - prev);
			prev = p.y;
		}
		glyf.pad4();
	}
	loca.u32(glyf.length);

	return {
		glyf: glyf.toUint8Array(),
		loca: loca.toUint8Array(),
		maxPoints,
		maxContours,
	};
}

function buildCmap(cmap: ReadonlyMap<number, number>): Uint8Array {
	const codes = [...cmap.keys()].sort((a, b) => a - b);
	if (codes.length === 0) throw new Error("empty cmap");
	if (codes[0]! < 0 || codes[codes.length - 1]! > 0xfffd) {
		throw new Error("cmap code point out of format 4 range");
	}

	// Maximal runs where both code points and glyph ids are consecutive.
	interface Segment {
		startCode: number;
		endCode: number;
		startGid: number;
	}
	const segments: Segment[] = [];
	for (const code of codes) {
		const gid = cmap.get(code)!;
		const last = segments[segments.length - 1];
		if (
			last &&
			code === last.endCode + 1 &&
			gid === last.startGid + (code - last.startCode)
		) {
			last.endCode = code;
		} else {
			segments.push({ startCode: code, endCode: code, startGid: gid });
		}
	}
	segments.push({ startCode: 0xffff, endCode: 0xffff, startGid: 0x10000 }); // sentinel; idDelta 1

	const segCount = segments.length;
	const subtable = new ByteWriter();
	subtable.u16(4); // format
	subtable.u16(16 + segCount * 8); // length
	subtable.u16(0); // language
	subtable.u16(segCount * 2);
	const entrySelector = Math.floor(Math.log2(segCount));
	const searchRange = 2 ** entrySelector * 2;
	subtable.u16(searchRange);
	subtable.u16(entrySelector);
	subtable.u16(segCount * 2 - searchRange);
	for (const s of segments) subtable.u16(s.endCode);
	subtable.u16(0); // reservedPad
	for (const s of segments) subtable.u16(s.startCode);
	for (const s of segments) subtable.u16((s.startGid - s.startCode) & 0xffff);
	for (let i = 0; i < segCount; i++) subtable.u16(0); // idRangeOffset

	const table = new ByteWriter();
	table.u16(0); // version
	table.u16(2); // two encoding records, both pointing at the same subtable
	const subtableOffset = 4 + 2 * 8;
	table.u16(0); // platform: Unicode
	table.u16(3); // encoding: BMP
	table.u32(subtableOffset);
	table.u16(3); // platform: Windows
	table.u16(1); // encoding: Unicode BMP
	table.u32(subtableOffset);
	table.bytes(subtable.toUint8Array());
	return table.toUint8Array();
}

function buildName(opts: TtfOptions): Uint8Array {
	const records: [id: number, value: string][] = [
		[0, opts.copyright],
		[1, opts.familyName],
		[2, opts.styleName],
		[3, `${opts.version};${opts.vendorId};${opts.psName}`],
		[4, `${opts.familyName} ${opts.styleName}`],
		[5, `Version ${opts.version}`],
		[6, opts.psName],
		[13, opts.license],
	];

	const storage = new ByteWriter();
	const table = new ByteWriter();
	table.u16(0); // format
	table.u16(records.length);
	table.u16(6 + records.length * 12); // storage offset
	for (const [id, value] of records) {
		table.u16(3); // Windows
		table.u16(1); // Unicode BMP (UTF-16BE)
		table.u16(0x409); // en-US
		table.u16(id);
		table.u16(value.length * 2);
		table.u16(storage.length);
		for (let i = 0; i < value.length; i++) storage.u16(value.charCodeAt(i));
	}
	table.bytes(storage.toUint8Array());
	return table.toUint8Array();
}

const MAC_EPOCH_OFFSET = 2082844800; // seconds from 1904-01-01 to 1970-01-01
const BUILD_DATE = Date.UTC(2026, 0, 1) / 1000 + MAC_EPOCH_OFFSET;

function longDateTime(w: ByteWriter, seconds: number) {
	w.u32(Math.floor(seconds / 2 ** 32));
	w.u32(seconds % 2 ** 32);
}

export function buildTtf(
	glyphs: GlyphOutline[],
	cmap: ReadonlyMap<number, number>,
	opts: TtfOptions,
): Uint8Array {
	if (opts.vendorId.length !== 4) throw new Error("vendorId must be 4 chars");
	for (const gid of cmap.values()) {
		if (gid < 0 || gid >= glyphs.length) throw new Error("cmap gid range");
	}

	const numGlyphs = glyphs.length;
	const bboxes = glyphs.map(bboxOf);
	const { glyf, loca, maxPoints, maxContours } = buildGlyf(glyphs);

	// Global bbox and side bearings.
	let xMin = 0;
	let yMin = 0;
	let xMax = 0;
	let yMax = 0;
	let minLsb = 0;
	let minRsb = UPM;
	let first = true;
	for (const bbox of bboxes) {
		if (!bbox) continue;
		if (first) {
			({ xMin, yMin, xMax, yMax } = bbox);
			minLsb = bbox.xMin;
			minRsb = UPM - bbox.xMax;
			first = false;
			continue;
		}
		xMin = Math.min(xMin, bbox.xMin);
		yMin = Math.min(yMin, bbox.yMin);
		xMax = Math.max(xMax, bbox.xMax);
		yMax = Math.max(yMax, bbox.yMax);
		minLsb = Math.min(minLsb, bbox.xMin);
		minRsb = Math.min(minRsb, UPM - bbox.xMax);
	}

	const [major = 0, minor = 0] = opts.version.split(".").map(Number);
	const fontRevision = Math.round((major + minor / 100) * 65536);

	const head = new ByteWriter();
	head.u32(0x00010000); // version
	head.u32(fontRevision);
	head.u32(0); // checkSumAdjustment, patched at the end
	head.u32(0x5f0f3cf5); // magic
	head.u16(0x000b); // baseline at y=0, lsb at x=0, integer ppem
	head.u16(UPM);
	longDateTime(head, BUILD_DATE);
	longDateTime(head, BUILD_DATE);
	head.i16(xMin);
	head.i16(yMin);
	head.i16(xMax);
	head.i16(yMax);
	head.u16(0); // macStyle
	head.u16(8); // lowestRecPPEM: one pixel per pixel
	head.i16(2); // fontDirectionHint
	head.i16(1); // indexToLocFormat: long
	head.i16(0); // glyphDataFormat

	const hhea = new ByteWriter();
	hhea.u32(0x00010000);
	hhea.i16(ASCENT);
	hhea.i16(DESCENT);
	hhea.i16(0); // lineGap
	hhea.u16(UPM); // advanceWidthMax
	hhea.i16(minLsb);
	hhea.i16(minRsb);
	hhea.i16(xMax); // xMaxExtent
	hhea.i16(1); // caretSlopeRise
	hhea.i16(0); // caretSlopeRun
	hhea.i16(0); // caretOffset
	for (let i = 0; i < 4; i++) hhea.i16(0); // reserved
	hhea.i16(0); // metricDataFormat
	hhea.u16(numGlyphs); // numberOfHMetrics

	const hmtx = new ByteWriter();
	for (const bbox of bboxes) {
		hmtx.u16(UPM);
		hmtx.i16(bbox ? bbox.xMin : 0);
	}

	const maxp = new ByteWriter();
	maxp.u32(0x00010000);
	maxp.u16(numGlyphs);
	maxp.u16(maxPoints);
	maxp.u16(maxContours);
	maxp.u16(0); // maxCompositePoints
	maxp.u16(0); // maxCompositeContours
	maxp.u16(1); // maxZones
	maxp.u16(0); // maxTwilightPoints
	maxp.u16(0); // maxStorage
	maxp.u16(0); // maxFunctionDefs
	maxp.u16(0); // maxInstructionDefs
	maxp.u16(0); // maxStackElements
	maxp.u16(0); // maxSizeOfInstructions
	maxp.u16(0); // maxComponentElements
	maxp.u16(0); // maxComponentDepth

	const codes = [...cmap.keys()];
	const os2 = new ByteWriter();
	os2.u16(4); // version
	os2.i16(UPM); // xAvgCharWidth: monospaced
	os2.u16(400); // usWeightClass
	os2.u16(5); // usWidthClass
	os2.u16(0); // fsType: installable embedding
	os2.i16(1331); // ySubscriptXSize
	os2.i16(1331); // ySubscriptYSize
	os2.i16(0); // ySubscriptXOffset
	os2.i16(287); // ySubscriptYOffset
	os2.i16(1331); // ySuperscriptXSize
	os2.i16(1331); // ySuperscriptYSize
	os2.i16(0); // ySuperscriptXOffset
	os2.i16(977); // ySuperscriptYOffset
	os2.i16(PX); // yStrikeoutSize
	os2.i16(X_HEIGHT / 2); // yStrikeoutPosition
	os2.i16(0); // sFamilyClass
	// PANOSE: Latin text, monospaced.
	for (const b of [2, 0, 5, 9, 0, 0, 0, 0, 0, 0]) os2.u8(b);
	// Unicode ranges: Basic Latin, Latin-1 Supplement, General Punctuation,
	// Arrows, Control Pictures, Box Drawing, Block Elements, Geometric
	// Shapes, Miscellaneous Symbols.
	os2.u32(0x80000003);
	os2.u32(0x00007920);
	os2.u32(0);
	os2.u32(0);
	os2.tag(opts.vendorId);
	os2.u16(0x00c0); // fsSelection: REGULAR | USE_TYPO_METRICS
	os2.u16(Math.min(...codes));
	os2.u16(Math.max(...codes));
	os2.i16(ASCENT); // sTypoAscender
	os2.i16(DESCENT); // sTypoDescender
	os2.i16(0); // sTypoLineGap
	os2.u16(ASCENT); // usWinAscent
	os2.u16(-DESCENT); // usWinDescent
	os2.u32(0x00000001); // ulCodePageRange1: Latin 1 (cp1252)
	os2.u32(0);
	os2.i16(X_HEIGHT);
	os2.i16(CAP_HEIGHT);
	os2.u16(0); // usDefaultChar
	os2.u16(0x20); // usBreakChar
	os2.u16(1); // usMaxContext

	const post = new ByteWriter();
	post.u32(0x00030000); // no glyph names
	post.u32(0); // italicAngle
	post.i16(-PX); // underlinePosition
	post.i16(PX); // underlineThickness
	post.u32(1); // isFixedPitch
	for (let i = 0; i < 4; i++) post.u32(0); // memory hints

	const gasp = new ByteWriter();
	gasp.u16(1); // version
	gasp.u16(1); // one range
	gasp.u16(0xffff);
	gasp.u16(0x000f); // grid-fit + antialias + ClearType variants

	const tables: [tag: string, data: Uint8Array][] = [
		["OS/2", os2.toUint8Array()],
		["cmap", buildCmap(cmap)],
		["gasp", gasp.toUint8Array()],
		["glyf", glyf],
		["head", head.toUint8Array()],
		["hhea", hhea.toUint8Array()],
		["hmtx", hmtx.toUint8Array()],
		["loca", loca],
		["maxp", maxp.toUint8Array()],
		["name", buildName(opts)],
		["post", post.toUint8Array()],
	];
	tables.sort(([a], [b]) => (a < b ? -1 : 1));

	const numTables = tables.length;
	const entrySelector = Math.floor(Math.log2(numTables));
	const searchRange = 2 ** entrySelector * 16;

	const font = new ByteWriter();
	font.u32(0x00010000); // sfntVersion: TrueType outlines
	font.u16(numTables);
	font.u16(searchRange);
	font.u16(entrySelector);
	font.u16(numTables * 16 - searchRange);

	let offset = 12 + numTables * 16;
	let headOffset = -1;
	for (const [tag, data] of tables) {
		if (tag === "head") headOffset = offset;
		font.tag(tag);
		font.u32(checksum(data));
		font.u32(offset);
		font.u32(data.length);
		offset += data.length + ((4 - (data.length % 4)) % 4);
	}
	for (const [, data] of tables) {
		font.bytes(data);
		font.pad4();
	}

	// Whole-font checksum adjustment, poked into head.
	const bytes = font.toUint8Array();
	const adjustment = (0xb1b0afba - checksum(bytes)) >>> 0;
	const view = new DataView(bytes.buffer);
	view.setUint32(headOffset + 8, adjustment);
	return bytes;
}
