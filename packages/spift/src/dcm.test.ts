import { expect, test } from "vitest";
import { decodeDcm, isDcm } from "./dcm.ts";
import { openAtr } from "./atr.ts";

/** Density codes as the pass header flags carry them, in bits 5-6. */
const SD = 0 << 5;
const DD = 1 << 5;
const ED = 2 << 5;
const LAST = 0x80;
const SEQUENTIAL = 0x80;

function pass(flags: number, startSector: number, ...blocks: number[]) {
	return Uint8Array.from([
		0xfa,
		flags | 1,
		startSector & 0xff,
		startSector >> 8,
		...blocks,
	]);
}

function sectorOf(bytes: Uint8Array, sector: number, size = 128) {
	const image = openAtr(bytes);
	return image.readSector(sector) ?? new Uint8Array(size);
}

test("recognizes a pass header", () => {
	expect(isDcm(pass(SD | LAST, 1, 0x45))).toBe(true);
	// $f9 marks a pass too, though nothing in the wild seems to write it.
	expect(isDcm(Uint8Array.from([0xf9, SD | 1, 1, 0]))).toBe(true);
	expect(isDcm(Uint8Array.from([0x96, 0x02, 0, 0]))).toBe(false); // an ATR
	expect(isDcm(Uint8Array.from([0xfa, 3 << 5, 1, 0]))).toBe(false); // no such density
});

test("uncompressed and same-as-before blocks", () => {
	const data = Array.from({ length: 128 }, (_, i) => i & 0xff);
	const result = decodeDcm(
		pass(
			SD | LAST,
			1,
			0x47 | SEQUENTIAL, // sector 1, uncompressed
			...data,
			0x46 | SEQUENTIAL, // sector 2, same as the one before
			0x45, // end of pass
		),
	);
	expect(result.sectorCount).toBe(720);
	expect([...sectorOf(result.bytes, 1)]).toEqual(data);
	expect([...sectorOf(result.bytes, 2)]).toEqual(data);
	// Never mentioned, so it stays zero - that is how empty space compresses.
	expect([...sectorOf(result.bytes, 3)]).toEqual(new Array(128).fill(0));
});

test("a compressed block alternates literal and run segments", () => {
	// Literals to offset 3, then a run of $ff to the end of the sector.
	const result = decodeDcm(
		pass(SD | LAST, 1, 0x43 | SEQUENTIAL, 3, 1, 2, 3, 128, 0xff, 0x45),
	);
	const sector = sectorOf(result.bytes, 1);
	expect([...sector.subarray(0, 4)]).toEqual([1, 2, 3, 0xff]);
	expect(sector[127]).toBe(0xff);
});

test("a later segment offset of zero means 256, which only fits DD", () => {
	// Sector 4 of a double-density image is a full 256 bytes, so a run to
	// "0" reaches its end.
	const result = decodeDcm(
		pass(DD | LAST, 4, 0x43 | SEQUENTIAL, 1, 0x77, 0, 0xee, 0x45),
	);
	const sector = openAtr(result.bytes).readSector(4) as Uint8Array;
	expect(sector.length).toBe(256);
	expect(sector[0]).toBe(0x77);
	expect(sector[255]).toBe(0xee);
	// The same thing in a 128-byte sector is a corrupt file, not a fill to
	// the end - and no file in the corpus does it.
	expect(() =>
		decodeDcm(pass(SD | LAST, 1, 0x43 | SEQUENTIAL, 1, 0x77, 0, 0xee, 0x45)),
	).toThrow(/out of order/);
});

test("change-end keeps the head and change-begin keeps the tail", () => {
	const base = Array.from({ length: 128 }, () => 0xaa);
	const result = decodeDcm(
		pass(
			SD | LAST,
			1,
			0x47 | SEQUENTIAL,
			...base,
			// Sector 2: keep bytes 0..125, two new literals at the end.
			0x44 | SEQUENTIAL,
			126,
			0x11,
			0x22,
			// Sector 3: three new bytes at the start, reversed, tail kept.
			0x41 | SEQUENTIAL,
			2,
			0x33,
			0x22,
			0x11,
			0x45,
		),
	);
	const second = sectorOf(result.bytes, 2);
	expect(second[125]).toBe(0xaa);
	expect([...second.subarray(126)]).toEqual([0x11, 0x22]);

	const third = sectorOf(result.bytes, 3);
	// Reversed: the first byte read lands furthest along.
	expect([...third.subarray(0, 3)]).toEqual([0x11, 0x22, 0x33]);
	// The tail is what sector 2 left, not a fill byte.
	expect(third[126]).toBe(0x11);
	expect(third[127]).toBe(0x22);
});

test("a clear sequential bit means an explicit next sector", () => {
	const result = decodeDcm(
		pass(
			SD | LAST,
			1,
			0x47, // no sequential bit, so a sector number follows the payload
			...new Array(128).fill(0x5a),
			10,
			0, // ... sector 10
			0x46 | SEQUENTIAL,
			0x45,
		),
	);
	expect(sectorOf(result.bytes, 1)[0]).toBe(0x5a);
	expect(sectorOf(result.bytes, 2)[0]).toBe(0); // skipped, so still empty
	expect(sectorOf(result.bytes, 10)[0]).toBe(0x5a);
});

test("passes chain, and the sector buffer carries across them", () => {
	const first = pass(SD, 1, 0x47 | SEQUENTIAL, ...new Array(128).fill(7), 0x45);
	const second = pass(SD | LAST, 100, 0x46 | SEQUENTIAL, 0x45);
	const joined = Uint8Array.from([...first, ...second]);
	const result = decodeDcm(joined);
	expect(result.passes).toBe(2);
	// Sector 100 is "same as before", and before was the last sector of the
	// previous pass.
	expect(sectorOf(result.bytes, 100)[0]).toBe(7);
});

test("a stream ending on a non-final pass says what to do", () => {
	expect(() =>
		decodeDcm(pass(SD, 1, 0x47 | SEQUENTIAL, ...new Array(128).fill(0), 0x45)),
	).toThrow(/join the parts first/);
});

test("double density carries full sectors even for the boot sectors", () => {
	// 256 bytes for sector 1, though an ATR stores only 128 of them.
	const data = Array.from({ length: 256 }, (_, i) => i & 0xff);
	const result = decodeDcm(
		pass(DD | LAST, 1, 0x47 | SEQUENTIAL, ...data, 0x45),
	);
	expect(result.sectorSize).toBe(256);
	const image = openAtr(result.bytes);
	expect([...(image.readSector(1) as Uint8Array)]).toEqual(data.slice(0, 128));
	// Reading it as 128 instead leaves the stream out of step, which is how
	// every double-density file in the corpus failed before this was fixed.
	expect(() =>
		decodeDcm(pass(DD | LAST, 1, 0x47 | SEQUENTIAL, ...data, 0x45), {
			shortBootSectors: true,
		}),
	).toThrow();
});

test("enhanced density is 1040 sectors", () => {
	const result = decodeDcm(pass(ED | LAST, 1, 0x45));
	expect(result.sectorCount).toBe(1040);
	expect(result.sectorSize).toBe(128);
});

test("rejects a corrupt stream rather than guessing", () => {
	expect(() => decodeDcm(pass(SD | LAST, 1, 0x40, 0x45))).toThrow(
		/unknown block type/,
	);
	expect(() => decodeDcm(pass(SD | LAST, 1, 0x47 | SEQUENTIAL, 1, 2))).toThrow(
		/truncated/,
	);
	expect(() => decodeDcm(Uint8Array.from([1, 2, 3, 4]))).toThrow(/pass header/);
});
