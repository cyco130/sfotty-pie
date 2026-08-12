import { expect, test } from "vitest";
import { parseMkfsArgs } from "./mkfs.ts";

test("parses the image and filesystem selection", () => {
	expect(parseMkfsArgs(["-i", "disk.atr"])).toMatchObject({
		image: "disk.atr",
		family: undefined,
		variant: undefined,
	});
	expect(parseMkfsArgs(["-i", "disk.atr", "--fs", "atari/25"]).variant).toBe(
		"dos25",
	);
	// MyDOS keeps its name; it is a distinct format, not a version.
	expect(parseMkfsArgs(["-i", "disk.atr", "--fs", "atari/mydos"]).variant).toBe(
		"mydos",
	);
	// Case-insensitive, and the family is always required.
	expect(parseMkfsArgs(["-i", "d.atr", "--fs", "ATARI/20"]).variant).toBe(
		"dos20",
	);
	expect(
		parseMkfsArgs(["-i", "disk.atr", "--variant", "atari/20"]).variant,
	).toBe("dos20");
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
		parseMkfsArgs([
			"-i",
			"a.atr",
			"--fs",
			"atari/25",
			"--variant",
			"atari/mydos",
		]),
	).toThrow(/mutually exclusive/);
	// A bare family means "pick the variant for me": geometry decides for
	// atari, and sparta defaults to what SDX itself formats (sdfs21).
	expect(
		parseMkfsArgs(["-i", "a.atr", "--fs", "sparta", "--volume-name", "vol"]),
	).toMatchObject({ family: "sparta", variant: undefined, volumeName: "vol" });
	expect(parseMkfsArgs(["-i", "a.atr", "--fs", "atari"])).toMatchObject({
		family: "atari",
		variant: undefined,
	});
	expect(
		parseMkfsArgs(["-i", "a.atr", "--fs", "sparta/20", "--volume-name", "v"])
			.variant,
	).toBe("sdfs20");
	// SpartaDOS needs a volume name.
	expect(() => parseMkfsArgs(["-i", "a.atr", "--fs", "sparta"])).toThrow(
		/needs a volume name/,
	);
	expect(() => parseMkfsArgs(["-i", "a.atr", "--volume-name", "work"])).toThrow(
		/--volume-name is SpartaDOS's/,
	);
	expect(() => parseMkfsArgs(["-i", "a.atr", "--fs", "c64/1541"])).toThrow(
		/unsupported filesystem family "c64"/,
	);
});
