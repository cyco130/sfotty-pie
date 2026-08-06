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
		kind: "file",
		sectors: 37,
		startSector: 4,
		attributes: [],
	},
	{
		name: "locked.fil",
		kind: "file",
		sectors: 5,
		startSector: 141,
		attributes: ["ReadOnly", "AtariDos25"],
	},
	{
		name: "games",
		kind: "dir",
		sectors: 8,
		startSector: 400,
		attributes: [],
	},
];

test("short listing is names only, dirs slashed", () => {
	expect(renderShort(ENTRIES, false)).toBe("dos.sys\nlocked.fil\ngames/\n");
});

test("short listing paints deleted and half-written names red", () => {
	const ghosts: DirEntry[] = [
		{
			name: "gone.bin",
			kind: "file",
			sectors: 1,
			startSector: 9,
			attributes: ["Deleted"],
		},
		{
			name: "half.bin",
			kind: "file",
			sectors: 1,
			startSector: 10,
			attributes: ["OpenForOutput"],
		},
	];
	expect(renderShort([...ENTRIES, ...ghosts], true)).toContain(
		"\x1b[31mgone.bin\x1b[0m",
	);
	expect(renderShort(ghosts, true)).toContain("\x1b[31mhalf.bin\x1b[0m");
	// Ordinary entries stay unpainted, and nothing is painted without color.
	expect(renderShort(ENTRIES, true)).not.toContain("\x1b[");
	expect(renderShort(ghosts, false)).toBe("gone.bin\nhalf.bin\n");
});

test("long listing justifies columns and shows attributes", () => {
	expect(renderLong(ENTRIES, false)).toBe(
		"dos.sys     37    4\n" +
			"locked.fil   5  141  read-only dos2.5\n" +
			"games/       8  400\n",
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
	expect(colored).toContain("\x1b[1;34mgames/");
	expect(colored).toContain("\x1b[33mread-only\x1b[0m");
	expect(renderLong(ENTRIES, false)).not.toContain("\x1b[");
});
