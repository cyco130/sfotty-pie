import { expect, test } from "vitest";
import type { DirEntry } from "../filesystem.ts";
import { parseLsArgs, renderLong, renderShort } from "./ls.ts";

test("parses image, spec, and flags", () => {
	expect(parseLsArgs(["disk.atr"])).toEqual({
		image: "disk.atr",
		spec: undefined,
		fs: undefined,
		variant: undefined,
		long: false,
	});
	expect(parseLsArgs(["disk.atr", "*.sys", "-l", "--fs", "ATARI"])).toEqual({
		image: "disk.atr",
		spec: "*.sys",
		fs: "atari",
		variant: undefined,
		long: true,
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
	expect(renderShort(ENTRIES)).toBe("dos.sys\nlocked.fil\ngames/\n");
});

test("long listing justifies columns and shows attributes", () => {
	expect(renderLong(ENTRIES, false)).toBe(
		"dos.sys     37    4\n" +
			"locked.fil   5  141  read-only dos2.5\n" +
			"games/       8  400\n",
	);
});

test("long listing colors are gated and reset", () => {
	const colored = renderLong(ENTRIES, true);
	expect(colored).toContain("\x1b[1;34mgames/");
	expect(colored).toContain("\x1b[33mread-only\x1b[0m");
	expect(renderLong(ENTRIES, false)).not.toContain("\x1b[");
});
