import { expect, test } from "vitest";
import {
	applyAtariNameTemplate,
	checkAtariDosGeometry,
	defaultAtariDosVariant,
	detectAtariDos,
	formatAtariDos,
	openAtariDos,
	readAtariDosFilePointer,
	writeAtariDosFilePointer,
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
	"dos20 SD": { variant: "dos20", size: 128, count: 720, total: 707 },
	"dos20 DD": { variant: "dos20", size: 256, count: 720, total: 707 },
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
					? "dos20"
					: "dos20"
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
	fs.removeFile("spill.dat");
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
	formatAtariDos(dos2, "dos20");
	const fs2 = openAtariDos(dos2, "dos20");
	fs2.writeFile("first.dat", new Uint8Array(1));
	expect([...fs2.entries("first.dat")][0]?.startSector).toBe(4);

	// A bitmap that offers a boot sector gets taken up on it, as the real
	// DOSes do - but bit 0 is never a candidate.
	const loose = fresh(128, 720);
	formatAtariDos(loose, "dos20");
	const vtoc = loose.readSector(360)!;
	// Free sector 1, and "sector 0" too, which must stay ignored.
	vtoc[10] = (vtoc[10] ?? 0) | 0x80 | (0x80 >> 1);
	loose.writeSector(360, vtoc);
	const fs3 = openAtariDos(loose, "dos20");
	fs3.writeFile("boot.dat", new Uint8Array(1));
	expect([...fs3.entries("boot.dat")][0]?.startSector).toBe(1);
});

test("the boot record's DOS file pointer round-trips per variant", () => {
	// DOS 2 keeps it at bytes 15-16; DOS 1.0 at 16-17 with $ff at byte 14,
	// both measured from the real masters.
	const dos2 = fresh(128, 720);
	formatAtariDos(dos2, "dos20");
	expect(readAtariDosFilePointer(dos2, "dos20")).toBe(0);
	writeAtariDosFilePointer(dos2, "dos20", 4);
	expect(readAtariDosFilePointer(dos2, "dos20")).toBe(4);
	const boot2 = dos2.readSector(1)!;
	expect([boot2[15], boot2[16]]).toEqual([4, 0]);

	const dos1 = fresh(128, 720);
	formatAtariDos(dos1, "dos10");
	writeAtariDosFilePointer(dos1, "dos10", 300);
	const boot1 = dos1.readSector(1)!;
	expect(boot1[14]).toBe(0xff);
	expect([boot1[16], boot1[17]]).toEqual([300 & 0xff, 300 >> 8]);
	expect(readAtariDosFilePointer(dos1, "dos10")).toBe(300);
	// Clearing drops the flag DOS 1.0's boot code insists on.
	writeAtariDosFilePointer(dos1, "dos10", 0);
	expect(dos1.readSector(1)?.[14]).toBe(0);
	expect(readAtariDosFilePointer(dos1, "dos10")).toBe(0);
});

test("the DOS file shows up as an attribute on the file it points at", () => {
	const image = fresh(128, 720);
	formatAtariDos(image, "dos20");
	const fs = openAtariDos(image, "dos20");
	fs.writeFile("dos.sys", new Uint8Array(300));
	fs.writeFile("other.dat", new Uint8Array(10));
	const dos = [...fs.entries("dos.sys")][0];
	expect(dos?.attributes).not.toContain("BootFile");
	writeAtariDosFilePointer(image, "dos20", dos?.startSector ?? 0);
	expect([...fs.entries("dos.sys")][0]?.attributes).toContain("BootFile");
	expect([...fs.entries("other.dat")][0]?.attributes).not.toContain("BootFile");
});

test("the boot pointer follows the DOS file, and dies with it", () => {
	const image = fresh(128, 720);
	formatAtariDos(image, "dos20");
	const fs = openAtariDos(image, "dos20");
	// Written second, so it sits past the filler rather than at sector 4.
	fs.writeFile("filler.dat", new Uint8Array(500));
	fs.writeFile("dos.sys", new Uint8Array(300));
	const original = [...fs.entries("dos.sys")][0]?.startSector ?? 0;
	writeAtariDosFilePointer(image, "dos20", original);
	// Free the sectors ahead of it, then rewrite it: first-free allocation
	// now puts it earlier on the disk, and the pointer has to follow or the
	// disk quietly stops booting.
	fs.removeFile("filler.dat");
	fs.writeFile("dos.sys", new Uint8Array(300), { overwrite: true });
	const moved = [...fs.entries("dos.sys")][0]?.startSector ?? 0;
	expect(moved).toBe(4);
	expect(moved).not.toBe(original);
	expect(readAtariDosFilePointer(image, "dos20")).toBe(moved);
	expect([...fs.entries("dos.sys")][0]?.attributes).toContain("BootFile");

	// Rewriting an unrelated file leaves the pointer alone.
	fs.writeFile("other.dat", new Uint8Array(30));
	fs.writeFile("other.dat", new Uint8Array(40), { overwrite: true });
	expect(readAtariDosFilePointer(image, "dos20")).toBe(moved);

	// Deleting it unsets the pointer rather than leaving it dangling.
	fs.removeFile("dos.sys");
	expect(readAtariDosFilePointer(image, "dos20")).toBe(0);
});

test("deleting an ordinary file leaves the boot pointer alone", () => {
	const image = fresh(128, 720);
	formatAtariDos(image, "dos10");
	const fs = openAtariDos(image, "dos10");
	fs.writeFile("dos.sys", new Uint8Array(300), { format: "dos1" });
	fs.writeFile("other.dat", new Uint8Array(10), { format: "dos1" });
	const dos = [...fs.entries("dos.sys")][0]?.startSector ?? 0;
	writeAtariDosFilePointer(image, "dos10", dos);
	fs.removeFile("other.dat");
	expect(readAtariDosFilePointer(image, "dos10")).toBe(dos);
	// ... and DOS 1.0's present flag survives too.
	expect(image.readSector(1)?.[14]).toBe(0xff);
	fs.removeFile("dos.sys");
	expect(image.readSector(1)?.[14]).toBe(0);
});

test("mkdir writes a MyDOS-shaped directory", () => {
	const image = fresh(128, 720);
	formatAtariDos(image, "mydos");
	const fs = openAtariDos(image, "mydos");
	fs.makeDirectory("games");
	const entry = [...fs.entries("games", { listContents: false })][0];
	// The measured shape: $10 exactly (in-use clear, which is what makes
	// other DOSes skip it), size 8, and eight zeroed contiguous sectors.
	expect(entry).toMatchObject({ kind: "dir", sectors: 8 });
	const raw = image.readSector(361)!; // the root directory's first sector
	expect(raw[0]).toBe(0x10);
	const block = entry?.startSector ?? 0;
	for (let i = 0; i < 8; i++) {
		expect(image.readSector(block + i)?.every((b) => b === 0)).toBe(true);
	}
	// The eight sectors are marked used, and the directory reads as empty.
	expect(vtocOf(image).free).toBe(708 - 8);
	expect([...fs.entries("games")]).toHaveLength(0);
});

test("directories nest, hold files, and go away again", () => {
	const image = fresh(128, 720);
	formatAtariDos(image, "mydos");
	const fs = openAtariDos(image, "mydos");
	fs.makeDirectory("a/b/c", { parents: true });
	expect([...fs.entries(undefined, { recursive: true })].map((e) => e.path)) //
		.toEqual(["a", "a/b", "a/b/c"]);
	// -p accepts what is already there; without it, a second try is an error.
	fs.makeDirectory("a/b", { parents: true });
	expect(() => fs.makeDirectory("a/b")).toThrow(/already exists/);

	fs.writeFile("a/b/c/deep.dat", Uint8Array.from([7, 7, 7]));
	expect(fs.readFile("a/b/c/deep.dat")?.bytes).toHaveLength(3);
	expect(() => fs.removeDirectory("a/b/c")).toThrow(/not empty/);
	expect(() => fs.removeDirectory("a/b/c/deep.dat")).toThrow(/is a file/);

	fs.removeFile("a/b/c/deep.dat");
	const free = vtocOf(image).free;
	fs.removeDirectory("a/b/c");
	expect(vtocOf(image).free).toBe(free + 8); // the block comes back
	expect([...fs.entries("a/b")]).toHaveLength(0);
});

test("mkdir needs a contiguous run, not just free sectors", () => {
	const image = fresh(128, 720);
	formatAtariDos(image, "mydos");
	// Free every other sector: plenty of room, no run of eight.
	const vtoc = image.readSector(360)!;
	vtoc.fill(0, 10, 128);
	let free = 0;
	for (let s = 4; s <= 350; s += 2) {
		vtoc[10 + (s >> 3)] = (vtoc[10 + (s >> 3)] ?? 0) | (0x80 >> (s & 7));
		free++;
	}
	vtoc[3] = free & 0xff;
	vtoc[4] = free >> 8;
	image.writeSector(360, vtoc);
	expect(free).toBeGreaterThan(100);
	expect(() => openAtariDos(image, "mydos").makeDirectory("nope")).toThrow(
		/no run of 8 free sectors/,
	);
});

test("renaming in place leaves the chain alone", () => {
	const image = fresh(128, 720);
	formatAtariDos(image, "mydos");
	const fs = openAtariDos(image, "mydos");
	fs.writeFile("first.dat", new Uint8Array(300));
	fs.writeFile("second.dat", new Uint8Array(300));
	const before = [...fs.entries("second.dat")][0];
	const chainByte = image.readSector(before?.startSector ?? 0)![125];

	expect(fs.moveFile("second.dat", "renamed.txt")).toEqual([]);
	const after = [...fs.entries("renamed.txt")][0];
	// Same slot, same sectors, same file number - only the name moved.
	expect(after?.startSector).toBe(before?.startSector);
	expect(image.readSector(after?.startSector ?? 0)![125]).toBe(chainByte);
	expect(fs.readFile("renamed.txt")?.diagnostics).toEqual([]);
	expect(fs.readFile("second.dat")).toBeNull();
	expect(() => fs.moveFile("first.dat", "renamed.txt")).toThrow(
		/already exists/,
	);
});

test("moving between directories renumbers the file's sectors", () => {
	const image = fresh(128, 720);
	formatAtariDos(image, "mydos");
	const fs = openAtariDos(image, "mydos");
	fs.makeDirectory("games");
	fs.makeDirectory("tools");
	fs.writeFile("tools/keep.dat", new Uint8Array(10)); // takes slot 0 there
	fs.writeFile("games/move.dat", new Uint8Array(400)); // slot 0 of games
	const before = [...fs.entries("games/move.dat")][0];
	expect(image.readSector(before?.startSector ?? 0)![125]! >> 2).toBe(0);

	fs.moveFile("games/move.dat", "tools/move.dat");
	const after = [...fs.entries("tools/move.dat")][0];
	expect(after?.startSector).toBe(before?.startSector); // data never moves
	// Slot 1 of tools now, so every sector of the chain says 1.
	let sector = after?.startSector ?? 0;
	let sectors = 0;
	while (sector !== 0) {
		const data = image.readSector(sector)!;
		expect(data[125]! >> 2).toBe(1);
		sector = ((data[125]! & 3) << 8) | data[126]!;
		sectors++;
	}
	expect(sectors).toBe(4);
	expect(fs.readFile("tools/move.dat")?.diagnostics).toEqual([]);
	expect([...fs.entries("games")]).toHaveLength(0);
});

test("directories move without any chain to renumber", () => {
	const image = fresh(128, 720);
	formatAtariDos(image, "mydos");
	const fs = openAtariDos(image, "mydos");
	fs.makeDirectory("a");
	fs.makeDirectory("b");
	fs.writeFile("b/inside.dat", new Uint8Array(10));
	const block = [...fs.entries("b", { listContents: false })][0]?.startSector;
	expect(fs.moveFile("b", "a/b")).toEqual([]);
	const moved = [...fs.entries("a/b", { listContents: false })][0];
	expect(moved?.startSector).toBe(block);
	// Its contents came along, since the block is what holds them.
	expect([...fs.entries("a/b")].map((e) => e.name)).toEqual(["inside.dat"]);
});

test("rename templates follow the DOSes' positional rules", () => {
	// Measured against DOS 2.0S: "*" copies to the end of the field, "?"
	// copies one character, a short template blanks the rest.
	expect(applyAtariNameTemplate("ab.lst", "*.txt")).toBe("ab.txt");
	expect(applyAtariNameTemplate("abcdefgh.lst", "*.txt")).toBe("abcdefgh.txt");
	expect(applyAtariNameTemplate("ab.txt", "q*.bak")).toBe("qb.bak");
	expect(applyAtariNameTemplate("abcdefgh.txt", "??z.bak")).toBe("abz.bak");
	// A short source pulls in the field's padding, spaces and all - which
	// is exactly what DOS 2.0S writes for this case.
	expect(applyAtariNameTemplate("x.txt", "??z.bak")).toBe("x z.bak");
	expect(applyAtariNameTemplate("a.b", "*.*")).toBe("a.b");
});

test("a formatted disk accepts files immediately", () => {
	const image = fresh(128, 720);
	formatAtariDos(image, "dos20");
	const fs = openAtariDos(image);
	fs.writeFile("hello.txt", Uint8Array.of(1, 2, 3));
	expect(fs.readFile("hello.txt")?.bytes).toHaveLength(3);
	expect(vtocOf(image).free).toBe(706);
});

test("default variants follow the geometry", () => {
	expect(defaultAtariDosVariant(128, 720)).toBe("dos20");
	// Enhanced density is DOS 2.5's home geometry, so it is the default there
	// (MyDOS fits too, but you have to ask for atari/mydos).
	expect(defaultAtariDosVariant(128, 1040)).toBe("dos25");
	expect(defaultAtariDosVariant(256, 720)).toBe("dos20");
	// Everything else is one DOS 2 filesystem, whatever its size.
	expect(defaultAtariDosVariant(128, 400)).toBe("dos20");
});

test("geometry checks reject impossible combinations", () => {
	expect(checkAtariDosGeometry("dos20", 512, 720)).toMatch(/128- or 256/);
	expect(checkAtariDosGeometry("dos10", 256, 720)).toMatch(/only supports 128/);
	expect(checkAtariDosGeometry("dos25", 256, 1040)).toMatch(
		/only supports 128/,
	);
	expect(checkAtariDosGeometry("dos25", 128, 720)).toMatch(/at least 1024/);
	expect(checkAtariDosGeometry("dos20", 128, 368)).toMatch(/more than 368/);
	// Large MyDOS disks are fine now - extra bitmap pages cover them, and
	// even the largest ATR's 64 pages fit below the directory.
	expect(checkAtariDosGeometry("mydos", 128, 2000)).toBeUndefined();
	expect(checkAtariDosGeometry("mydos", 128, 65535)).toBeUndefined();
	expect(checkAtariDosGeometry("dos20", 128, 720)).toBeUndefined();
	expect(formatAtariDos).toBeTypeOf("function");
	expect(() => formatAtariDos(fresh(128, 100), "dos20")).toThrow(
		/more than 368/,
	);
});

test("boot sectors must match the variant's boot area", () => {
	const image = fresh(128, 720);
	const boot = new Uint8Array(384);
	boot[1] = 3;
	formatAtariDos(image, "dos20", { bootSectors: boot });
	expect(image.readSector(1)?.[1]).toBe(3);

	expect(() =>
		formatAtariDos(image, "dos20", { bootSectors: new Uint8Array(256) }),
	).toThrow(/reserves 3 boot sector\(s\) \(384 bytes\), the file has 256/);
	const wrongClaim = new Uint8Array(384);
	wrongClaim[1] = 1;
	expect(() =>
		formatAtariDos(image, "dos20", { bootSectors: wrongClaim }),
	).toThrow(/claims 1 boot sector\(s\) but DOS 2.0\/MyDOS reserves 3/);
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
	formatAtariDos(image, "dos20");
	const fs = openAtariDos(image);
	fs.writeFile("gone.txt", new Uint8Array(200));
	expect([...fs.entries()]).toHaveLength(1);
	formatAtariDos(image, "dos20");
	expect([...openAtariDos(image).entries()]).toHaveLength(0);
	expect(vtocOf(image).free).toBe(707);
});
