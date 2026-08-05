import { expect, test } from "vitest";
import { detectAtariDos, openAtariDos } from "./atari-dos.ts";
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
	const entries = list(
		makeDisk({
			entries: [
				{ flags: 0x62, name: "LOCKED.FIL" },
				{ flags: 0x43, name: "OPEN.FIL" },
				{ flags: 0x40, name: "OLD.FIL" },
				{ flags: 0x46, name: "MY.FIL" },
				{ flags: 0x03, name: "HIDDEN.FIL" },
				{ flags: 0x10, name: "SUBDIR" },
			],
		}),
	);
	expect(
		entries.map((entry) => [entry.name, entry.kind, ...entry.attributes]),
	).toEqual([
		["locked.fil", "file", "ReadOnly"],
		["open.fil", "file", "OpenForOutput"],
		["old.fil", "file", "AtariDos10"],
		["my.fil", "file", "AtariMyDos"],
		["hidden.fil", "file", "AtariDos25"],
		["subdir", "dir"],
	]);
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
