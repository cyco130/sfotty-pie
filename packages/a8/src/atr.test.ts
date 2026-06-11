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
