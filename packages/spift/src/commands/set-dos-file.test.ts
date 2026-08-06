import { expect, test } from "vitest";
import { parseSetDosFileArgs } from "./set-dos-file.ts";

test("parses the image, an optional name, and options", () => {
	expect(parseSetDosFileArgs(["disk.atr"])).toEqual({
		image: "disk.atr",
		name: undefined,
		fs: undefined,
		variant: undefined,
		clear: false,
	});
	expect(parseSetDosFileArgs(["disk.atr", "mydos.sys"]).name).toBe("mydos.sys");
	expect(parseSetDosFileArgs(["disk.atr", "--clear"]).clear).toBe(true);
	expect(parseSetDosFileArgs(["disk.atr", "--fs", "atari/dos10"]).variant).toBe(
		"dos10",
	);
});

test("validates the argument list", () => {
	expect(() => parseSetDosFileArgs([])).toThrow(/missing IMAGE_FILE/);
	expect(() => parseSetDosFileArgs(["a.atr", "b", "c"])).toThrow(
		/unexpected argument/,
	);
	expect(() => parseSetDosFileArgs(["a.atr", "dos.sys", "--clear"])).toThrow(
		/--clear takes no file name/,
	);
});
