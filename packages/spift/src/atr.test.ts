import { expect, test } from "vitest";
import {
	ATR_HEADER_SIZE,
	ATR_MAGIC,
	atrDataSize,
	createBlankAtr,
} from "./atr.ts";

function readHeader(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer);
	return {
		magic: view.getUint16(0, true),
		parsLo: view.getUint16(2, true),
		sectorSize: view.getUint16(4, true),
		parsHi: view.getUint16(6, true),
		tail: [...bytes.subarray(8, ATR_HEADER_SIZE)],
	};
}

const ZERO_TAIL = [0, 0, 0, 0, 0, 0, 0, 0];

test("defaults to a 720 x 128 single-density image", () => {
	const bytes = createBlankAtr();
	expect(bytes.length).toBe(ATR_HEADER_SIZE + 720 * 128);
	expect(readHeader(bytes)).toEqual({
		magic: ATR_MAGIC,
		parsLo: (720 * 128) / 16,
		sectorSize: 128,
		parsHi: 0,
		tail: ZERO_TAIL,
	});
});

test("data area is all zeroes", () => {
	const bytes = createBlankAtr({ sectorCount: 4 });
	expect(bytes.subarray(ATR_HEADER_SIZE).every((b) => b === 0)).toBe(true);
});

test("enhanced density geometry", () => {
	const bytes = createBlankAtr({ sectorCount: 1040 });
	expect(bytes.length).toBe(ATR_HEADER_SIZE + 1040 * 128);
	expect(readHeader(bytes).parsLo).toBe((1040 * 128) / 16);
});

test("256-byte sectors store the three boot sectors as 128 bytes", () => {
	expect(atrDataSize(256, 1)).toBe(128);
	expect(atrDataSize(256, 3)).toBe(384);
	expect(atrDataSize(256, 4)).toBe(640);
	const bytes = createBlankAtr({ sectorSize: 256, sectorCount: 720 });
	expect(bytes.length).toBe(ATR_HEADER_SIZE + 3 * 128 + 717 * 256);
	expect(readHeader(bytes).sectorSize).toBe(256);
});

test("512-byte sectors are stored full-size from sector 1", () => {
	expect(atrDataSize(512, 3)).toBe(1536);
});

test("maximal 512-byte-sector image splits the paragraph count", () => {
	// The corpus's maximal SpartaDOS X-style hard disk image: 65,535 x 512
	// bytes = $1FFFE0 paragraphs.
	const bytes = createBlankAtr({ sectorSize: 512, sectorCount: 65535 });
	expect(bytes.length).toBe(ATR_HEADER_SIZE + 65535 * 512);
	const header = readHeader(bytes);
	expect(header.parsLo).toBe(0xffe0);
	expect(header.parsHi).toBe(0x1f);
});

test("8192-byte sectors", () => {
	const bytes = createBlankAtr({ sectorSize: 8192, sectorCount: 2 });
	expect(bytes.length).toBe(ATR_HEADER_SIZE + 2 * 8192);
	expect(readHeader(bytes).sectorSize).toBe(8192);
});

test("rejects invalid geometry", () => {
	expect(() => createBlankAtr({ sectorCount: 0 })).toThrow(RangeError);
	expect(() => createBlankAtr({ sectorCount: 1.5 })).toThrow(RangeError);
	expect(() => createBlankAtr({ sectorCount: 65536 })).toThrow(RangeError);
	expect(() => createBlankAtr({ sectorSize: 100 as never })).toThrow(
		RangeError,
	);
});
