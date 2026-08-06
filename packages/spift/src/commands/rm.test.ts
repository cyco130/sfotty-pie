import { expect, test } from "vitest";
import { parseRmArgs } from "./rm.ts";

test("parses image, specs, and options", () => {
	expect(parseRmArgs(["disk.atr", "*.tmp"])).toEqual({
		image: "disk.atr",
		specs: ["*.tmp"],
		fs: undefined,
		variant: undefined,
		force: false,
	});
	expect(parseRmArgs(["disk.atr", "a.dat", "b.dat", "-f"])).toEqual({
		image: "disk.atr",
		specs: ["a.dat", "b.dat"],
		fs: undefined,
		variant: undefined,
		force: true,
	});
});

test("validates the argument list", () => {
	expect(() => parseRmArgs([])).toThrow(/missing IMAGE_FILE/);
	expect(() => parseRmArgs(["disk.atr"])).toThrow(/missing SPEC/);
	expect(() => parseRmArgs(["disk.atr", "a", "--fs", "ext4"])).toThrow(
		/unknown filesystem/,
	);
});
