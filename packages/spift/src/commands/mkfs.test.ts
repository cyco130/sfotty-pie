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
		parseMkfsArgs(["-i", "disk.atr", "--boot-sectors", "boot.bin"]).bootSectors,
	).toBe("boot.bin");
});

test("validates the argument list", () => {
	expect(() => parseMkfsArgs([])).toThrow(/missing --image/);
	expect(() => parseMkfsArgs(["-i", "a.atr", "b.atr"])).toThrow(
		/unexpected argument/,
	);
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

test("an impossible geometry errors alone, without the sectors-past-720 note", async () => {
	const { mkdtempSync, writeFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { mkfsCommand } = await import("./mkfs.ts");
	const { createBlankAtr } = await import("../atr.ts");

	const dir = mkdtempSync(join(tmpdir(), "spift-mkfs-"));
	const image = join(dir, "big.atr");
	// 1040 sectors (past 720) at 256 bytes - a size DOS 1.0 cannot take.
	writeFileSync(image, createBlankAtr({ sectorSize: 256, sectorCount: 1040 }));

	const warnings: string[] = [];
	const original = process.stderr.write.bind(process.stderr);
	process.stderr.write = ((chunk: string | Uint8Array): boolean => {
		warnings.push(chunk.toString());
		return true;
	}) as typeof process.stderr.write;
	try {
		await expect(
			mkfsCommand(["-i", image, "--fs", "atari/10"]),
		).rejects.toThrow(/only supports 128-byte sectors/);
	} finally {
		process.stderr.write = original;
	}
	// The geometry rejection fires first, so the warning never prints.
	expect(warnings.join("")).not.toMatch(/never allocates at or above sector/);
});

test("a standard enhanced disk does not flag DOS 2.5's inherent 17 sectors", async () => {
	const { mkdtempSync, writeFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { mkfsCommand } = await import("./mkfs.ts");
	const { createBlankAtr } = await import("../atr.ts");

	const dir = mkdtempSync(join(tmpdir(), "spift-mkfs-"));
	const ed = join(dir, "ed.atr");
	writeFileSync(ed, createBlankAtr({ sectorSize: 128, sectorCount: 1040 }));
	const big = join(dir, "big.atr");
	writeFileSync(big, createBlankAtr({ sectorSize: 128, sectorCount: 1100 }));

	const lines: string[] = [];
	const original = process.stdout.write.bind(process.stdout);
	process.stdout.write = ((chunk: string | Uint8Array): boolean => {
		lines.push(chunk.toString());
		return true;
	}) as typeof process.stdout.write;
	try {
		// 1040 is DOS 2.5's home; the 17 unreachable sectors are the format,
		// not news.
		await mkfsCommand(["-i", ed, "--fs", "atari/25"]);
		// A non-standard size is the caller's own doing, so it is flagged.
		await mkfsCommand(["-i", big, "--fs", "atari/25"]);
	} finally {
		process.stdout.write = original;
	}
	const [edLine, bigLine] = lines;
	expect(edLine).not.toMatch(/beyond its reach/);
	expect(bigLine).toMatch(/77 sector\(s\) beyond its reach/);
});
