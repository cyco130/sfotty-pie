// PNG screenshots of the machine framebuffer, for headless debugging. Hand-rolled
// (no deps) with node:zlib. Node-only and intentionally NOT exported from the
// package index, so it never reaches a browser bundle; import it directly (the
// boot CLI / a local debug harness / a future a8-cli). Takes the framebuffer (one
// Atari colour byte per pixel) plus a GTIA palette (0xAABBGGRR words from
// paletteFor) → a 24-bit RGB PNG.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { FRAME_BUFFER_HEIGHT, FRAME_BUFFER_WIDTH } from "./timing-constants.ts";

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) {
		c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

/** Encode a framebuffer as a PNG (24-bit RGB). */
export function frameToPng(
	frame: Uint8Array,
	palette: Uint32Array,
	width = FRAME_BUFFER_WIDTH,
	height = FRAME_BUFFER_HEIGHT,
): Uint8Array {
	// Raw image: each row is a filter byte (0 = none) then RGB triplets.
	const stride = 1 + width * 3;
	const raw = new Uint8Array(height * stride);
	for (let y = 0; y < height; y++) {
		let p = y * stride + 1; // skip the filter byte (already 0)
		for (let x = 0; x < width; x++) {
			const w = palette[frame[y * width + x]!]!;
			raw[p++] = w & 0xff; // r
			raw[p++] = (w >>> 8) & 0xff; // g
			raw[p++] = (w >>> 16) & 0xff; // b
		}
	}

	const ihdr = new Uint8Array(13);
	const view = new DataView(ihdr.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // colour type: truecolour RGB

	const signature = Uint8Array.from([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	]);
	const parts = [
		signature,
		chunk("IHDR", ihdr),
		chunk("IDAT", new Uint8Array(deflateSync(raw))),
		chunk("IEND", new Uint8Array(0)),
	];
	const total = parts.reduce((n, part) => n + part.length, 0);
	const png = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		png.set(part, offset);
		offset += part.length;
	}
	return png;
}

/** Encode and write a framebuffer screenshot to `path`. */
export function savePng(
	path: string,
	frame: Uint8Array,
	palette: Uint32Array,
): void {
	writeFileSync(path, frameToPng(frame, palette));
}
