// Repackages an sfnt (TTF) font as WOFF2. Every table is stored with the
// null transform - glyf/loca signal it with transformation version 3, all
// other tables with version 0 - so the payload is just the Brotli-compressed
// concatenation of the raw tables. Decoders are required to support the null
// transform (W3C WOFF2 section 5.3), and Node's zlib has Brotli built in, so
// no dependencies are needed.

import { brotliCompressSync, constants } from "node:zlib";

// WOFF2 known table tags in spec order; the index is what goes into the
// table directory flags byte. 0x3f means an explicit tag follows. An
// underscore stands for the trailing space in short tags ("cvt " etc).
export const KNOWN_TAGS = `
	cmap head hhea hmtx maxp name OS/2 post cvt_ fpgm glyf loca prep CFF_
	VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS
	GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG_ sbix acnt avar bdat bloc
	bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop
	trak Zapf Silf Glat Gloc Feat Sill
`
	.trim()
	.split(/\s+/)
	.map((tag) => tag.replace("_", " "));

interface SfntTable {
	tag: string;
	data: Uint8Array;
}

function parseSfnt(sfnt: Uint8Array): SfntTable[] {
	const view = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
	const numTables = view.getUint16(4);
	const tables: SfntTable[] = [];
	for (let i = 0; i < numTables; i++) {
		const entry = 12 + i * 16;
		const tag = String.fromCharCode(
			sfnt[entry]!,
			sfnt[entry + 1]!,
			sfnt[entry + 2]!,
			sfnt[entry + 3]!,
		);
		const offset = view.getUint32(entry + 8);
		const length = view.getUint32(entry + 12);
		tables.push({ tag, data: sfnt.subarray(offset, offset + length) });
	}
	return tables;
}

function uintBase128(value: number): number[] {
	const bytes = [value & 0x7f];
	value = Math.floor(value / 128);
	while (value > 0) {
		bytes.unshift((value & 0x7f) | 0x80);
		value = Math.floor(value / 128);
	}
	return bytes;
}

export function buildWoff2(
	sfnt: Uint8Array,
	version: { major: number; minor: number },
): Uint8Array {
	const tables = parseSfnt(sfnt);

	const directory: number[] = [];
	let totalSfntSize = 12 + tables.length * 16;
	let uncompressedLength = 0;
	for (const { tag, data } of tables) {
		const known = KNOWN_TAGS.indexOf(tag);
		// glyf and loca use transformation version 3 for "untransformed";
		// for every other table version 0 means that.
		const transform = tag === "glyf" || tag === "loca" ? 3 : 0;
		directory.push((transform << 6) | (known >= 0 ? known : 0x3f));
		if (known < 0) {
			for (let i = 0; i < 4; i++) directory.push(tag.charCodeAt(i));
		}
		directory.push(...uintBase128(data.length));
		totalSfntSize += data.length + ((4 - (data.length % 4)) % 4);
		uncompressedLength += data.length;
	}

	const stream = new Uint8Array(uncompressedLength);
	let pos = 0;
	for (const { data } of tables) {
		stream.set(data, pos);
		pos += data.length;
	}
	const compressed = brotliCompressSync(stream, {
		params: {
			[constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
			[constants.BROTLI_PARAM_SIZE_HINT]: stream.length,
		},
	});

	const headerSize = 48;
	const length = headerSize + directory.length + compressed.length;
	const out = new Uint8Array(length);
	const view = new DataView(out.buffer);
	view.setUint32(0, 0x774f4632); // 'wOF2'
	view.setUint32(4, 0x00010000); // flavor: TrueType
	view.setUint32(8, length);
	view.setUint16(12, tables.length);
	view.setUint16(14, 0); // reserved
	view.setUint32(16, totalSfntSize);
	view.setUint32(20, compressed.length);
	view.setUint16(24, version.major);
	view.setUint16(26, version.minor);
	// metaOffset/metaLength/metaOrigLength/privOffset/privLength stay 0.
	out.set(directory, headerSize);
	out.set(compressed, headerSize + directory.length);
	return out;
}
