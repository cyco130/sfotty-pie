import { expect, test } from "vitest";
import { parseAddArgs } from "./add.ts";

test("parses image, files, and options", () => {
	expect(parseAddArgs(["disk.atr", "a.xex"])).toEqual({
		image: "disk.atr",
		files: ["a.xex"],
		fs: undefined,
		force: false,
	});
	expect(parseAddArgs(["disk.atr", "a.xex", "b.dat", "-f"])).toEqual({
		image: "disk.atr",
		files: ["a.xex", "b.dat"],
		fs: undefined,
		force: true,
	});
});

test("validates the argument list", () => {
	expect(() => parseAddArgs([])).toThrow(/missing IMAGE_FILE/);
	expect(() => parseAddArgs(["disk.atr"])).toThrow(/missing FILE/);
	expect(() => parseAddArgs(["disk.atr", "a", "--fs", "hfs"])).toThrow(
		/invalid --fs/,
	);
});
