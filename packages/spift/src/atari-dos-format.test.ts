import { expect, test } from "vitest";
import {
	checkAtariDosGeometry,
	defaultAtariDosVariant,
	detectAtariDos,
	formatAtariDos,
	openAtariDos,
} from "./atari-dos.ts";
import { createBlankAtr, openAtr } from "./atr.ts";
import type { AtariDosVariant } from "./atari-dos.ts";

function fresh(sectorSize: 128 | 256, sectorCount: number) {
	return openAtr(createBlankAtr({ sectorSize, sectorCount }));
}

function vtocOf(image: ReturnType<typeof fresh>) {
	const vtoc = image.readSector(360)!;
	return {
		code: vtoc[0],
		total: (vtoc[1] ?? 0) | ((vtoc[2] ?? 0) << 8),
		free: (vtoc[3] ?? 0) | ((vtoc[4] ?? 0) << 8),
		isFree: (sector: number) =>
			((vtoc[10 + (sector >> 3)] ?? 0) & (0x80 >> (sector & 7))) !== 0,
	};
}

// The numbers every case below is checked against come from disks formatted
// by the real DOSes in the emulator (see notes.local/guest-matrix.md).
const GOLDEN: Record<
	string,
	{ variant: AtariDosVariant; size: 128 | 256; count: number; total: number }
> = {
	"dos10 SD": { variant: "dos10", size: 128, count: 720, total: 709 },
	"dos20s SD": { variant: "dos20s", size: 128, count: 720, total: 707 },
	"dos20d DD": { variant: "dos20d", size: 256, count: 720, total: 707 },
	"dos25 ED": { variant: "dos25", size: 128, count: 1040, total: 1010 },
	"mydos SD": { variant: "mydos", size: 128, count: 720, total: 708 },
	"mydos DD": { variant: "mydos", size: 256, count: 720, total: 708 },
};

for (const [name, golden] of Object.entries(GOLDEN)) {
	test(`formats ${name} with the real DOS's own totals`, () => {
		const image = fresh(golden.size, golden.count);
		const result = formatAtariDos(image, golden.variant);
		expect(result.totalSectors).toBe(golden.total);
		const vtoc = vtocOf(image);
		expect(vtoc.code).toBe(golden.variant === "dos10" ? 1 : 2);
		expect(vtoc.total).toBe(golden.total);
		// Reserved areas are used, data areas free.
		expect(vtoc.isFree(0)).toBe(false);
		expect(vtoc.isFree(1)).toBe(false);
		expect(vtoc.isFree(360)).toBe(false);
		expect(vtoc.isFree(368)).toBe(false);
		expect(vtoc.isFree(369)).toBe(true);
		// DOS 1.0 reserves one boot sector, everything else three.
		expect(vtoc.isFree(2)).toBe(golden.variant === "dos10");
		expect(vtoc.isFree(3)).toBe(golden.variant === "dos10");
		// Only MyDOS reclaims sector 720.
		expect(vtoc.isFree(720)).toBe(golden.variant === "mydos");
		// Detection reads it back as itself, except that a MyDOS filesystem
		// on a standard disk is DOS 2.0 compatible and the OneDOS ladder
		// says so (total 708 lands in its extended-DOS-2.0 branch). Nothing
		// downstream cares: the drivers follow the bitmap, not the label.
		const expected =
			golden.variant === "mydos"
				? golden.size === 256
					? "dos20d"
					: "dos20s"
				: golden.variant;
		expect(detectAtariDos(image)).toBe(expected);
		expect([...openAtariDos(image).entries()]).toHaveLength(0);
	});
}

test("DOS 2.5 splits its accounting across both VTOCs", () => {
	const image = fresh(128, 1040);
	formatAtariDos(image, "dos25");
	const vtoc = image.readSector(360)!;
	const vtoc2 = image.readSector(1024)!;
	expect(vtocOf(image).free).toBe(707); // sectors below 720 only
	expect((vtoc2[122] ?? 0) | ((vtoc2[123] ?? 0) << 8)).toBe(303);
	expect([...vtoc2.subarray(0, 84)]).toEqual([...vtoc.subarray(16, 100)]);
	// Sector 720 is used, 721.. free, in the second VTOC.
	const free = (s: number) =>
		((vtoc2[84 + ((s - 720) >> 3)] ?? 0) & (0x80 >> ((s - 720) & 7))) !== 0;
	expect(free(720)).toBe(false);
	expect(free(721)).toBe(true);
	expect(free(1023)).toBe(true);
});

test("MyDOS spills its bitmap into extra VTOC sectors", () => {
	// Matches a MyDOS 4.53 enhanced-density format: code 3, one extra page
	// at sector 359 covering 944.., sector 358 still free for data, and one
	// free count for the whole disk.
	const image = fresh(128, 1040);
	const result = formatAtariDos(image, "mydos");
	expect(result.totalSectors).toBe(1027);
	expect(result.unusableSectors).toBe(0);
	const vtoc = vtocOf(image);
	expect(vtoc.code).toBe(3);
	expect(vtoc.total).toBe(1027);
	expect(vtoc.free).toBe(1027);
	expect(vtoc.isFree(358)).toBe(true);
	expect(vtoc.isFree(359)).toBe(false);
	const extra = image.readSector(359)!;
	const freeBit = (bit: number) =>
		((extra[bit >> 3] ?? 0) & (0x80 >> (bit & 7))) !== 0;
	expect(freeBit(0)).toBe(true); // sector 944
	expect(freeBit(1040 - 944)).toBe(true); // the last sector
	expect(freeBit(1040 - 944 + 1)).toBe(false); // past the disk
	expect(detectAtariDos(image)).toBe("mydos");
});

test("files reach into the extra VTOC region with full links", () => {
	const image = fresh(128, 1040);
	formatAtariDos(image, "mydos");
	const fs = openAtariDos(image, "mydos");
	// Fill everything the main bitmap covers, then write past it: the rest
	// of the disk is sectors 944..1040, which crosses the 1023 ceiling of
	// the 10-bit sector link and so needs MyDOS-style full links.
	const capacity = 125;
	fs.writeFile("filler.dat", new Uint8Array(930 * capacity));
	const spill = Uint8Array.from({ length: 97 * capacity }, (_, i) => i & 0xff);
	fs.writeFile("spill.dat", spill);
	const entry = [...fs.entries("spill.dat")][0];
	expect(entry?.startSector).toBe(944);
	expect(entry?.attributes).toContain("AtariMyDos");
	const back = fs.readFile("spill.dat");
	expect(back?.diagnostics).toEqual([]);
	expect([...(back?.bytes ?? [])]).toEqual([...spill]);
	expect(vtocOf(image).free).toBe(0);
	// Deleting gives the extra-region sectors back.
	fs.deleteFile("spill.dat");
	expect(vtocOf(image).free).toBe(97);
});

test("allocation follows the bitmap from sector 1, never sector 0", () => {
	// DOS 1.0 reserves one boot sector, so 2 and 3 are ordinary data - and
	// that is where real DOS 1.0 puts DOS.SYS.
	const dos1 = fresh(128, 720);
	formatAtariDos(dos1, "dos10");
	const fs1 = openAtariDos(dos1, "dos10");
	fs1.writeFile("first.dat", new Uint8Array(1), { format: "dos1" });
	expect([...fs1.entries("first.dat")][0]?.startSector).toBe(2);

	// DOS 2 formats mark all three boot sectors used, so data starts at 4.
	const dos2 = fresh(128, 720);
	formatAtariDos(dos2, "dos20s");
	const fs2 = openAtariDos(dos2, "dos20s");
	fs2.writeFile("first.dat", new Uint8Array(1));
	expect([...fs2.entries("first.dat")][0]?.startSector).toBe(4);

	// A bitmap that offers a boot sector gets taken up on it, as the real
	// DOSes do - but bit 0 is never a candidate.
	const loose = fresh(128, 720);
	formatAtariDos(loose, "dos20s");
	const vtoc = loose.readSector(360)!;
	// Free sector 1, and "sector 0" too, which must stay ignored.
	vtoc[10] = (vtoc[10] ?? 0) | 0x80 | (0x80 >> 1);
	loose.writeSector(360, vtoc);
	const fs3 = openAtariDos(loose, "dos20s");
	fs3.writeFile("boot.dat", new Uint8Array(1));
	expect([...fs3.entries("boot.dat")][0]?.startSector).toBe(1);
});

test("a formatted disk accepts files immediately", () => {
	const image = fresh(128, 720);
	formatAtariDos(image, "dos20s");
	const fs = openAtariDos(image);
	fs.writeFile("hello.txt", Uint8Array.of(1, 2, 3));
	expect(fs.readFile("hello.txt")?.bytes).toHaveLength(3);
	expect(vtocOf(image).free).toBe(706);
});

test("default variants follow the geometry", () => {
	expect(defaultAtariDosVariant(128, 720)).toBe("dos20s");
	expect(defaultAtariDosVariant(128, 1040)).toBeUndefined(); // ambiguous
	expect(defaultAtariDosVariant(256, 720)).toBe("mydos");
	expect(defaultAtariDosVariant(128, 400)).toBe("mydos");
});

test("geometry checks reject impossible combinations", () => {
	expect(checkAtariDosGeometry("dos20s", 512, 720)).toMatch(/128- or 256/);
	expect(checkAtariDosGeometry("dos10", 256, 720)).toMatch(/only supports 128/);
	expect(checkAtariDosGeometry("dos25", 256, 1040)).toMatch(
		/only supports 128/,
	);
	expect(checkAtariDosGeometry("dos25", 128, 720)).toMatch(/at least 1024/);
	expect(checkAtariDosGeometry("dos20s", 128, 368)).toMatch(/more than 368/);
	// Large MyDOS disks are fine now - extra bitmap pages cover them, and
	// even the largest ATR's 64 pages fit below the directory.
	expect(checkAtariDosGeometry("mydos", 128, 2000)).toBeUndefined();
	expect(checkAtariDosGeometry("mydos", 128, 65535)).toBeUndefined();
	expect(checkAtariDosGeometry("dos20s", 128, 720)).toBeUndefined();
	expect(formatAtariDos).toBeTypeOf("function");
	expect(() => formatAtariDos(fresh(128, 100), "dos20s")).toThrow(
		/more than 368/,
	);
});

test("boot sectors must match the variant's boot area", () => {
	const image = fresh(128, 720);
	const boot = new Uint8Array(384);
	boot[1] = 3;
	formatAtariDos(image, "dos20s", { bootSectors: boot });
	expect(image.readSector(1)?.[1]).toBe(3);

	expect(() =>
		formatAtariDos(image, "dos20s", { bootSectors: new Uint8Array(256) }),
	).toThrow(/reserves 3 boot sector\(s\) \(384 bytes\), the file has 256/);
	const wrongClaim = new Uint8Array(384);
	wrongClaim[1] = 1;
	expect(() =>
		formatAtariDos(image, "dos20s", { bootSectors: wrongClaim }),
	).toThrow(/claims 1 boot sector\(s\) but DOS 2.0S reserves 3/);
	// DOS 1.0 takes a single sector.
	const one = new Uint8Array(128);
	one[1] = 1;
	const dos1 = fresh(128, 720);
	formatAtariDos(dos1, "dos10", { bootSectors: one });
	expect(dos1.readSector(1)?.[1]).toBe(1);
	expect(() => formatAtariDos(dos1, "dos10", { bootSectors: boot })).toThrow(
		/reserves 1 boot sector/,
	);
});

test("formatting wipes what was there", () => {
	const image = fresh(128, 720);
	formatAtariDos(image, "dos20s");
	const fs = openAtariDos(image);
	fs.writeFile("gone.txt", new Uint8Array(200));
	expect([...fs.entries()]).toHaveLength(1);
	formatAtariDos(image, "dos20s");
	expect([...openAtariDos(image).entries()]).toHaveLength(0);
	expect(vtocOf(image).free).toBe(707);
});
