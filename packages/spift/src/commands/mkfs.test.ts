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
	// An explicit --fs sparta needs a volume name.
	expect(() => parseMkfsArgs(["-i", "a.atr", "--fs", "sparta"])).toThrow(
		/needs a volume name/,
	);
	// With no --fs, whether a volume name is wanted turns on the sector size
	// (512 defaults to SpartaDOS), which parsing cannot see, so it just
	// carries the name and lets the command settle it.
	expect(
		parseMkfsArgs(["-i", "a.atr", "--volume-name", "work"]).volumeName,
	).toBe("work");
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

test("mkfs picks the family from the sector size, and refuses odd ones", async () => {
	const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { mkfsCommand } = await import("./mkfs.ts");
	const { createBlankAtr, openAtr } = await import("../atr.ts");
	const { detectFilesystem } = await import("../detect.ts");

	const dir = mkdtempSync(join(tmpdir(), "spift-mkfs-"));
	const write = (name: string, size: 128 | 512 | 8192, count: number) => {
		const path = join(dir, name);
		writeFileSync(
			path,
			createBlankAtr({ sectorSize: size, sectorCount: count }),
		);
		return path;
	};

	// A 512-byte image defaults to SpartaDOS, which needs a volume name.
	const hd = write("hd.atr", 512, 4096);
	await expect(mkfsCommand(["-i", hd])).rejects.toThrow(/needs a volume name/);
	await mkfsCommand(["-i", hd, "--volume-name", "hd"]);
	expect(detectFilesystem(openAtr(readFileSync(hd)))).toMatchObject({
		family: "sparta",
		variant: "sdfs21",
	});

	// A volume name on an Atari-defaulting image is rejected, family named.
	const sd = write("sd.atr", 128, 720);
	await expect(mkfsCommand(["-i", sd, "--volume-name", "x"])).rejects.toThrow(
		/--volume-name is SpartaDOS's/,
	);

	// A sector size no filesystem uses is refused without naming a family.
	const odd = write("odd.atr", 8192, 100);
	await expect(mkfsCommand(["-i", odd])).rejects.toThrow(
		/128-, 256-, or 512-byte sectors, not 8192/,
	);
	await expect(mkfsCommand(["-i", odd, "--fs", "atari/20"])).rejects.toThrow(
		/128-, 256-, or 512-byte sectors, not 8192/,
	);
});

test("mkfs reclaims the last sector by default; --reserve-last-sector keeps it", async () => {
	const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { mkfsCommand } = await import("./mkfs.ts");
	const { createBlankAtr, openAtr } = await import("../atr.ts");
	const { openSpartaDos } = await import("../sparta-dos.ts");

	const dir = mkdtempSync(join(tmpdir(), "spift-mkfs-"));
	const make = (name: string): string => {
		const path = join(dir, name);
		writeFileSync(path, createBlankAtr({ sectorSize: 128, sectorCount: 720 }));
		return path;
	};
	const free = (path: string): number =>
		openSpartaDos(openAtr(readFileSync(path))).volume().freeSectors;

	// Even sparta/20, whose era's formatters reserve the last sector, reclaims
	// by default here (714 of 720), and the flag brings back the reserve (713).
	const reclaimed = make("reclaimed.atr");
	await mkfsCommand([
		"-i",
		reclaimed,
		"--fs",
		"sparta/20",
		"--volume-name",
		"v",
	]);
	expect(free(reclaimed)).toBe(714);

	const reserved = make("reserved.atr");
	await mkfsCommand([
		"-i",
		reserved,
		"--fs",
		"sparta/20",
		"--volume-name",
		"v",
		"--reserve-last-sector",
	]);
	expect(free(reserved)).toBe(713);

	// It is SpartaDOS-only: the Atari DOS family points at MyDOS instead.
	const atari = make("atari.atr");
	await expect(
		mkfsCommand(["-i", atari, "--fs", "atari/20", "--reserve-last-sector"]),
	).rejects.toThrow(/SpartaDOS option/);
});

test("atari/20 stays a single-VTOC 943-sector disk instead of going MyDOS", async () => {
	const { openAtr, createBlankAtr } = await import("../atr.ts");
	const { formatAtariDos, openAtariDos } = await import("../atari-dos.ts");

	// Enhanced density (1040 sectors): dos20 caps at 943, MyDOS covers it all.
	const asDos20 = openAtr(
		createBlankAtr({ sectorSize: 128, sectorCount: 1040 }),
	);
	const dos20 = formatAtariDos(asDos20, "dos20");
	expect(dos20.unusableSectors).toBe(1040 - 943);
	// The VTOC code stays 2 (single VTOC), not 3 (an extra bitmap page).
	expect(openAtariDos(asDos20, "dos20").volume().totalSectors).toBeLessThan(
		944,
	);

	const asMyDos = openAtr(
		createBlankAtr({ sectorSize: 128, sectorCount: 1040 }),
	);
	const mydos = formatAtariDos(asMyDos, "mydos");
	expect(mydos.unusableSectors).toBe(0);
	expect(openAtariDos(asMyDos, "mydos").volume().totalSectors).toBeGreaterThan(
		1000,
	);
});
