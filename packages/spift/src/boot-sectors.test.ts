import { expect, test } from "vitest";
import { ATR_HEADER_SIZE, createBlankAtr, openAtr } from "./atr.ts";
import { extractBootSectors, writeBootSectors } from "./boot-sectors.ts";

function bootFile(bytes: number, claimed: number): Uint8Array {
	const file = Uint8Array.from({ length: bytes }, (_, i) => (i + 7) & 0xff);
	file[1] = claimed;
	return file;
}

test("writes whole-sector boot files", () => {
	const image = openAtr(createBlankAtr());
	const boot = bootFile(384, 3);
	expect(writeBootSectors(image, boot)).toEqual({
		sectorsWritten: 3,
		claimedSectors: 3,
		padded: 0,
	});
	expect(image.readSector(1)?.[1]).toBe(3);
	expect(image.readSector(3)?.[127]).toBe(boot[383]);
	expect(image.readSector(4)?.every((byte) => byte === 0)).toBe(true);
});

test("256-bps images count the first three sectors as 128 bytes", () => {
	const image = openAtr(createBlankAtr({ sectorSize: 256 }));
	// 3 x 128 + 1 x 256: four sectors on a DD image.
	expect(writeBootSectors(image, bootFile(640, 4)).sectorsWritten).toBe(4);
	expect(image.readSector(4)).toHaveLength(256);
	expect(image.readSector(4)?.[255]).toBe(bootFile(640, 4)[639]);
	// 512 bytes lands mid-sector-4 on DD (384 + 256 boundary is 640).
	expect(() => writeBootSectors(image, bootFile(512, 4))).toThrow(
		/not a whole number of sectors/,
	);
	expect(writeBootSectors(image, bootFile(512, 4), { pad: true })).toEqual({
		sectorsWritten: 4,
		claimedSectors: 4,
		padded: 128,
	});
});

test("--pad zero-fills the tail", () => {
	const image = openAtr(createBlankAtr());
	expect(() => writeBootSectors(image, bootFile(200, 2))).toThrow(/use --pad/);
	const result = writeBootSectors(image, bootFile(200, 2), { pad: true });
	expect(result).toEqual({ sectorsWritten: 2, claimedSectors: 2, padded: 56 });
	const second = image.readSector(2);
	expect(second?.[71]).not.toBe(0);
	expect(second?.subarray(72).every((byte) => byte === 0)).toBe(true);
});

test("checks the boot record's sector-count byte", () => {
	const image = openAtr(createBlankAtr());
	expect(() => writeBootSectors(image, bootFile(384, 2))).toThrow(
		/second byte claims 2 boot sector\(s\) but the file spans 3/,
	);
	expect(
		writeBootSectors(image, bootFile(384, 2), { force: true }).sectorsWritten,
	).toBe(3);
});

test("extract round-trips write, sized by the boot record", () => {
	const image = openAtr(createBlankAtr());
	const boot = bootFile(384, 3);
	writeBootSectors(image, boot);
	const extracted = extractBootSectors(image);
	expect(extracted.sectorCount).toBe(3);
	expect(extracted.claimedSectors).toBe(3);
	expect([...extracted.bytes]).toEqual([...boot]);
});

test("extract round-trips on 256-bps images", () => {
	const image = openAtr(createBlankAtr({ sectorSize: 256 }));
	const boot = bootFile(640, 4);
	writeBootSectors(image, boot);
	const extracted = extractBootSectors(image);
	expect(extracted.bytes).toHaveLength(640);
	expect([...extracted.bytes]).toEqual([...boot]);
});

test("extract requires --sector-count on weird boot records", () => {
	const blank = openAtr(createBlankAtr()); // second byte is 0
	expect(() => extractBootSectors(blank)).toThrow(
		/claims 0 boot sector\(s\); specify --sector-count/,
	);
	expect(extractBootSectors(blank, { sectorCount: 2 }).bytes).toHaveLength(256);
	const image = openAtr(createBlankAtr({ sectorCount: 8 }));
	writeBootSectors(image, bootFile(128, 9), { force: true });
	expect(() => extractBootSectors(image)).toThrow(
		/claims 9 boot sector\(s\) but the image has 8/,
	);
	expect(extractBootSectors(image, { sectorCount: 1 }).bytes).toHaveLength(128);
	expect(() => extractBootSectors(image, { sectorCount: 9 })).toThrow(
		/invalid sector count 9/,
	);
});

test("rejects files that do not fit and degenerate input", () => {
	const tiny = openAtr(createBlankAtr().subarray(0, ATR_HEADER_SIZE + 2 * 128));
	// A sparse blank still has 720 sectors of capacity, so shrink the claim:
	const image = openAtr(createBlankAtr({ sectorCount: 2 }));
	expect(() => writeBootSectors(image, bootFile(384, 3))).toThrow(
		/does not fit/,
	);
	expect(() => writeBootSectors(image, new Uint8Array(1))).toThrow(/too short/);
	expect(tiny.sectorCount).toBe(720); // sparse: header stays authoritative
});
