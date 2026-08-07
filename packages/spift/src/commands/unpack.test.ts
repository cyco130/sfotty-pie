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
	});
	expect(
		parseUnpackArgs([
			"-i",
			"d.atr",
			"out",
			"--extract-boot-sectors",
			"-f",
			"--fs",
			"mydos",
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
		/unknown filesystem/,
	);
});
