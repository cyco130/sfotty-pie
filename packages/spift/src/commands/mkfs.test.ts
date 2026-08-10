import { expect, test } from "vitest";
import { parseMkfsArgs } from "./mkfs.ts";

test("parses the image and filesystem selection", () => {
	expect(parseMkfsArgs(["-i", "disk.atr"])).toEqual({
		image: "disk.atr",
		variant: undefined,
		bootSectors: undefined,
		master: undefined,
		installDos: false,
		force: false,
	});
	expect(parseMkfsArgs(["-i", "disk.atr", "--fs", "atari/dos25"]).variant).toBe(
		"dos25",
	);
	expect(parseMkfsArgs(["-i", "disk.atr", "--fs", "MyDOS"]).variant).toBe(
		"mydos",
	);
	// The familiar spellings are one filesystem at two sector sizes.
	expect(parseMkfsArgs(["-i", "d.atr", "--fs", "dos20s"]).variant).toBe(
		"dos20",
	);
	expect(parseMkfsArgs(["-i", "d.atr", "--fs", "dos20d"]).variant).toBe(
		"dos20",
	);
	expect(parseMkfsArgs(["-i", "disk.atr", "--variant", "dos20"]).variant).toBe(
		"dos20",
	);
	expect(
		parseMkfsArgs(["-i", "disk.atr", "--boot-sectors", "boot.bin"]).bootSectors,
	).toBe("boot.bin");
});

test("validates the argument list", () => {
	expect(() => parseMkfsArgs([])).toThrow(/missing --image/);
	expect(() => parseMkfsArgs(["-i", "a.atr", "b.atr"])).toThrow(
		/unexpected argument/,
	);
	expect(() =>
		parseMkfsArgs(["-i", "a.atr", "--fs", "atari/dos25", "--variant", "mydos"]),
	).toThrow(/mutually exclusive/);
	expect(() => parseMkfsArgs(["-i", "a.atr", "--fs", "sparta"])).toThrow(
		/only atari filesystems/,
	);
	expect(() => parseMkfsArgs(["-i", "a.atr", "--fs", "atari"])).toThrow(
		/needs a variant/,
	);
	expect(() => parseMkfsArgs(["-i", "a.atr", "--fs", "c64/1541"])).toThrow(
		/unsupported filesystem family "c64"/,
	);
});
