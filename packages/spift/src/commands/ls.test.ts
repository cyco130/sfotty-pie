import { expect, test } from "vitest";
import type { DirEntry } from "../filesystem.ts";
import { parseLsArgs, renderLong, renderShort, renderStatus } from "./ls.ts";

test("parses image, spec, and flags", () => {
	expect(parseLsArgs(["disk.atr"])).toEqual({
		image: "disk.atr",
		spec: undefined,
		fs: undefined,
		variant: undefined,
		long: false,
		verbose: false,
		recursive: false,
	});
	expect(
		parseLsArgs(["disk.atr", "*.sys", "-l", "-v", "--fs", "ATARI"]),
	).toEqual({
		image: "disk.atr",
		spec: "*.sys",
		fs: "atari",
		variant: undefined,
		long: true,
		verbose: true,
		recursive: false,
	});
});

test("validates the argument list", () => {
	expect(() => parseLsArgs([])).toThrow(/missing IMAGE_FILE/);
	expect(() => parseLsArgs(["a.atr", "b", "c"])).toThrow(/unexpected argument/);
	expect(() => parseLsArgs(["a.atr", "--fs", "cpm"])).toThrow(
		/unknown filesystem/,
	);
});

const ENTRIES: DirEntry[] = [
	{
		name: "dos.sys",
		path: "dos.sys",
		kind: "file",
		sectors: 37,
		startSector: 4,
		attributes: [],
	},
	{
		name: "locked.fil",
		path: "locked.fil",
		kind: "file",
		sectors: 5,
		startSector: 141,
		attributes: ["ReadOnly", "AtariDos25"],
	},
	{
		name: "games",
		path: "games",
		kind: "dir",
		sectors: 8,
		startSector: 400,
		attributes: [],
	},
];

test("short listing is names only", () => {
	expect(renderShort(ENTRIES, false)).toBe("dos.sys\nlocked.fil\ngames\n");
});

test("short listing gives each kind of ghost its own color", () => {
	const ghosts: DirEntry[] = [
		{
			name: "gone.bin",
			path: "gone.bin",
			kind: "file",
			sectors: 1,
			startSector: 9,
			attributes: ["Deleted"],
		},
		{
			name: "half.bin",
			path: "half.bin",
			kind: "file",
			sectors: 1,
			startSector: 10,
			attributes: ["OpenForOutput"],
		},
	];
	expect(renderShort(ghosts, true)).toContain("\x1b[31mgone.bin\x1b[0m");
	expect(renderShort(ghosts, true)).toContain("\x1b[35mhalf.bin\x1b[0m");
	// Nothing is painted without color, and plain files stay unpainted.
	expect(renderShort(ghosts, false)).toBe("gone.bin\nhalf.bin\n");
	expect(renderShort([ENTRIES[0]!], true)).toBe("dos.sys\n");
});

test("long listing justifies columns and shows attributes", () => {
	expect(renderLong(ENTRIES, false)).toBe(
		"dos.sys     37    4\n" +
			"locked.fil   5  141  read-only dos2.5\n" +
			"games        8  400  dir\n",
	);
});

test("status leads with the container, then the filesystem", () => {
	expect(
		renderStatus(
			{ format: "atr", sectorCount: 720, sectorSize: 128 },
			{
				id: "atari/dos20s",
				volume: { totalSectors: 707, freeSectors: 227, details: [] },
			},
			false,
		),
	).toBe("atr  720 sectors x 128 bytes\natari/dos20s  707 sectors, 227 free\n");
});

test("status shows volume labels and family details", () => {
	const status = renderStatus(
		{ format: "atr", sectorCount: 1040, sectorSize: 128 },
		{
			id: "atari/dos25",
			volume: {
				totalSectors: 1010,
				freeSectors: 1011,
				label: "GAMES",
				details: ["707 below sector 720"],
			},
		},
		false,
	);
	expect(status).toContain('atari/dos25  "GAMES"  1010 sectors, 1011 free');
	expect(status).toContain("(707 below sector 720)");
});

test("long listing colors are gated and reset", () => {
	const colored = renderLong(ENTRIES, true);
	// Names carry no directory marker now; color says it on a terminal and
	// the attribute column says it everywhere.
	expect(colored).toContain("\x1b[1;34mgames");
	expect(colored).not.toContain("games/");
	expect(colored).toContain("\x1b[33mread-only\x1b[0m");
	expect(renderLong(ENTRIES, false)).not.toContain("\x1b[");
});
