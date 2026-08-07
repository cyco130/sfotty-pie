import { expect, test } from "vitest";
import { parseExtractArgs } from "./extract.ts";

test("parses image, spec, and options", () => {
	expect(parseExtractArgs(["-i", "disk.atr"])).toEqual({
		image: "disk.atr",
		spec: undefined,
		out: ".",
		recursive: false,
		fs: undefined,
		variant: undefined,
		force: false,
	});
	expect(
		parseExtractArgs([
			"-i",
			"disk.atr",
			"*.com",
			"-o",
			"out",
			"-f",
			"--fs",
			"atari",
		]),
	).toEqual({
		image: "disk.atr",
		spec: "*.com",
		out: "out",
		recursive: false,
		fs: "atari",
		variant: undefined,
		force: true,
	});
});

test("validates the argument list", () => {
	expect(() => parseExtractArgs([])).toThrow(/missing --image/);
	expect(() => parseExtractArgs(["-i", "a.atr", "b", "c"])).toThrow(
		/unexpected argument/,
	);
	expect(() => parseExtractArgs(["-i", "a.atr", "--fs", "fat"])).toThrow(
		/unknown filesystem/,
	);
});
