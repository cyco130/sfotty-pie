import { expect, test } from "vitest";
import { makeAtr } from "./atr-fixture.ts";
import { AtrImage } from "./atr.ts";

test("single density", () => {
	const atr = new AtrImage(makeAtr(128, 720));
	expect(atr.sectorSize).toBe(128);
	expect(atr.sectorCount).toBe(720);

	expect(atr.readSector(1)).toHaveLength(128);
	expect(atr.readSector(1)![0]).toBe(1);
	expect(atr.readSector(720)![0]).toBe(720 & 0xff);

	expect(atr.readSector(0)).toBeNull();
	expect(atr.readSector(721)).toBeNull();
});

test("double density with 128-byte boot sector slots", () => {
	const atr = new AtrImage(makeAtr(256, 720));
	expect(atr.sectorSize).toBe(256);
	expect(atr.sectorCount).toBe(720);

	// Boot sectors transfer as 128 bytes; the rest are full sectors.
	expect(atr.readSector(3)).toHaveLength(128);
	expect(atr.readSector(3)![0]).toBe(3);
	expect(atr.readSector(4)).toHaveLength(256);
	expect(atr.readSector(4)![0]).toBe(4);
	expect(atr.readSector(720)![0]).toBe(720 & 0xff);
});

test("double density with full-size boot sector slots", () => {
	const atr = new AtrImage(makeAtr(256, 720, false));
	expect(atr.sectorCount).toBe(720);

	// Stored as 256-byte slots, but still transferred as 128 bytes.
	expect(atr.readSector(2)).toHaveLength(128);
	expect(atr.readSector(2)![0]).toBe(2);
	expect(atr.readSector(4)).toHaveLength(256);
	expect(atr.readSector(4)![0]).toBe(4);
});

test("invalid images are rejected", () => {
	expect(() => new AtrImage(new Uint8Array(8))).toThrow("Not an ATR image");

	const badMagic = makeAtr(128, 3);
	badMagic[0] = 0x00;
	expect(() => new AtrImage(badMagic)).toThrow("Not an ATR image");

	const badSectorSize = makeAtr(128, 3);
	badSectorSize[4] = 64;
	expect(() => new AtrImage(badSectorSize)).toThrow("sector size");
});

test("writeSector round-trips and rejects out-of-range sectors", () => {
	const atr = new AtrImage(makeAtr(128, 8));

	expect(atr.writeSector(4, new Uint8Array(128).fill(0xab))).toBe(true);
	expect(atr.readSector(4)![0]).toBe(0xab);
	expect(atr.readSector(4)![127]).toBe(0xab);
	// A neighbor keeps its fixture value.
	expect(atr.readSector(5)![0]).toBe(5);

	expect(atr.writeSector(0, new Uint8Array(128))).toBe(false);
	expect(atr.writeSector(9, new Uint8Array(128))).toBe(false);
});

test("writeSector honors the double-density boot-sector layout", () => {
	const atr = new AtrImage(makeAtr(256, 8));

	// Boot sectors transfer 128 bytes even on DD.
	expect(atr.writeSector(2, new Uint8Array(128).fill(0x11))).toBe(true);
	expect(atr.readSector(2)).toHaveLength(128);
	expect(atr.readSector(2)![127]).toBe(0x11);

	// Data sectors are full 256-byte slots and don't bleed into the boot area.
	expect(atr.writeSector(4, new Uint8Array(256).fill(0x22))).toBe(true);
	expect(atr.readSector(4)![255]).toBe(0x22);
	expect(atr.readSector(3)![0]).toBe(3);
});

test("toBytes reflects writes and preserves the header", () => {
	const atr = new AtrImage(makeAtr(128, 4));
	atr.writeSector(1, new Uint8Array(128).fill(0x5a));

	const bytes = atr.toBytes();
	expect(bytes[0]).toBe(0x96); // header magic intact
	expect(bytes[1]).toBe(0x02);
	expect(bytes[16]).toBe(0x5a); // first data byte = sector 1, byte 0
});

test("write protection defaults off and is settable", () => {
	expect(new AtrImage(makeAtr(128, 4)).writeProtected).toBe(false);
	expect(
		new AtrImage(makeAtr(128, 4), { writeProtected: true }).writeProtected,
	).toBe(true);
});
