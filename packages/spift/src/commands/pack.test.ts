import { expect, test } from "vitest";
import { parsePackArgs } from "./pack.ts";

test("parses the image, the directory, and the geometry", () => {
	expect(parsePackArgs(["-i", "disk.atr"])).toEqual({
		image: "disk.atr",
		directory: ".",
		variant: undefined,
		sectorSize: 128,
		sectorCount: 720,
		writeBootSectors: false,
		setDosFile: undefined,
		force: false,
		text: [],
		strict: false,
	});
	expect(parsePackArgs(["-i", "d.atr", "stuff", "--dd"])).toMatchObject({
		directory: "stuff",
		sectorSize: 256,
		sectorCount: 720,
	});
	expect(
		parsePackArgs(["-i", "d.atr", "--fs", "mydos", "--sector-count", "1440"]),
	).toMatchObject({ variant: "mydos", sectorCount: 1440 });
});

test("--set-dos-file needs boot code to point at", () => {
	expect(() =>
		parsePackArgs(["-i", "d.atr", "--set-dos-file", "dos.sys"]),
	).toThrow(/needs --write-boot-sectors/);
	expect(
		parsePackArgs([
			"-i",
			"d.atr",
			"--set-dos-file",
			"dos.sys",
			"--write-boot-sectors",
		]),
	).toMatchObject({ setDosFile: "dos.sys", writeBootSectors: true });
});

test("validates the argument list", () => {
	expect(() => parsePackArgs([])).toThrow(/missing --image/);
	expect(() => parsePackArgs(["-i", "d.atr", "a", "b"])).toThrow(
		/unexpected argument/,
	);
	expect(() => parsePackArgs(["-i", "d.atr", "--sd", "--dd"])).toThrow(
		/mutually exclusive/,
	);
	expect(() =>
		parsePackArgs(["-i", "d.atr", "--ed", "--sector-size", "256"]),
	).toThrow(/cannot be combined/);
	expect(() => parsePackArgs(["-i", "d.atr", "--sector-size", "100"])).toThrow(
		/invalid --sector-size/,
	);
});

test("--text takes the pattern, since pack has no spec of its own", () => {
	expect(parsePackArgs(["-i", "d.atr", "--text", "*.txt"]).text).toEqual([
		"*.txt",
	]);
	expect(
		parsePackArgs(["-i", "d.atr", "--text", "*.txt", "--text", "*.md"]).text,
	).toEqual(["*.txt", "*.md"]);
	expect(() => parsePackArgs(["-i", "d.atr", "--text"])).toThrow();
});
