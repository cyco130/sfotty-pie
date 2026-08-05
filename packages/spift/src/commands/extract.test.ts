import { expect, test } from "vitest";
import { parseExtractArgs } from "./extract.ts";

test("parses image, spec, and options", () => {
	expect(parseExtractArgs(["disk.atr"])).toEqual({
		image: "disk.atr",
		spec: undefined,
		out: ".",
		fs: undefined,
		force: false,
	});
	expect(
		parseExtractArgs(["disk.atr", "*.com", "-o", "out", "-f", "--fs", "atari"]),
	).toEqual({
		image: "disk.atr",
		spec: "*.com",
		out: "out",
		fs: "atari",
		force: true,
	});
});

test("validates the argument list", () => {
	expect(() => parseExtractArgs([])).toThrow(/missing IMAGE_FILE/);
	expect(() => parseExtractArgs(["a.atr", "b", "c"])).toThrow(
		/unexpected argument/,
	);
	expect(() => parseExtractArgs(["a.atr", "--fs", "fat"])).toThrow(
		/invalid --fs/,
	);
});
