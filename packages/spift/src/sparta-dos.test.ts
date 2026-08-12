import { expect, test } from "vitest";
import { createBlankAtr, openAtr } from "./atr.ts";
import { detectFilesystem } from "./detect.ts";
import {
	checkSpartaDosGeometry,
	detectSpartaDos,
	formatSpartaDos,
	openSpartaDos,
	readSpartaDosFilePointer,
	writeSpartaDosFilePointer,
} from "./sparta-dos.ts";

// ---------------------------------------------------------------------
// Fixture builder: a deliberately independent reimplementation of the
// on-disk layout (the same code that validated the driver against the 112
// corpus images), so the reader tests do not lean on the writer under
// test. Layout mirrors a real XINIT format: boot 1-3, bitmap at 4, main
// directory map at 5 with its data at 6, files allocated upward from 7.
// ---------------------------------------------------------------------

interface FixtureFile {
	name: string;
	bytes?: Uint8Array;
	flags?: number;
	date?: [number, number, number, number, number, number];
	dir?: FixtureFile[];
	/** Punch a hole: data sector index to replace with 0 (sparse). */
	sparseAt?: number;
}

interface FixtureOptions {
	sectorSize?: 128 | 256;
	sectorCount?: number;
	revision?: number;
	volumeName?: string;
	files?: FixtureFile[];
	/** Point the boot record's DOS file word at this sector map. */
	dosMap?: number;
	lockFlag?: number;
}

const FLAG_IN_USE = 0x08;

function makeSparta(options: FixtureOptions = {}): Uint8Array {
	const {
		sectorSize = 128,
		sectorCount = 720,
		revision = 0x20,
		volumeName = "testdisk",
		files = [],
	} = options;
	const bytes = createBlankAtr({ sectorSize, sectorCount });
	const medium = openAtr(bytes);
	const write = (sector: number, data: Uint8Array): void => {
		if (!medium.writeSector(sector, data)) {
			throw new Error(`fixture write to sector ${sector} failed`);
		}
	};

	const total = sectorCount;
	const bitsPerPage = sectorSize * 8;
	const bitmapCount = Math.ceil((total + 1) / bitsPerPage);
	const bitmapStart = 4;
	const mainDirMap = bitmapStart + bitmapCount;
	const pages: Uint8Array[] = Array.from({ length: bitmapCount }, () =>
		new Uint8Array(sectorSize).fill(0xff),
	);
	const mark = (sector: number): void => {
		const page = pages[Math.floor(sector / bitsPerPage)];
		if (page === undefined) {
			throw new Error(`fixture bitmap has no page for sector ${sector}`);
		}
		const bit = sector % bitsPerPage;
		page[bit >> 3] = (page[bit >> 3] ?? 0) & ~(0x80 >> (bit & 7));
	};
	mark(0);
	for (let s = 1; s <= 3; s++) {
		mark(s);
	}
	for (let s = 0; s < bitmapCount; s++) {
		mark(bitmapStart + s);
	}

	let cursor = mainDirMap;
	const allocate = (): number => {
		const sector = cursor++;
		if (sector > total) {
			throw new Error("fixture disk is full");
		}
		mark(sector);
		return sector;
	};

	const perMap = (sectorSize - 4) / 2;
	/** Writes a mapped file and returns its first map sector. */
	const writeMapped = (contents: Uint8Array, sparseAt?: number): number => {
		const dataCount = Math.ceil(contents.length / sectorSize);
		const mapCount = Math.max(1, Math.ceil(dataCount / perMap));
		const maps = Array.from({ length: mapCount }, allocate);
		const data: number[] = [];
		for (let i = 0; i < dataCount; i++) {
			if (i === sparseAt) {
				data.push(0);
				continue;
			}
			const sector = allocate();
			data.push(sector);
			const chunk = new Uint8Array(sectorSize);
			chunk.set(
				contents.subarray(
					i * sectorSize,
					Math.min((i + 1) * sectorSize, contents.length),
				),
			);
			write(sector, chunk);
		}
		maps.forEach((map, index) => {
			const sector = new Uint8Array(sectorSize);
			const next = maps[index + 1] ?? 0;
			const prev = maps[index - 1] ?? 0;
			sector[0] = next & 0xff;
			sector[1] = next >> 8;
			sector[2] = prev & 0xff;
			sector[3] = prev >> 8;
			data.slice(index * perMap, (index + 1) * perMap).forEach((number, at) => {
				sector[4 + at * 2] = number & 0xff;
				sector[4 + at * 2 + 1] = number >> 8;
			});
			write(map, sector);
		});
		return maps[0] as number;
	};

	const putName = (target: Uint8Array, at: number, name: string): void => {
		const dot = name.indexOf(".");
		const stem = (dot === -1 ? name : name.slice(0, dot)).toUpperCase();
		const ext = (dot === -1 ? "" : name.slice(dot + 1)).toUpperCase();
		for (let i = 0; i < 8; i++) {
			target[at + i] = stem.charCodeAt(i) || 0x20;
		}
		for (let i = 0; i < 3; i++) {
			target[at + 8 + i] = ext.charCodeAt(i) || 0x20;
		}
	};

	/** Builds a directory (recursively) and returns its first map sector. */
	const writeDirectory = (
		name: string,
		parentMap: number,
		children: FixtureFile[],
	): number => {
		// Children first, so their maps exist to be pointed at; sector
		// numbers do not depend on the parent's own placement.
		const placed = children.map((child) => ({
			child,
			firstMap:
				child.dir !== undefined
					? -1 // patched below, after the parent's map is known
					: writeMapped(child.bytes ?? new Uint8Array(0), child.sparseAt),
		}));
		const length = (1 + children.length) * 23;
		const contents = new Uint8Array(length);
		contents[0] = 0x28;
		contents[1] = parentMap & 0xff;
		contents[2] = parentMap >> 8;
		contents[3] = length & 0xff;
		contents[4] = (length >> 8) & 0xff;
		contents[5] = (length >> 16) & 0xff;
		putName(contents, 6, name);
		const map = writeMapped(contents);
		placed.forEach((entry, index) => {
			if (entry.child.dir !== undefined) {
				entry.firstMap = writeDirectory(entry.child.name, map, entry.child.dir);
			}
			const at = (1 + index) * 23;
			const size = entry.child.bytes?.length ?? entry.child.dir!.length;
			contents[at] =
				entry.child.flags ??
				(entry.child.dir !== undefined ? 0x28 : FLAG_IN_USE);
			contents[at + 1] = entry.firstMap & 0xff;
			contents[at + 2] = entry.firstMap >> 8;
			const bytes = entry.child.dir !== undefined ? (1 + size) * 23 : size;
			contents[at + 3] = bytes & 0xff;
			contents[at + 4] = (bytes >> 8) & 0xff;
			contents[at + 5] = (bytes >> 16) & 0xff;
			putName(contents, at + 6, entry.child.name);
			(entry.child.date ?? []).forEach((value, i) => {
				contents[at + 17 + i] = value;
			});
		});
		// Rewrite the directory contents now the entries are filled in.
		const mapped = medium.readSector(map) as Uint8Array;
		const dataSectors: number[] = [];
		for (let at = 4; at + 1 < mapped.length; at += 2) {
			const s = (mapped[at] ?? 0) | ((mapped[at + 1] ?? 0) << 8);
			if (s !== 0) {
				dataSectors.push(s);
			}
		}
		dataSectors.forEach((sector, index) => {
			const chunk = new Uint8Array(sectorSize);
			chunk.set(
				contents.subarray(index * sectorSize, (index + 1) * sectorSize),
			);
			write(sector, chunk);
		});
		return map;
	};

	// The fixture main directory map must land at mainDirMap, which is the
	// next cursor value; writeDirectory's children-first order would move
	// it, so reserve it by building the tree and patching the boot pointer
	// to wherever the root map actually landed.
	const rootMap = writeDirectory("main", 0, files);

	let free = 0;
	for (let s = 1; s <= total; s++) {
		const page = pages[Math.floor(s / bitsPerPage)] as Uint8Array;
		const bit = s % bitsPerPage;
		if (((page[bit >> 3] ?? 0) & (0x80 >> (bit & 7))) !== 0) {
			free++;
		}
	}

	const boot = new Uint8Array(medium.readSector(1)?.length ?? 128);
	boot[0] = 0;
	boot[1] = 3;
	boot.set([0x4c, 0x80, 0x30], 6);
	const word = (at: number, value: number): void => {
		boot[at] = value & 0xff;
		boot[at + 1] = (value >> 8) & 0xff;
	};
	word(0x09, rootMap);
	word(0x0b, total);
	word(0x0d, free);
	boot[0x0f] = bitmapCount;
	word(0x10, bitmapStart);
	word(0x12, cursor);
	word(0x14, cursor);
	for (let i = 0; i < 8; i++) {
		boot[0x16 + i] = volumeName.toUpperCase().charCodeAt(i) || 0x20;
	}
	boot[0x1e] = 40;
	boot[0x1f] = sectorSize === 128 ? 0x80 : 0x00;
	boot[0x20] = revision;
	boot[0x26] = 1;
	boot[0x27] = 123;
	word(0x28, options.dosMap ?? 0);
	boot[0x2a] = options.lockFlag ?? 0;
	write(1, boot);
	pages.forEach((page, index) => {
		write(bitmapStart + index, page);
	});
	return bytes;
}

const text = (value: string): Uint8Array =>
	Uint8Array.from(value, (c) => c.charCodeAt(0));

function open(bytes: Uint8Array, clock?: () => Date) {
	return openSpartaDos(openAtr(bytes), undefined, clock ? { clock } : {});
}

// ---------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------

test("detects the revision as the variant", () => {
	expect(detectSpartaDos(openAtr(makeSparta()))).toBe("sdfs20");
	expect(detectSpartaDos(openAtr(makeSparta({ revision: 0x21 })))).toBe(
		"sdfs21",
	);
	expect(detectSpartaDos(openAtr(makeSparta({ revision: 0x11 })))).toBe(
		"sdfs11",
	);
	expect(detectFilesystem(openAtr(makeSparta()))).toEqual({
		family: "sparta",
		variant: "sdfs20",
	});
});

test("rejects a signature without a parameter block", () => {
	// A boot-only game disk: the JMP is there, the parameters are garbage.
	const bytes = makeSparta();
	bytes[16 + 0x20] = 0x03; // not a known revision
	expect(detectSpartaDos(openAtr(bytes))).toBeUndefined();
	const wrongSize = makeSparta();
	wrongSize[16 + 0x1f] = 0x00; // claims 256-byte sectors on a 128-byte disk
	expect(detectSpartaDos(openAtr(wrongSize))).toBeUndefined();
});

// ---------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------

test("lists files with sizes and timestamps", () => {
	const bytes = makeSparta({
		files: [
			{
				name: "readme.txt",
				bytes: text("hello"),
				date: [11, 12, 95, 14, 57, 44],
			},
			{ name: "sub.dir", dir: [] },
		],
	});
	const entries = [...open(bytes).entries()];
	expect(entries).toHaveLength(2);
	const [readme, sub] = entries;
	expect(readme).toMatchObject({
		name: "readme.txt",
		kind: "file",
		size: 5,
		timestamp: new Date(1995, 11, 11, 14, 57, 44),
	});
	// Subdirectories can carry an extension (seen in the wild).
	expect(sub).toMatchObject({ name: "sub.dir", kind: "dir" });
});

test("windows two-digit and three-digit years", () => {
	const bytes = makeSparta({
		files: [
			{ name: "old", bytes: text("x"), date: [1, 1, 84, 0, 0, 0] },
			{ name: "modern", bytes: text("x"), date: [1, 1, 8, 0, 0, 0] },
			{ name: "epochal", bytes: text("x"), date: [1, 1, 101, 0, 0, 0] },
			{ name: "dateless", bytes: text("x"), date: [0, 0, 0, 0, 0, 0] },
		],
	});
	const years = [...open(bytes).entries()].map((entry) =>
		entry.timestamp?.getFullYear(),
	);
	expect(years).toEqual([1984, 2008, 2001, undefined]);
});

test("reads file contents, exact to the byte", () => {
	const contents = text("a".repeat(300) + "b".repeat(41));
	const bytes = makeSparta({
		files: [{ name: "long.bin", bytes: contents }],
	});
	const file = open(bytes).readFile("long.bin");
	expect(file?.diagnostics).toEqual([]);
	expect(file?.bytes).toEqual(contents);
});

test("sparse stretches read as zeros", () => {
	const contents = text("x".repeat(384));
	const bytes = makeSparta({
		files: [{ name: "holey", bytes: contents, sparseAt: 1 }],
	});
	const file = open(bytes).readFile("holey");
	expect(file?.diagnostics).toEqual([]);
	expect(file?.bytes.subarray(0, 128)).toEqual(contents.subarray(0, 128));
	expect(file?.bytes.subarray(128, 256)).toEqual(new Uint8Array(128));
	expect(file?.bytes.subarray(256)).toEqual(contents.subarray(256));
});

test("resolves subdirectory paths and recursive listings", () => {
	const bytes = makeSparta({
		files: [
			{
				name: "games",
				dir: [
					{ name: "chess.com", bytes: text("mate") },
					{ name: "deep", dir: [{ name: "nested.txt", bytes: text("deep") }] },
				],
			},
		],
	});
	const filesystem = open(bytes);
	expect(filesystem.readFile("games/chess.com")?.bytes).toEqual(text("mate"));
	expect(filesystem.readFile("games>deep>nested.txt")?.bytes).toEqual(
		text("deep"),
	);
	const paths = [...filesystem.entries(undefined, { recursive: true })].map(
		(entry) => entry.path,
	);
	expect(paths).toEqual([
		"games",
		"games/chess.com",
		"games/deep",
		"games/deep/nested.txt",
	]);
	const pattern = [...filesystem.entries("games/*.com")].map(
		(entry) => entry.name,
	);
	expect(pattern).toEqual(["chess.com"]);
});

test("maps flags to attributes and hides what the DOS hides", () => {
	const bytes = makeSparta({
		revision: 0x21,
		files: [
			{ name: "locked", bytes: text("x"), flags: 0x09 },
			{ name: "hidden", bytes: text("x"), flags: 0x0a },
			{ name: "archived", bytes: text("x"), flags: 0x0c },
			{ name: "deleted", bytes: text("x"), flags: 0x10 },
			{ name: "open", bytes: text("x"), flags: 0x88 },
			{ name: "link", bytes: text("target"), flags: 0x48 },
		],
	});
	const filesystem = open(bytes);
	const listed = [...filesystem.entries()];
	// Deleted and open-for-write entries are passed over; hidden ones are
	// deliberately shown (a host tool that lost files on extract would be
	// worse than one that shows a flag the guest hides).
	expect(listed.map((entry) => entry.name)).toEqual([
		"locked",
		"hidden",
		"archived",
		"link",
	]);
	expect(listed[0]?.attributes).toEqual(["ReadOnly"]);
	expect(listed[1]?.attributes).toEqual(["Hidden"]);
	expect(listed[2]?.attributes).toEqual(["Archived"]);
	expect(listed[3]?.attributes).toEqual(["Symlink"]);
	const everything = [
		...filesystem.entries(undefined, {
			includeUnlisted: true,
		}),
	];
	expect(everything.map((entry) => entry.name)).toContain("deleted");
	expect(everything.map((entry) => entry.name)).toContain("open");
	// The symlink's payload comes back raw, with a warning.
	const link = filesystem.readFile("link");
	expect(link?.bytes).toEqual(text("target"));
	expect(link?.diagnostics.join(" ")).toContain("symbolic link");
});

test("reports the volume", () => {
	const bytes = makeSparta({ volumeName: "mydisk" });
	const volume = open(bytes).volume();
	expect(volume.label).toBe("mydisk");
	expect(volume.totalSectors).toBe(720);
	// Fresh fixture: everything free but boot 1-3, the bitmap at 4, and the
	// main directory's map and data sector.
	expect(volume.freeSectors).toBe(720 - 6);
});

test("marks the boot record's DOS file", () => {
	const plain = makeSparta({
		files: [{ name: "x32g.dos", bytes: text("dos") }],
	});
	const map = [...open(plain).entries()][0]?.startSector as number;
	const bytes = makeSparta({
		files: [{ name: "x32g.dos", bytes: text("dos") }],
		dosMap: map,
	});
	expect([...open(bytes).entries()][0]?.attributes).toContain("BootFile");
	expect(readSpartaDosFilePointer(openAtr(bytes))).toBe(map);
});

// ---------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------

const NOON = new Date(2026, 7, 10, 12, 0, 0);

test("writes a file the reader and the accounting agree on", () => {
	const bytes = makeSparta();
	const filesystem = open(bytes, () => NOON);
	const before = filesystem.volume().freeSectors;
	const contents = text("spartan ".repeat(100)); // 800 bytes, 7 sectors
	filesystem.writeFile("new.dat", contents);
	const entry = [...filesystem.entries()].find((e) => e.name === "new.dat");
	expect(entry).toMatchObject({ size: 800, timestamp: NOON });
	expect(filesystem.readFile("new.dat")?.bytes).toEqual(contents);
	// 7 data sectors plus one map.
	expect(filesystem.volume().freeSectors).toBe(before - 8);
	// A fresh open of the mutated bytes sees the same picture.
	const reopened = open(bytes);
	expect(reopened.readFile("new.dat")?.bytes).toEqual(contents);
	expect(reopened.volume().freeSectors).toBe(before - 8);
});

test("spans multiple sector maps when a file needs them", () => {
	// 62 entries fit one 128-byte map; 9000 bytes is 71 sectors.
	const bytes = makeSparta();
	const filesystem = open(bytes);
	const contents = new Uint8Array(9000).map((_, i) => i & 0xff);
	filesystem.writeFile("big.bin", contents);
	expect(open(bytes).readFile("big.bin")?.bytes).toEqual(contents);
});

test("overwrite frees the old sectors and reuses the slot", () => {
	const bytes = makeSparta({
		files: [{ name: "a.txt", bytes: text("old contents here") }],
	});
	const filesystem = open(bytes);
	const before = filesystem.volume().freeSectors;
	expect(() => filesystem.writeFile("a.txt", text("new"))).toThrow(
		/already exists/,
	);
	filesystem.writeFile("a.txt", text("new"), { overwrite: true });
	expect(filesystem.readFile("a.txt")?.bytes).toEqual(text("new"));
	expect(filesystem.volume().freeSectors).toBe(before);
	expect([...filesystem.entries()]).toHaveLength(1);
});

test("removes files and refuses what the flags protect", () => {
	const bytes = makeSparta({
		files: [
			{ name: "goner.txt", bytes: text("x".repeat(200)) },
			{ name: "keeper.txt", bytes: text("y"), flags: 0x09 },
		],
	});
	const filesystem = open(bytes);
	const before = filesystem.volume().freeSectors;
	filesystem.removeFile("goner.txt");
	expect(filesystem.readFile("goner.txt")).toBeNull();
	expect(filesystem.volume().freeSectors).toBe(before + 3);
	expect(() => filesystem.removeFile("keeper.txt")).toThrow(/protected/);
	filesystem.removeFile("keeper.txt", { force: true });
	expect([...filesystem.entries()]).toHaveLength(0);
});

test("reuses deleted slots before growing the directory", () => {
	const bytes = makeSparta({
		files: [
			{ name: "first", bytes: text("1") },
			{ name: "second", bytes: text("2") },
		],
	});
	const filesystem = open(bytes);
	filesystem.removeFile("first");
	filesystem.writeFile("third", text("3"));
	// The directory did not grow: still a header plus two entries.
	const reopened = open(bytes);
	expect([...reopened.entries()].map((e) => e.name)).toEqual([
		"third",
		"second",
	]);
});

test("makes directories that grow, and reports their true length", () => {
	const bytes = makeSparta();
	const filesystem = open(bytes);
	filesystem.makeDirectory("stuff");
	// Five 23-byte entries after the header pass 128 bytes, so the fifth
	// write grows the directory's data. Only the header tracks the length -
	// no DOS maintains the parent entry's copy - and a listing reads it
	// from there.
	for (let i = 0; i < 6; i++) {
		filesystem.writeFile(`stuff/f${i}.dat`, text(`file ${i}`));
	}
	const reopened = open(bytes);
	const names = [...reopened.entries("stuff")].map((e) => e.name);
	expect(names).toEqual([
		"f0.dat",
		"f1.dat",
		"f2.dat",
		"f3.dat",
		"f4.dat",
		"f5.dat",
	]);
	const parentEntry = [
		...reopened.entries(undefined, {
			listContents: false,
		}),
	].find((e) => e.name === "stuff");
	expect(parentEntry?.size).toBe(7 * 23);
});

test("mkdir -p, rmdir, and the emptiness rule", () => {
	const bytes = makeSparta();
	const filesystem = open(bytes);
	filesystem.makeDirectory("a/b/c", { parents: true });
	filesystem.writeFile("a/b/c/x.txt", text("x"));
	expect(() => filesystem.removeDirectory("a/b/c")).toThrow(/not empty/);
	filesystem.removeFile("a/b/c/x.txt");
	const free = filesystem.volume().freeSectors;
	filesystem.removeDirectory("a/b/c");
	expect(filesystem.volume().freeSectors).toBe(free + 2);
	expect([...filesystem.entries("a/b")]).toEqual([]);
});

test("renames in place and moves across directories", () => {
	const bytes = makeSparta({
		files: [
			{ name: "orig.txt", bytes: text("data") },
			{ name: "sub", dir: [] },
		],
	});
	const filesystem = open(bytes);
	filesystem.moveFile("orig.txt", "renamed.txt");
	expect(filesystem.readFile("renamed.txt")?.bytes).toEqual(text("data"));
	filesystem.moveFile("renamed.txt", "sub/moved.txt");
	expect(filesystem.readFile("sub/moved.txt")?.bytes).toEqual(text("data"));
	expect(filesystem.readFile("renamed.txt")).toBeNull();
	// A directory cannot move into its own subtree.
	filesystem.makeDirectory("sub/inner");
	expect(() => filesystem.moveFile("sub", "sub/inner/sub")).toThrow(/subtree/);
});

test("moving a directory re-parents it", () => {
	const bytes = makeSparta({
		files: [
			{ name: "from", dir: [{ name: "cargo.txt", bytes: text("cargo") }] },
			{ name: "to", dir: [] },
		],
	});
	const filesystem = open(bytes);
	filesystem.moveFile("from", "to/from");
	const reopened = open(bytes);
	expect(reopened.readFile("to/from/cargo.txt")?.bytes).toEqual(text("cargo"));
	// Growing the moved directory keeps its header - the length a listing
	// reads - current under the new parent.
	for (let i = 0; i < 6; i++) {
		reopened.writeFile(`to/from/g${i}.dat`, text("g"));
	}
	const parentEntry = [
		...open(bytes).entries("to", {
			listContents: true,
		}),
	].find((e) => e.name === "from");
	expect(parentEntry?.size).toBe(8 * 23);
});

test("sets and clears the flag attributes", () => {
	const bytes = makeSparta({
		revision: 0x21,
		files: [{ name: "f.txt", bytes: text("x") }],
	});
	const filesystem = open(bytes);
	filesystem.setAttributes("f.txt", ["ReadOnly", "Hidden", "Archived"]);
	expect([...filesystem.entries()][0]?.attributes).toEqual([
		"ReadOnly",
		"Hidden",
		"Archived",
	]);
	filesystem.setAttributes("f.txt", []);
	expect([...filesystem.entries()][0]?.attributes).toEqual([]);
});

test("every flag rides any revision, symlink included, silently", () => {
	// The flag byte is the same at every revision, so hidden, archived, and
	// the symlink bit all ride a 2.0 or 1.1 disk and a 2.1 reader honours
	// them - no warning, the way a MyDOS subdirectory is simply invisible to
	// plain DOS 2.0.
	const bytes = makeSparta({
		revision: 0x20,
		files: [{ name: "f.txt", bytes: text("x") }],
	});
	const filesystem = open(bytes);
	expect(filesystem.writableAttributes).toEqual([
		"ReadOnly",
		"Hidden",
		"Archived",
		"Symlink",
	]);
	expect(
		filesystem.setAttributes("f.txt", ["Hidden", "Archived", "Symlink"]),
	).toEqual([]);
	expect([...filesystem.entries()][0]?.attributes).toEqual([
		"Hidden",
		"Archived",
		"Symlink",
	]);
});

test("the sequence bumps once per session; hints follow allocation", () => {
	const bytes = makeSparta();
	const filesystem = open(bytes);
	const bootAt = (offset: number): number => bytes[16 + offset] as number;
	const sequenceBefore = bootAt(0x26);
	const fileAllocBefore = bootAt(0x12) | (bootAt(0x13) << 8);
	filesystem.writeFile("f.dat", text("x".repeat(400)));
	expect(bootAt(0x26)).toBe(sequenceBefore + 1);
	const fileAllocAfter = bootAt(0x12) | (bootAt(0x13) << 8);
	expect(fileAllocAfter).toBeGreaterThan(fileAllocBefore);
	// One bump marks the whole session; further mutations stay quiet, and
	// a fresh open bumps again.
	filesystem.writeFile("g.dat", text("y"));
	expect(bootAt(0x26)).toBe(sequenceBefore + 1);
	open(bytes).writeFile("h.dat", text("z"));
	expect(bootAt(0x26)).toBe(sequenceBefore + 2);
	// The random volume id never changes after format.
	expect(bootAt(0x27)).toBe(123);
});

test("deleting lowers the allocation hint to the freed sector", () => {
	// Measured on SDX 4.50: DEL lowers fileAlloc to the freed sector, and
	// DELDIR does the same for dirAlloc.
	const bytes = makeSparta();
	const filesystem = open(bytes);
	const word = (at: number): number =>
		(bytes[16 + at] as number) | ((bytes[16 + at + 1] as number) << 8);
	filesystem.writeFile("a.dat", text("aa"));
	filesystem.writeFile("b.dat", text("bb"));
	const aMap = [...filesystem.entries()][0]?.startSector as number;
	expect(word(0x12)).toBeGreaterThan(aMap);
	filesystem.removeFile("a.dat");
	expect(word(0x12)).toBe(aMap);
	filesystem.makeDirectory("sub");
	const subMap = [...filesystem.entries("sub", { listContents: false })][0]
		?.startSector as number;
	filesystem.removeDirectory("sub");
	expect(word(0x14)).toBe(subMap);
});

test("respects the SDFS 2.0 lock flag", () => {
	const bytes = makeSparta({ lockFlag: 0xff });
	const filesystem = open(bytes);
	expect(filesystem.volume().details).toContain("write-protected");
	expect(() => filesystem.writeFile("f.dat", text("x"))).toThrow(
		/write-protected/,
	);
});

test("sets the boot record's DOS file pointer", () => {
	const bytes = makeSparta({
		files: [{ name: "xbw130.dos", bytes: text("dos") }],
	});
	const medium = openAtr(bytes);
	const map = [...openSpartaDos(medium).entries()][0]?.startSector as number;
	writeSpartaDosFilePointer(medium, map);
	expect(readSpartaDosFilePointer(medium)).toBe(map);
	expect([...openSpartaDos(medium).entries()][0]?.attributes).toContain(
		"BootFile",
	);
});

// ---------------------------------------------------------------------
// Formatting - golden values measured from SDX 4.50 FORMAT output
// (six geometries, byte-for-byte identical, 2026-08-10)
// ---------------------------------------------------------------------

test("formats the SDX golden layout", () => {
	const bytes = createBlankAtr({ sectorSize: 128, sectorCount: 720 });
	const medium = openAtr(bytes);
	const result = formatSpartaDos(medium, "sdfs21", {
		random: 99,
		clock: () => NOON,
		volumeName: "work",
	});
	expect(result).toMatchObject({ totalSectors: 720, freeSectors: 714 });
	const boot = medium.readSector(1) as Uint8Array;
	// The parameter block, exactly as SDX 4.50 writes it: directory map 5,
	// 720 total / 714 free, bitmap 1 sector at 4, allocation hints at
	// dirMap+32 and dirMap+2, 40 tracks, 128-byte code, revision $21 with
	// its size and entries-per-map fields, sequence 0.
	expect(Array.from(boot.subarray(0x09, 0x2b))).toEqual([
		5, 0, 0xd0, 2, 0xca, 2, 1, 4, 0, 37, 0, 7, 0, 0x57, 0x4f, 0x52, 0x4b, 0x20,
		0x20, 0x20, 0x20, 40, 0x80, 0x21, 128, 0, 62, 0, 1, 0, 99, 0, 0, 0,
	]);
	// The main directory: a map at 5 listing sector 6, whose header names
	// the root MAIN and stamps the format time.
	const map = medium.readSector(5) as Uint8Array;
	expect(Array.from(map.subarray(0, 6))).toEqual([0, 0, 0, 0, 6, 0]);
	const header = medium.readSector(6) as Uint8Array;
	expect(Array.from(header.subarray(0, 6))).toEqual([0x28, 0, 0, 23, 0, 0]);
	expect(String.fromCharCode(...header.subarray(6, 17))).toBe("MAIN       ");
	expect(Array.from(header.subarray(17, 23))).toEqual([10, 8, 26, 12, 0, 0]);
	// It opens, reads empty, and takes a write.
	const filesystem = open(bytes);
	expect(filesystem.variant).toBe("sdfs21");
	expect(filesystem.volume()).toMatchObject({
		totalSectors: 720,
		freeSectors: 714,
		label: "work",
	});
	expect([...filesystem.entries()]).toEqual([]);
	filesystem.writeFile("hello.txt", text("hi"));
	expect(open(bytes).readFile("hello.txt")?.bytes).toEqual(text("hi"));
});

test("formats the 512-byte single-boot-sector layout", () => {
	const bytes = createBlankAtr({ sectorSize: 512, sectorCount: 2048 });
	const medium = openAtr(bytes);
	const result = formatSpartaDos(medium, "sdfs21", { random: 1 });
	// One boot sector, bitmap at 2, so with 1 bitmap sector the directory
	// map lands at 3 and its data at 4.
	const boot = medium.readSector(1) as Uint8Array;
	expect(boot).toHaveLength(512);
	expect(Array.from(boot.subarray(6, 9))).toEqual([0x4c, 0x40, 0x04]);
	expect(boot[0x0f]).toBe(1);
	expect(boot[0x10]).toBe(2);
	expect(boot[0x09]).toBe(3);
	expect(boot[0x1f]).toBe(0x01);
	expect(result.freeSectors).toBe(2048 - 4);
	expect(detectSpartaDos(medium)).toBe("sdfs21");
});

test("sdfs20 writes the older revision byte and its era's constant", () => {
	const bytes = createBlankAtr({ sectorSize: 128, sectorCount: 720 });
	const medium = openAtr(bytes);
	formatSpartaDos(medium, "sdfs20", { random: 1 });
	const boot = medium.readSector(1) as Uint8Array;
	expect(boot[0x20]).toBe(0x20);
	// Not the 2.1 self-description fields, but the constant every rev-$20
	// formatter writes at $21-$25 (measured: XINIT, BW-DOS, SD 2.3b).
	expect(Array.from(boot.subarray(0x21, 0x26))).toEqual([
		0x06, 0x01, 0xff, 0xff, 0x00,
	]);
	expect(detectSpartaDos(medium)).toBe("sdfs20");
});

test("refuses what cannot be formatted", () => {
	expect(checkSpartaDosGeometry("sdfs11", 128, 720)).toMatch(/1\.1/);
	expect(checkSpartaDosGeometry("sdfs21", 64, 720)).toMatch(/sectors/);
	expect(checkSpartaDosGeometry("sdfs21", 128, 4)).toMatch(/cannot hold/);
	// 512-byte sectors are a 2.1-only feature; the older revision refuses.
	expect(checkSpartaDosGeometry("sdfs20", 512, 2048)).toMatch(/2\.1/);
	expect(checkSpartaDosGeometry("sdfs21", 512, 2048)).toBeUndefined();
	expect(checkSpartaDosGeometry("sdfs21", 128, 720)).toBeUndefined();
	const medium = openAtr(createBlankAtr({ sectorSize: 128, sectorCount: 720 }));
	expect(() =>
		formatSpartaDos(medium, "sdfs21", { bootSectors: new Uint8Array(128) }),
	).toThrow(/384/);
	expect(() =>
		formatSpartaDos(medium, "sdfs21", { volumeName: "morethan8char" }),
	).toThrow(/8-character/);
});

test("a directory's header mirrors its entry: name, extension, timestamp", () => {
	// The header's name field is 11 bytes like any entry's - a directory
	// can carry an extension (SPARTA.DOS exists in the wild), and every
	// wild subdirectory keeps header and entry identical there.
	const bytes = makeSparta();
	const medium = openAtr(bytes);
	const filesystem = openSpartaDos(medium, undefined, { clock: () => NOON });
	filesystem.makeDirectory("sub.dir");
	const headerOf = (name: string): Uint8Array => {
		const entry = [
			...openSpartaDos(medium).entries(name, { listContents: false }),
		][0];
		const map = medium.readSector(entry?.startSector ?? 0) as Uint8Array;
		const data = (map[4] ?? 0) | ((map[5] ?? 0) << 8);
		return (medium.readSector(data) as Uint8Array).subarray(0, 23);
	};
	const made = headerOf("sub.dir");
	expect(String.fromCharCode(...made.subarray(6, 17))).toBe("SUB     DIR");
	expect(Array.from(made.subarray(17, 23))).toEqual([10, 8, 26, 12, 0, 0]);
	// Renaming in place and moving both keep the header in step.
	filesystem.moveFile("sub.dir", "other.ext");
	expect(String.fromCharCode(...headerOf("other.ext").subarray(6, 17))).toBe(
		"OTHER   EXT",
	);
	filesystem.makeDirectory("home");
	filesystem.moveFile("other.ext", "home/final.dir");
	const final = headerOf("home/final.dir");
	expect(String.fromCharCode(...final.subarray(6, 17))).toBe("FINAL   DIR");
});

test("a rolled-over date is invalid, not a different date", () => {
	// Every field of February 30th passes its own range check, and the JS
	// Date constructor would quietly turn it into March; the decoder must
	// drop it like any other invalid timestamp.
	const bytes = makeSparta({
		files: [
			{ name: "impossible", bytes: text("x"), date: [30, 2, 95, 1, 2, 3] },
			{ name: "leapless", bytes: text("x"), date: [29, 2, 95, 1, 2, 3] },
			{ name: "leapful", bytes: text("x"), date: [29, 2, 96, 1, 2, 3] },
		],
	});
	const stamps = [...open(bytes).entries()].map((entry) => entry.timestamp);
	expect(stamps[0]).toBeUndefined();
	expect(stamps[1]).toBeUndefined(); // 1995 was no leap year
	expect(stamps[2]).toEqual(new Date(1996, 1, 29, 1, 2, 3));
});

test("writeFile takes a timestamp instead of stamping now", () => {
	const bytes = makeSparta();
	const then = new Date(1995, 11, 17, 14, 57, 44);
	const filesystem = open(bytes, () => NOON);
	filesystem.writeFile("dated.txt", text("x"), { timestamp: then });
	filesystem.makeDirectory("dated.dir", { timestamp: then });
	const stamps = new Map(
		[...open(bytes).entries()].map((entry) => [entry.name, entry.timestamp]),
	);
	expect(stamps.get("dated.txt")).toEqual(then);
	expect(stamps.get("dated.dir")).toEqual(then);
});

test("symlinks survive the trip and can be repaired, like FIXLINK", () => {
	// The payload is the target path in ATASCII, EOL-terminated (SDX
	// Toolkit, SYMLINK.MAN); the flag bit is what a symlink-blind copy
	// loses, so the driver lets it be written and set back.
	const payload = Uint8Array.from([...text("C:>CONFIG.SYS"), 0x9b]);
	const bytes = makeSparta({ revision: 0x21 });
	const filesystem = open(bytes);
	filesystem.writeFile("config.sys", payload, { attributes: ["Symlink"] });
	const entry = [...open(bytes).entries()][0];
	expect(entry?.attributes).toEqual(["Symlink"]);
	const read = open(bytes).readFile("config.sys");
	expect(read?.bytes).toEqual(payload);
	expect(read?.diagnostics.join(" ")).toContain(
		"symbolic link to C:>CONFIG.SYS",
	);
	// Losing the bit leaves a small text file; setting it back is FIXLINK.
	filesystem.setAttributes("config.sys", []);
	expect([...open(bytes).entries()][0]?.attributes).toEqual([]);
	filesystem.setAttributes("config.sys", ["Symlink"]);
	expect([...open(bytes).entries()][0]?.attributes).toEqual(["Symlink"]);
});

test("SpartaDOS 1.1 disks have no sequence number to bump", () => {
	// 1.1 predates the volume identity bytes; a writer that "maintained"
	// them there would be scribbling on whatever 1.1 keeps in those
	// locations.
	const bytes = makeSparta({ revision: 0x11 });
	const before = [bytes[16 + 0x26], bytes[16 + 0x27]];
	const filesystem = open(bytes);
	filesystem.writeFile("f.dat", text("x"));
	filesystem.removeFile("f.dat");
	expect([bytes[16 + 0x26], bytes[16 + 0x27]]).toEqual(before);
	// The revisions that have them still bump once per mutation.
	const modern = makeSparta({ revision: 0x20 });
	const seqBefore = modern[16 + 0x26] ?? 0;
	open(modern).writeFile("f.dat", text("x"));
	expect(modern[16 + 0x26]).toBe((seqBefore + 1) & 0xff);
});

test("SpartaDOS 1.1 has no DOS-file pointer to read or write", () => {
	// Its boot code loads contiguous sectors from sector 4 (boot byte $25
	// counts them) and keeps its own data at $28-$29; writing there bricks
	// the disk (measured on the 1.1 HS distribution image).
	const bytes = makeSparta({ revision: 0x11, dosMap: 6433 });
	const medium = openAtr(bytes);
	expect(readSpartaDosFilePointer(medium)).toBe(0);
	expect(() => writeSpartaDosFilePointer(medium, 100)).toThrow(
		/XINIT|sector 4|boot-code/,
	);
});

test("the last disk sector: reserved on sdfs20, reclaimed on sdfs21", () => {
	// The pre-2.1 formatters (XINIT, BW-DOS) mark the last sector used and
	// leave it unused; SDX 4.50's FORMAT reclaims it (its "Optimize"
	// option), giving one more free sector. Keyed on the revision.
	const lastFree = (bytes: Uint8Array, total: number): boolean => {
		const medium = openAtr(bytes);
		const boot = medium.readSector(1) as Uint8Array;
		const bitmapStart = (boot[0x10] ?? 0) | ((boot[0x11] ?? 0) << 8);
		const bitsPer = medium.sectorSize * 8;
		const page = medium.readSector(
			bitmapStart + Math.floor(total / bitsPer),
		) as Uint8Array;
		const bit = total % bitsPer;
		return ((page[bit >> 3] ?? 0) & (0x80 >> (bit & 7))) !== 0;
	};
	const legacy = createBlankAtr({ sectorSize: 128, sectorCount: 720 });
	const legacyResult = formatSpartaDos(openAtr(legacy), "sdfs20", {
		random: 1,
	});
	expect(legacyResult.freeSectors).toBe(713);
	expect(lastFree(legacy, 720)).toBe(false);
	// And it carries the universal rev-$20 constant at $21-$25.
	expect(
		Array.from(openAtr(legacy).readSector(1)!.subarray(0x21, 0x26)),
	).toEqual([0x06, 0x01, 0xff, 0xff, 0x00]);

	const optimized = createBlankAtr({ sectorSize: 128, sectorCount: 720 });
	const optimizedResult = formatSpartaDos(openAtr(optimized), "sdfs21", {
		random: 1,
	});
	expect(optimizedResult.freeSectors).toBe(714);
	expect(lastFree(optimized, 720)).toBe(true);

	// The reclaim is its own switch, defaulting to the revision but not tied
	// to it - so an SDFS 2.1 disk can reserve (RealDOS's way) and a 2.0 disk
	// can reclaim.
	const reserved21 = createBlankAtr({ sectorSize: 128, sectorCount: 720 });
	expect(
		formatSpartaDos(openAtr(reserved21), "sdfs21", {
			random: 1,
			reclaimLastSector: false,
		}).freeSectors,
	).toBe(713);
	expect(lastFree(reserved21, 720)).toBe(false);
	const reclaimed20 = createBlankAtr({ sectorSize: 128, sectorCount: 720 });
	expect(
		formatSpartaDos(openAtr(reclaimed20), "sdfs20", {
			random: 1,
			reclaimLastSector: true,
		}).freeSectors,
	).toBe(714);
	expect(lastFree(reclaimed20, 720)).toBe(true);
});

test("a no-DOS SpartaDOS 1.1 disk (zero revision byte) reads as 2.0", () => {
	// SD 1.1 FORMAT with "Write SpartaDOS? N" writes a zero revision byte
	// over a modern front-bitmap layout, so it reads exactly as a 2.0
	// disk. The parameter-block validation still guards against garbage.
	const bytes = makeSparta({ revision: 0x00, volumeName: "nodos" });
	expect(detectSpartaDos(openAtr(bytes))).toBe("sdfs20");
	const filesystem = open(bytes);
	expect(filesystem.variant).toBe("sdfs20");
	expect(filesystem.volume().label).toBe("nodos");
	// A zero revision over a garbage parameter block is still rejected.
	const garbage = createBlankAtr({ sectorSize: 128, sectorCount: 720 });
	garbage.set([0x4c, 0x80, 0x30], 16 + 6);
	expect(detectSpartaDos(openAtr(garbage))).toBeUndefined();
});
