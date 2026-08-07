import { expect, test } from "vitest";
import { parseAddArgs } from "./add.ts";

test("parses image, files, and options", () => {
	expect(parseAddArgs(["-i", "disk.atr", "a.xex"])).toEqual({
		image: "disk.atr",
		files: ["a.xex"],
		fs: undefined,
		variant: undefined,
		targetDir: undefined,
		force: false,
	});
	expect(parseAddArgs(["-i", "disk.atr", "a.xex", "b.dat", "-f"])).toEqual({
		image: "disk.atr",
		files: ["a.xex", "b.dat"],
		fs: undefined,
		variant: undefined,
		targetDir: undefined,
		force: true,
	});
});

test("--fs takes a family, a variant, or both", () => {
	expect(parseAddArgs(["-i", "d.atr", "a", "--fs", "atari"])).toMatchObject({
		fs: "atari",
		variant: undefined,
	});
	expect(
		parseAddArgs(["-i", "d.atr", "a", "--fs", "atari/dos10"]),
	).toMatchObject({
		fs: "atari",
		variant: "dos10",
	});
	expect(parseAddArgs(["-i", "d.atr", "a", "--fs", "DOS10"])).toMatchObject({
		fs: "atari",
		variant: "dos10",
	});
});

test("validates the argument list", () => {
	expect(() => parseAddArgs([])).toThrow(/missing --image/);
	expect(() => parseAddArgs(["-i", "disk.atr"])).toThrow(/missing FILE/);
	expect(() => parseAddArgs(["-i", "disk.atr", "a", "--fs", "hfs"])).toThrow(
		/unknown filesystem/,
	);
	expect(() =>
		parseAddArgs(["-i", "disk.atr", "a", "--fs", "c64/1541"]),
	).toThrow(/unsupported filesystem family/);
});
