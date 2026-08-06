import { expect, test } from "vitest";
import { parseMkfsArgs } from "./mkfs.ts";

test("parses the image and filesystem selection", () => {
	expect(parseMkfsArgs(["disk.atr"])).toEqual({
		image: "disk.atr",
		variant: undefined,
		bootSectors: undefined,
	});
	expect(parseMkfsArgs(["disk.atr", "--fs", "atari/dos25"]).variant).toBe(
		"dos25",
	);
	expect(parseMkfsArgs(["disk.atr", "--fs", "MyDOS"]).variant).toBe("mydos");
	expect(parseMkfsArgs(["disk.atr", "--variant", "dos20d"]).variant).toBe(
		"dos20d",
	);
	expect(
		parseMkfsArgs(["disk.atr", "--boot-sectors", "boot.bin"]).bootSectors,
	).toBe("boot.bin");
});

test("validates the argument list", () => {
	expect(() => parseMkfsArgs([])).toThrow(/missing IMAGE_FILE/);
	expect(() => parseMkfsArgs(["a.atr", "b.atr"])).toThrow(
		/unexpected argument/,
	);
	expect(() =>
		parseMkfsArgs(["a.atr", "--fs", "atari/dos25", "--variant", "mydos"]),
	).toThrow(/mutually exclusive/);
	expect(() => parseMkfsArgs(["a.atr", "--fs", "sparta"])).toThrow(
		/only atari filesystems/,
	);
	expect(() => parseMkfsArgs(["a.atr", "--fs", "atari"])).toThrow(
		/needs a variant/,
	);
	expect(() => parseMkfsArgs(["a.atr", "--fs", "c64/1541"])).toThrow(
		/unsupported filesystem family "c64"/,
	);
});
