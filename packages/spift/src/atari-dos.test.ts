import { expect, test } from "vitest";
import {
	detectAtariDos,
	openAtariDos,
	splitAtariPath,
	toAtariName,
} from "./atari-dos.ts";
import { ATR_HEADER_SIZE, createBlankAtr, openAtr } from "./atr.ts";
import { detectFilesystem } from "./detect.ts";

interface FixtureEntry {
	flags: number;
	name: string;
	sectors?: number;
	start?: number;
}

interface FixtureOptions {
	sectorSize?: 128 | 256;
	sectorCount?: number;
	code?: number;
	total?: number;
	free?: number;
	entries?: FixtureEntry[];
	/** Build real usage bitmaps (and VTOC2 on ED) like a fresh format. */
	formatted?: boolean;
}

function makeDisk(options: FixtureOptions = {}): Uint8Array {
	const {
		sectorSize = 128,
		sectorCount = 720,
		code = 2,
		total = 707,
		free = 600,
		entries = [],
	} = options;
	const bytes = createBlankAtr({ sectorSize, sectorCount });
	// Fixtures only poke sectors past the boot area, so the short-boot
	// offset formula is enough.
	const sectorOffset = (sector: number): number =>
		ATR_HEADER_SIZE +
		(sectorSize === 128 ? (sector - 1) * 128 : 384 + (sector - 4) * 256);
	const vtoc = sectorOffset(360);
	bytes[vtoc] = code;
	bytes[vtoc + 1] = total & 0xff;
	bytes[vtoc + 2] = total >> 8;
	bytes[vtoc + 3] = free & 0xff;
	bytes[vtoc + 4] = free >> 8;
	if (options.formatted) {
		let lowFree = 0;
		for (let s = 4; s <= Math.min(719, sectorCount); s++) {
			if (s >= 360 && s <= 368) {
				continue;
			}
			bytes[vtoc + 10 + (s >> 3)] =
				(bytes[vtoc + 10 + (s >> 3)] ?? 0) | (0x80 >> (s & 7));
			lowFree++;
		}
		bytes[vtoc + 3] = lowFree & 0xff;
		bytes[vtoc + 4] = lowFree >> 8;
		if (sectorCount >= 1024) {
			const vtoc2 = sectorOffset(1024);
			for (let i = 0; i < 84; i++) {
				bytes[vtoc2 + i] = bytes[vtoc + 16 + i] ?? 0;
			}
			for (let s = 720; s <= 1023; s++) {
				const off = s - 720;
				bytes[vtoc2 + 84 + (off >> 3)] =
					(bytes[vtoc2 + 84 + (off >> 3)] ?? 0) | (0x80 >> (off & 7));
			}
			bytes[vtoc2 + 122] = 304 & 0xff;
			bytes[vtoc2 + 123] = 304 >> 8;
		}
	}
	entries.forEach((entry, index) => {
		const at = sectorOffset(361 + Math.floor(index / 8)) + (index % 8) * 16;
		bytes[at] = entry.flags;
		const sectors = entry.sectors ?? 1;
		const start = entry.start ?? 100 + index;
		bytes[at + 1] = sectors & 0xff;
		bytes[at + 2] = sectors >> 8;
		bytes[at + 3] = start & 0xff;
		bytes[at + 4] = start >> 8;
		const dot = entry.name.indexOf(".");
		const name = dot === -1 ? entry.name : entry.name.slice(0, dot);
		const ext = dot === -1 ? "" : entry.name.slice(dot + 1);
		for (let i = 0; i < 8; i++) {
			bytes[at + 5 + i] = name.charCodeAt(i) || 0x20;
		}
		for (let i = 0; i < 3; i++) {
			bytes[at + 13 + i] = ext.charCodeAt(i) || 0x20;
		}
	});
	return bytes;
}

function list(bytes: Uint8Array, spec?: string) {
	return [...openAtariDos(openAtr(bytes)).entries(spec)];
}

interface DataSector {
	sector: number;
	next: number;
	length: number;
	fill: number;
	fileNumber?: number;
	fullLink?: boolean;
}

// Single-density only: pokes a data sector's payload and its three-byte
// link/length trailer.
function writeDataSector(bytes: Uint8Array, options: DataSector): void {
	const at = ATR_HEADER_SIZE + (options.sector - 1) * 128;
	bytes.fill(options.fill, at, at + 125);
	bytes[at + 125] = options.fullLink
		? options.next >> 8
		: ((options.fileNumber ?? 0) << 2) | ((options.next >> 8) & 0x03);
	bytes[at + 126] = options.next & 0xff;
	bytes[at + 127] = options.length;
}

function readAs(
	bytes: Uint8Array,
	name: string,
): { length: number; diagnostics: string[]; bytes: Uint8Array } | null {
	const contents = openAtariDos(openAtr(bytes)).readFile(name);
	return contents === null
		? null
		: { ...contents, length: contents.bytes.length };
}

test("readFile walks a DOS 2 chain", () => {
	const disk = makeDisk({
		entries: [{ flags: 0x42, name: "A.DAT", start: 100, sectors: 2 }],
	});
	writeDataSector(disk, { sector: 100, next: 101, length: 125, fill: 1 });
	writeDataSector(disk, { sector: 101, next: 0, length: 10, fill: 2 });
	const contents = readAs(disk, "a.dat");
	expect(contents?.diagnostics).toEqual([]);
	expect(contents?.length).toBe(135);
	expect(contents?.bytes[0]).toBe(1);
	expect(contents?.bytes[130]).toBe(2);
});

test("readFile walks a DOS 1 chain (last-sector flag, full sectors)", () => {
	const disk = makeDisk({
		entries: [{ flags: 0x40, name: "OLD.DAT", start: 100, sectors: 2 }],
	});
	// Mid-chain DOS 1 sectors are always full; the length byte is a
	// sequence cross-check we ignore.
	writeDataSector(disk, { sector: 100, next: 101, length: 0x64, fill: 3 });
	writeDataSector(disk, { sector: 101, next: 0, length: 0x80 | 20, fill: 4 });
	const contents = readAs(disk, "old.dat");
	expect(contents?.diagnostics).toEqual([]);
	expect(contents?.length).toBe(145);
});

test("readFile follows MyDOS full links without file-number checks", () => {
	const disk = makeDisk({
		sectorCount: 2000,
		entries: [{ flags: 0x46, name: "BIG.DAT", start: 1500, sectors: 2 }],
	});
	writeDataSector(disk, {
		sector: 1500,
		next: 1501,
		length: 125,
		fill: 5,
		fullLink: true,
	});
	writeDataSector(disk, {
		sector: 1501,
		next: 0,
		length: 5,
		fill: 6,
		fullLink: true,
	});
	expect(readAs(disk, "big.dat")).toMatchObject({
		length: 130,
		diagnostics: [],
	});
});

test("readFile stops on a file-number mismatch, keeping earlier data", () => {
	const disk = makeDisk({
		entries: [{ flags: 0x42, name: "A.DAT", start: 100, sectors: 2 }],
	});
	writeDataSector(disk, { sector: 100, next: 101, length: 125, fill: 1 });
	writeDataSector(disk, {
		sector: 101,
		next: 0,
		length: 10,
		fill: 2,
		fileNumber: 5,
	});
	const contents = readAs(disk, "a.dat");
	expect(contents?.length).toBe(125);
	expect(contents?.diagnostics).toEqual([
		"sector 101: file number 5 does not match directory slot 0",
	]);
});

test("readFile reports loops, escapes, and bad lengths", () => {
	const disk = makeDisk({
		entries: [
			{ flags: 0x42, name: "LOOP.DAT", start: 100, sectors: 2 },
			{ flags: 0x42, name: "GONE.DAT", start: 102, sectors: 1 },
			{ flags: 0x42, name: "FAT.DAT", start: 103, sectors: 1 },
		],
	});
	writeDataSector(disk, { sector: 100, next: 101, length: 125, fill: 1 });
	writeDataSector(disk, { sector: 101, next: 100, length: 125, fill: 1 });
	writeDataSector(disk, {
		sector: 102,
		next: 900,
		length: 125,
		fill: 1,
		fileNumber: 1,
	});
	writeDataSector(disk, {
		sector: 103,
		next: 0,
		length: 126,
		fill: 1,
		fileNumber: 2,
	});
	expect(readAs(disk, "loop.dat")?.diagnostics).toEqual([
		"sector 100: sector chain loops",
	]);
	expect(readAs(disk, "gone.dat")?.diagnostics).toEqual([
		"sector 900: outside the image",
	]);
	const fat = readAs(disk, "fat.dat");
	expect(fat?.length).toBe(125);
	expect(fat?.diagnostics).toEqual([
		"sector 103: data length 126 exceeds sector capacity 125",
	]);
});

test("readFile flags a sector-count mismatch on clean chains", () => {
	const disk = makeDisk({
		entries: [{ flags: 0x42, name: "A.DAT", start: 100, sectors: 5 }],
	});
	writeDataSector(disk, { sector: 100, next: 0, length: 7, fill: 1 });
	expect(readAs(disk, "a.dat")?.diagnostics).toEqual([
		"sector chain has 1 sectors, the directory entry says 5",
	]);
});

test("readFile returns null for missing names and directories", () => {
	const disk = makeDisk({
		entries: [
			{ flags: 0x42, name: "A.DAT", start: 100, sectors: 1 },
			{ flags: 0x10, name: "SUBDIR", start: 200, sectors: 8 },
		],
	});
	writeDataSector(disk, { sector: 100, next: 0, length: 1, fill: 1 });
	expect(readAs(disk, "b.dat")).toBeNull();
	expect(readAs(disk, "subdir")).toBeNull();
	expect(readAs(disk, "A.DAT")?.length).toBe(1);
});

test("detects DOS 2.0S and 2.0D", () => {
	expect(detectAtariDos(openAtr(makeDisk()))).toBe("dos20s");
	expect(detectAtariDos(openAtr(makeDisk({ sectorSize: 256 })))).toBe("dos20d");
});

test("detects a freshly formatted disk (free == total)", () => {
	expect(detectAtariDos(openAtr(makeDisk({ free: 707 })))).toBe("dos20s");
});

test("detects DOS 1.0", () => {
	expect(detectAtariDos(openAtr(makeDisk({ code: 1, total: 709 })))).toBe(
		"dos10",
	);
	// DOS 1.0 requires standard single density.
	expect(
		detectAtariDos(openAtr(makeDisk({ code: 1, total: 709, sectorSize: 256 }))),
	).toBeUndefined();
});

test("detects DOS 2.5 on standard ED", () => {
	expect(
		detectAtariDos(
			openAtr(makeDisk({ sectorCount: 1040, total: 1010, free: 1010 })),
		),
	).toBe("dos25");
});

test("detects extended DOS 2.0 on nonstandard geometry", () => {
	expect(
		detectAtariDos(
			openAtr(makeDisk({ sectorCount: 800, total: 800, free: 700 })),
		),
	).toBe("dos20s");
});

test("detects MyDOS via the VTOC sector count code", () => {
	// 1440 DD sectors: one extra VTOC page past 943, so code 3.
	expect(
		detectAtariDos(
			openAtr(
				makeDisk({
					sectorSize: 256,
					sectorCount: 1440,
					code: 3,
					total: 1440,
					free: 1000,
				}),
			),
		),
	).toBe("mydos");
	// The same geometry with the wrong code is not MyDOS.
	expect(
		detectAtariDos(
			openAtr(
				makeDisk({
					sectorSize: 256,
					sectorCount: 1440,
					code: 5,
					total: 1440,
					free: 1000,
				}),
			),
		),
	).toBeUndefined();
});

test("rejects garbage VTOCs", () => {
	expect(
		detectAtariDos(openAtr(makeDisk({ total: 707, free: 800 }))),
	).toBeUndefined();
	expect(detectAtariDos(openAtr(makeDisk({ code: 0 })))).toBeUndefined();
	expect(detectAtariDos(openAtr(createBlankAtr()))).toBeUndefined();
});

test("detects a SpartaDOS boot sector", () => {
	const bytes = createBlankAtr();
	bytes.set([0x4c, 0x80, 0x30], ATR_HEADER_SIZE + 6);
	expect(detectFilesystem(openAtr(bytes))).toEqual({ family: "sparta" });
	expect(detectFilesystem(openAtr(createBlankAtr()))).toBeUndefined();
	expect(detectFilesystem(openAtr(makeDisk()))).toEqual({
		family: "atari",
		variant: "dos20s",
	});
});

test("lists files in directory order, lowercased", () => {
	const entries = list(
		makeDisk({
			entries: [
				{ flags: 0x42, name: "DOS.SYS", sectors: 37, start: 4 },
				{ flags: 0x42, name: "DUP.SYS", sectors: 42, start: 41 },
				{ flags: 0x42, name: "README" },
			],
		}),
	);
	expect(entries.map((entry) => entry.name)).toEqual([
		"dos.sys",
		"dup.sys",
		"readme",
	]);
	expect(entries[0]).toEqual({
		name: "dos.sys",
		path: "dos.sys",
		kind: "file",
		sectors: 37,
		startSector: 4,
		attributes: [],
	});
});

test("skips deleted entries and stops at a never-used entry", () => {
	const entries = list(
		makeDisk({
			entries: [
				{ flags: 0x42, name: "KEEP.ME" },
				{ flags: 0x80, name: "GONE.OLD" },
				{ flags: 0x42, name: "ALSO.ME" },
				{ flags: 0x00, name: "END" },
				{ flags: 0x42, name: "ORPHAN.ED" },
			],
		}),
	);
	expect(entries.map((entry) => entry.name)).toEqual(["keep.me", "also.me"]);
});

test("maps flags to attributes", () => {
	const disk = makeDisk({
		entries: [
			{ flags: 0x62, name: "LOCKED.FIL" },
			{ flags: 0x43, name: "OPEN.FIL" },
			{ flags: 0x40, name: "OLD.FIL" },
			{ flags: 0x46, name: "MY.FIL" },
			{ flags: 0x03, name: "HIDDEN.FIL" },
			{ flags: 0x10, name: "SUBDIR" },
		],
	});
	// A file left open for output is skipped in a plain listing, as the
	// DOSes skip it.
	expect(
		list(disk).map((entry) => [entry.name, entry.kind, ...entry.attributes]),
	).toEqual([
		["locked.fil", "file", "ReadOnly"],
		["old.fil", "file", "AtariDos10"],
		["my.fil", "file", "AtariMyDos"],
		["hidden.fil", "file", "AtariDos25"],
		["subdir", "dir"],
	]);
	const all = [
		...openAtariDos(openAtr(disk)).entries(undefined, {
			includeUnlisted: true,
		}),
	];
	expect(all.map((entry) => [entry.name, ...entry.attributes])).toContainEqual([
		"open.fil",
		"OpenForOutput",
	]);
});

test("verbose listing adds deleted entries, still stopping at slot zero", () => {
	const disk = makeDisk({
		entries: [
			{ flags: 0x42, name: "KEEP.ME", sectors: 3, start: 100 },
			{ flags: 0x80, name: "GONE.OLD", sectors: 7, start: 200 },
			{ flags: 0x00, name: "END" },
			{ flags: 0x42, name: "ORPHAN.ED" },
		],
	});
	const fs = openAtariDos(openAtr(disk));
	expect([...fs.entries()].map((e) => e.name)).toEqual(["keep.me"]);
	const all = [...fs.entries(undefined, { includeUnlisted: true })];
	expect(all.map((e) => [e.name, ...e.attributes])).toEqual([
		["keep.me"],
		["gone.old", "Deleted"],
	]);
	// The deleted entry keeps the rest of its directory record.
	expect(all[1]).toMatchObject({ sectors: 7, startSector: 200 });
	// Specs still filter, and readFile still refuses what listing hides.
	expect([...fs.entries("*.old", { includeUnlisted: true })]).toHaveLength(1);
	expect(fs.readFile("gone.old")).toBeNull();
});

test("volume reports the filesystem's own capacity numbers", () => {
	const sd = makeDisk({ formatted: true });
	expect(openAtariDos(openAtr(sd)).volume()).toEqual({
		totalSectors: 707,
		freeSectors: 707,
		details: [],
	});
	// DOS 2.5 splits its accounting, and its own DIR only reports the low
	// half - so the total gets the honest sum plus a note.
	const ed = makeDisk({ sectorCount: 1040, total: 1010, formatted: true });
	const volume = openAtariDos(openAtr(ed), "dos25").volume();
	expect(volume.totalSectors).toBe(1010);
	expect(volume.freeSectors).toBe(707 + 304);
	expect(volume.details[0]).toMatch(/707 below sector 720/);
});

test("fills all eight directory sectors, double density included", () => {
	const names = Array.from({ length: 64 }, (_, i) => `F${i}.DAT`);
	const disk = makeDisk({
		sectorSize: 256,
		entries: names.map((name) => ({ flags: 0x42, name })),
	});
	expect(list(disk)).toHaveLength(64);
	expect(list(disk).at(-1)?.name).toBe("f63.dat");
});

test("toAtariName mangles host names into the native policy", () => {
	expect(toAtariName("game.xex")).toBe("game.xex");
	expect(toAtariName("Some File!.data")).toBe("some_fil.dat");
	expect(toAtariName("a.tar.gz")).toBe("a_tar.gz");
	expect(toAtariName(".profile")).toBe("profile");
	expect(toAtariName("ok@_1.x")).toBe("ok@_1.x");
	expect(toAtariName("café.txt")).toBe("caf_.txt");
});

function freeCount(bytes: Uint8Array): number {
	const vtoc = openAtr(bytes).readSector(360);
	return (vtoc?.[3] ?? 0) | ((vtoc?.[4] ?? 0) << 8);
}

test("writeFile round-trips through readFile", () => {
	const disk = makeDisk({ formatted: true });
	const fs = openAtariDos(openAtr(disk));
	const payload = Uint8Array.from({ length: 300 }, (_, i) => i & 0xff);
	fs.writeFile("test.dat", payload);
	const back = fs.readFile("test.dat");
	expect(back?.diagnostics).toEqual([]);
	expect([...(back?.bytes ?? [])]).toEqual([...payload]);
	const entry = [...fs.entries("test.dat")][0];
	expect(entry).toMatchObject({ sectors: 3, attributes: [] });
	expect(freeCount(disk)).toBe(707 - 3);
});

test("writeFile gives zero-length files a sector", () => {
	const disk = makeDisk({ formatted: true });
	const fs = openAtariDos(openAtr(disk));
	fs.writeFile("empty.dat", new Uint8Array(0));
	expect([...fs.entries("empty.dat")][0]?.sectors).toBe(1);
	expect(fs.readFile("empty.dat")?.bytes).toHaveLength(0);
	expect(freeCount(disk)).toBe(707 - 1);
});

test("writeFile refuses an existing name unless overwriting", () => {
	const disk = makeDisk({ formatted: true });
	const fs = openAtariDos(openAtr(disk));
	fs.writeFile("a.dat", new Uint8Array(300));
	expect(() => fs.writeFile("a.dat", new Uint8Array(1))).toThrow(
		/already exists/,
	);
	fs.writeFile("a.dat", new Uint8Array(1), { overwrite: true });
	expect(fs.readFile("a.dat")?.bytes).toHaveLength(1);
	expect(freeCount(disk)).toBe(707 - 1); // the old three sectors came back
	expect([...fs.entries()]).toHaveLength(1);
});

test("writeFile reports full disks and directories", () => {
	const disk = makeDisk({ formatted: true });
	const fs = openAtariDos(openAtr(disk));
	expect(() => fs.writeFile("big.dat", new Uint8Array(708 * 125))).toThrow(
		/not enough free space/,
	);
	const names = Array.from({ length: 64 }, (_, i) => `F${i}.DAT`);
	const packed = makeDisk({
		formatted: true,
		entries: names.map((name) => ({ flags: 0x42, name })),
	});
	expect(() =>
		openAtariDos(openAtr(packed)).writeFile("one.mor", new Uint8Array(1)),
	).toThrow(/directory is full/);
});

test("writeFile puts DOS 2 files on DOS 1.0 disks by default", () => {
	const dos1 = makeDisk({ code: 1, total: 709, formatted: true });
	const fs = openAtariDos(openAtr(dos1));
	fs.writeFile("a.dat", new Uint8Array(300));
	const entry = [...fs.entries("a.dat")][0];
	expect(entry?.attributes).not.toContain("AtariDos10");
	expect(fs.readFile("a.dat")?.bytes).toHaveLength(300);
});

test("writeFile can write DOS 1.0 format chains", () => {
	const disk = makeDisk({ code: 1, total: 709, formatted: true });
	const image = openAtr(disk);
	const fs = openAtariDos(image, "dos10");
	const payload = Uint8Array.from({ length: 300 }, (_, i) => i & 0xff);
	fs.writeFile("old.dat", payload, { format: "dos1" });

	const entry = [...fs.entries("old.dat")][0];
	expect(entry?.attributes).toContain("AtariDos10");
	expect(entry?.sectors).toBe(3);
	// Real DOS 1.0 leaves the DOS 2 flag clear, flags the last sector with
	// bit 7 plus its byte count, and numbers earlier sectors 0, 1, 2, ...
	const start = entry?.startSector ?? 0;
	const first = image.readSector(start)!;
	const second = image.readSector((first[125]! & 3) * 256 + first[126]!)!;
	expect(first[127]).toBe(0);
	expect(second[127]).toBe(1);
	const third = image.readSector((second[125]! & 3) * 256 + second[126]!)!;
	expect(third[127]).toBe(0x80 | 50); // 300 - 2 * 125
	// ... and it round-trips through the DOS 1 reader.
	const back = fs.readFile("old.dat");
	expect(back?.diagnostics).toEqual([]);
	expect([...(back?.bytes ?? [])]).toEqual([...payload]);
});

test("writeFile marks DOS 2.5 files reaching past sector 719", () => {
	const disk = makeDisk({ sectorCount: 1040, total: 1010, formatted: true });
	const fs = openAtariDos(openAtr(disk));
	expect(fs.variant).toBe("dos25");
	const payload = Uint8Array.from({ length: 708 * 125 }, (_, i) => i & 0xff);
	fs.writeFile("big.dat", payload);
	const entry = [...fs.entries("big.dat")][0];
	expect(entry?.sectors).toBe(708);
	expect(entry?.attributes).toContain("AtariDos25");
	const back = fs.readFile("big.dat");
	expect(back?.diagnostics).toEqual([]);
	expect(back?.bytes).toHaveLength(708 * 125);
	const vtoc2 = openAtr(disk).readSector(1024);
	expect((vtoc2?.[122] ?? 0) | ((vtoc2?.[123] ?? 0) << 8)).toBe(304 - 1);
	expect(freeCount(disk)).toBe(0);
});

test("writeFile silently repairs the stale VTOC2 shared region", () => {
	const disk = makeDisk({ sectorCount: 1040, total: 1010, formatted: true });
	// Simulate DOS 2.0 having written to the disk: VTOC2's copy of the
	// shared bitmap goes stale (here: zeroed).
	const vtoc2At = ATR_HEADER_SIZE + 1023 * 128;
	disk.fill(0, vtoc2At, vtoc2At + 84);
	const fs = openAtariDos(openAtr(disk));
	fs.writeFile("a.dat", new Uint8Array(10));
	const image = openAtr(disk);
	const vtoc = image.readSector(360);
	const vtoc2 = image.readSector(1024);
	expect([...(vtoc2?.subarray(0, 84) ?? [])]).toEqual([
		...(vtoc?.subarray(16, 100) ?? []),
	]);
});

test("deleteFile frees the chain and reuses the slot", () => {
	const disk = makeDisk({ formatted: true });
	const fs = openAtariDos(openAtr(disk));
	fs.writeFile("a.dat", new Uint8Array(300));
	fs.deleteFile("a.dat");
	expect([...fs.entries()]).toHaveLength(0);
	expect(fs.readFile("a.dat")).toBeNull();
	expect(freeCount(disk)).toBe(707);
	// The slot keeps its content under the deleted flag, and gets reused.
	expect(disk[ATR_HEADER_SIZE + 360 * 128]).toBe(0x80);
	fs.writeFile("b.dat", new Uint8Array(1));
	expect([...fs.entries()]).toHaveLength(1);
	expect(disk[ATR_HEADER_SIZE + 360 * 128]).toBe(0x42);
});

test("deleteFile validates the target", () => {
	const disk = makeDisk({
		formatted: true,
		entries: [{ flags: 0x10, name: "SUBDIR" }],
	});
	const fs = openAtariDos(openAtr(disk));
	expect(() => fs.deleteFile("nope.dat")).toThrow(/not found/);
	expect(() => fs.deleteFile("subdir")).toThrow(/is a directory/);
	fs.writeFile("lock.dat", new Uint8Array(10));
	const slotFlags = ATR_HEADER_SIZE + 360 * 128 + 16; // slot 1, sector 361
	disk[slotFlags] = (disk[slotFlags] ?? 0) | 0x20;
	expect(() => fs.deleteFile("lock.dat")).toThrow(/is locked/);
	fs.deleteFile("lock.dat", { force: true });
	expect([...fs.entries("lock.dat")]).toHaveLength(0);
	expect(freeCount(disk)).toBe(707);
});

test("deleteFile restores both DOS 2.5 counters for extended files", () => {
	const disk = makeDisk({ sectorCount: 1040, total: 1010, formatted: true });
	const fs = openAtariDos(openAtr(disk));
	fs.writeFile("big.dat", new Uint8Array(708 * 125));
	fs.deleteFile("big.dat");
	expect(freeCount(disk)).toBe(707);
	const vtoc2 = openAtr(disk).readSector(1024);
	expect((vtoc2?.[122] ?? 0) | ((vtoc2?.[123] ?? 0) << 8)).toBe(304);
});

test("deleteFile works on DOS 1.0 disks", () => {
	const dos1 = makeDisk({
		code: 1,
		total: 709,
		formatted: true,
		entries: [{ flags: 0x40, name: "OLD.DAT", start: 100, sectors: 1 }],
	});
	writeDataSector(dos1, { sector: 100, next: 0, length: 0x80 | 5, fill: 1 });
	const fs = openAtariDos(openAtr(dos1));
	expect(fs.variant).toBe("dos10");
	fs.deleteFile("old.dat");
	expect([...fs.entries()]).toHaveLength(0);
});

test("delete and overwrite report damaged chains and free what they can", () => {
	const disk = makeDisk({ formatted: true });
	const fs = openAtariDos(openAtr(disk));
	fs.writeFile("loop.dat", new Uint8Array(300)); // chain 4 -> 5 -> 6
	// Corrupt the chain: sector 4 links back to itself.
	const sector4 = ATR_HEADER_SIZE + 3 * 128;
	disk[sector4 + 125] = 0;
	disk[sector4 + 126] = 4;
	expect(fs.deleteFile("loop.dat")).toEqual(["sector 4: sector chain loops"]);
	// Only the reachable sector came back; 5 and 6 stay leaked.
	expect(freeCount(disk)).toBe(707 - 2);
	// Overwrite path: a clean write, then the same corruption.
	expect(fs.writeFile("a.dat", new Uint8Array(1))).toEqual([]); // sector 4
	disk[sector4 + 125] = 0;
	disk[sector4 + 126] = 4;
	expect(fs.writeFile("a.dat", new Uint8Array(1), { overwrite: true })).toEqual(
		["sector 4: sector chain loops"],
	);
});

test("splitAtariPath takes every family separator", () => {
	expect(splitAtariPath("games/deep/a.sys")).toEqual([
		"games",
		"deep",
		"a.sys",
	]);
	expect(splitAtariPath("GAMES>DEEP>A.SYS")).toEqual([
		"games",
		"deep",
		"a.sys",
	]);
	expect(splitAtariPath("games:a.sys")).toEqual(["games", "a.sys"]);
	// "." and ".." resolve textually, since no directory records its parent.
	expect(splitAtariPath("/games/./deep/../a.sys")).toEqual(["games", "a.sys"]);
	expect(splitAtariPath("")).toEqual([]);
});

test("SpartaDOS's < separates and steps up at once", () => {
	// foo>bar>qux<file.txt means foo>bar>file.txt.
	expect(splitAtariPath("FOO>BAR>QUX<FILE.TXT")).toEqual([
		"foo",
		"bar",
		"file.txt",
	]);
	// Each further "<" climbs another level.
	expect(splitAtariPath("foo>bar>qux<<file.txt")).toEqual(["foo", "file.txt"]);
	// Climbing past the root just stays there.
	expect(splitAtariPath("foo<<<<file.txt")).toEqual(["file.txt"]);
	// It mixes with the other separators and with "..".
	expect(splitAtariPath("games/deep<../a.sys")).toEqual(["a.sys"]);
});

// A disk with GAMES (holding one file and a nested DEEP) beside a root file.
function makeTree(): Uint8Array {
	const disk = makeDisk({
		formatted: true,
		entries: [
			{ flags: 0x42, name: "ROOT.DAT", start: 100, sectors: 1 },
			{ flags: 0x10, name: "GAMES", start: 300, sectors: 8 },
		],
	});
	writeDataSector(disk, { sector: 100, next: 0, length: 5, fill: 9 });
	const put = (block: number, slot: number, entry: FixtureEntry) => {
		const at = ATR_HEADER_SIZE + (block - 1) * 128 + slot * 16;
		disk[at] = entry.flags;
		disk[at + 1] = entry.sectors ?? 1;
		disk[at + 3] = (entry.start ?? 0) & 0xff;
		disk[at + 4] = (entry.start ?? 0) >> 8;
		const dot = entry.name.indexOf(".");
		const name = dot === -1 ? entry.name : entry.name.slice(0, dot);
		const ext = dot === -1 ? "" : entry.name.slice(dot + 1);
		for (let i = 0; i < 8; i++) {
			disk[at + 5 + i] = name.charCodeAt(i) || 0x20;
		}
		for (let i = 0; i < 3; i++) {
			disk[at + 13 + i] = ext.charCodeAt(i) || 0x20;
		}
	};
	// GAMES at 300: slot 0 a file, slot 1 a nested directory at 310.
	put(300, 0, { flags: 0x42, name: "IN.DAT", start: 200, sectors: 1 });
	put(300, 1, { flags: 0x10, name: "DEEP", start: 310, sectors: 8 });
	put(310, 0, { flags: 0x42, name: "DOWN.DAT", start: 210, sectors: 1 });
	// The file numbers are slot indices within their own directory.
	writeDataSector(disk, { sector: 200, next: 0, length: 7, fill: 1 });
	writeDataSector(disk, { sector: 210, next: 0, length: 3, fill: 2 });
	return disk;
}

test("paths select a directory, and -R walks the tree", () => {
	const fs = openAtariDos(openAtr(makeTree()));
	expect([...fs.entries()].map((e) => e.path)).toEqual(["root.dat", "games"]);
	// Naming a directory lists its contents, like ls does.
	expect([...fs.entries("games")].map((e) => e.path)).toEqual([
		"games/in.dat",
		"games/deep",
	]);
	expect([...fs.entries("games>deep")].map((e) => e.name)).toEqual([
		"down.dat",
	]);
	expect([...fs.entries(undefined, { recursive: true })].map((e) => e.path)) //
		.toEqual([
			"root.dat",
			"games",
			"games/in.dat",
			"games/deep",
			"games/deep/down.dat",
		]);
	// A pattern applies at every level it visits.
	expect(
		[...fs.entries("*.dat", { recursive: true })].map((e) => e.path),
	).toEqual(["root.dat", "games/in.dat", "games/deep/down.dat"]);
});

test("reads and writes reach into subdirectories", () => {
	const disk = makeTree();
	const fs = openAtariDos(openAtr(disk));
	expect(fs.readFile("games/deep/down.dat")?.bytes).toHaveLength(3);
	expect(fs.readFile("games/in.dat")?.diagnostics).toEqual([]);
	expect(fs.readFile("in.dat")).toBeNull(); // not in the root

	// A file written into a subdirectory gets that directory's slot index as
	// its chain file number, which is what MyDOS expects.
	fs.writeFile("games/new.dat", Uint8Array.from([1, 2, 3]));
	const entry = [...fs.entries("games/new.dat")][0];
	expect(entry?.path).toBe("games/new.dat");
	const data = openAtr(disk).readSector(entry?.startSector ?? 0)!;
	expect(data[125]! >> 2).toBe(2); // slot 2 of GAMES, not of the root
	expect(fs.readFile("games/new.dat")?.diagnostics).toEqual([]);

	fs.deleteFile("games/in.dat");
	expect([...fs.entries("games")].map((e) => e.name)).toEqual([
		"deep",
		"new.dat",
	]);
});

test("bad paths say what went wrong", () => {
	const fs = openAtariDos(openAtr(makeTree()));
	expect(() => [...fs.entries("nope/x")]).toThrow(/nope does not exist/);
	expect(() => [...fs.entries("root.dat/x")]).toThrow(/is a file/);
});

test("a directory pointing at itself is caught, not followed", () => {
	const disk = makeTree();
	// Point GAMES's nested DEEP back at GAMES's own block.
	const at = ATR_HEADER_SIZE + 299 * 128 + 16;
	disk[at + 3] = 300 & 0xff;
	disk[at + 4] = 300 >> 8;
	const fs = openAtariDos(openAtr(disk));
	const paths = [...fs.entries(undefined, { recursive: true })].map(
		(e) => e.path,
	);
	expect(paths).toContain("games/deep");
	expect(paths.filter((p) => p.startsWith("games/deep/"))).toEqual([]);
	expect(() => [...fs.entries("games/deep/deep")]).toThrow(/damaged/);
});

test("specs use native wildcard semantics", () => {
	const disk = makeDisk({
		entries: [
			{ flags: 0x42, name: "DOS.SYS" },
			{ flags: 0x42, name: "DUP.SYS" },
			{ flags: 0x42, name: "GAME.COM" },
			{ flags: 0x42, name: "README" },
			{ flags: 0x10, name: "GAMES" },
		],
	});
	const names = (spec: string) => list(disk, spec).map((entry) => entry.name);
	expect(names("*.*")).toEqual([
		"dos.sys",
		"dup.sys",
		"game.com",
		"readme",
		"games",
	]);
	expect(names("*.sys")).toEqual(["dos.sys", "dup.sys"]);
	expect(names("*.SYS")).toEqual(["dos.sys", "dup.sys"]);
	expect(names("d?p.sys")).toEqual(["dup.sys"]);
	expect(names("d?s.sys")).toEqual(["dos.sys"]);
	// "?" matches the space padding, so a short name still matches.
	expect(names("game?.*")).toEqual(["game.com", "games"]);
	// A spec without a "." matches only an empty extension.
	expect(names("*")).toEqual(["readme", "games"]);
	expect(names("dos")).toEqual([]);
	expect(names("readme")).toEqual(["readme"]);
});
