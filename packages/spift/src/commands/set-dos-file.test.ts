import { expect, test } from "vitest";
import { parseSetDosFileArgs } from "./set-dos-file.ts";

test("parses the image, an optional name, and options", () => {
	expect(parseSetDosFileArgs(["-i", "disk.atr"])).toEqual({
		image: "disk.atr",
		name: undefined,
		fs: undefined,
		variant: undefined,
		clear: false,
	});
	expect(parseSetDosFileArgs(["-i", "disk.atr", "mydos.sys"]).name).toBe(
		"mydos.sys",
	);
	expect(parseSetDosFileArgs(["-i", "disk.atr", "--clear"]).clear).toBe(true);
	expect(
		parseSetDosFileArgs(["-i", "disk.atr", "--fs", "atari/dos10"]).variant,
	).toBe("dos10");
});

test("validates the argument list", () => {
	expect(() => parseSetDosFileArgs([])).toThrow(/missing --image/);
	expect(() => parseSetDosFileArgs(["-i", "a.atr", "b", "c"])).toThrow(
		/unexpected argument/,
	);
	expect(() =>
		parseSetDosFileArgs(["-i", "a.atr", "dos.sys", "--clear"]),
	).toThrow(/--clear takes no file name/);
});
