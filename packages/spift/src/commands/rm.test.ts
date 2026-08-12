import { expect, test } from "vitest";
import { parseRmArgs } from "./rm.ts";

test("parses image, specs, and options", () => {
	expect(parseRmArgs(["-i", "disk.atr", "*.tmp"])).toEqual({
		image: "disk.atr",
		specs: ["*.tmp"],
		fs: undefined,
		variant: undefined,
		force: false,
		recursive: false,
	});
	expect(parseRmArgs(["-i", "disk.atr", "a.dat", "b.dat", "-f"])).toEqual({
		image: "disk.atr",
		specs: ["a.dat", "b.dat"],
		fs: undefined,
		variant: undefined,
		force: true,
		recursive: false,
	});
});

test("validates the argument list", () => {
	expect(() => parseRmArgs([])).toThrow(/missing --image/);
	expect(() => parseRmArgs(["-i", "disk.atr"])).toThrow(/missing SPEC/);
	expect(() => parseRmArgs(["-i", "disk.atr", "a", "--fs", "ext4"])).toThrow(
		/wants a filesystem/,
	);
});
