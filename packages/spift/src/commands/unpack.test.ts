import { expect, test } from "vitest";
import { parseUnpackArgs } from "./unpack.ts";

test("parses the image, the directory, and the flags", () => {
	expect(parseUnpackArgs(["-i", "disk.atr"])).toEqual({
		image: "disk.atr",
		directory: ".",
		fs: undefined,
		variant: undefined,
		extractBootSectors: false,
		force: false,
		noTimestamps: false,
		text: [],
		eol: "lf",
	});
	expect(
		parseUnpackArgs([
			"-i",
			"d.atr",
			"out",
			"--extract-boot-sectors",
			"-f",
			"--fs",
			"atari/mydos",
		]),
	).toMatchObject({
		directory: "out",
		extractBootSectors: true,
		force: true,
		variant: "mydos",
	});
});

test("validates the argument list", () => {
	expect(() => parseUnpackArgs([])).toThrow(/missing --image/);
	expect(() => parseUnpackArgs(["-i", "d.atr", "a", "b"])).toThrow(
		/unexpected argument/,
	);
	expect(() => parseUnpackArgs(["-i", "d.atr", "--fs", "fat"])).toThrow(
		/wants a filesystem/,
	);
});

test("--text takes the pattern, since unpack has no spec of its own", () => {
	expect(parseUnpackArgs(["-i", "d.atr", "--text", "*.txt"]).text).toEqual([
		"*.txt",
	]);
	// Repeatable: a disk holds more than one kind of text file, and keeping
	// only the last would leave the rest as bytes without saying so.
	expect(
		parseUnpackArgs(["-i", "d.atr", "--text", "*.txt", "--text", "*.lst"]).text,
	).toEqual(["*.txt", "*.lst"]);
	// A value is required: a bare --text over a whole disk would recode the
	// binaries on it too.
	expect(() => parseUnpackArgs(["-i", "d.atr", "--text"])).toThrow();
});
