import { expect, test } from "vitest";
import { parsePackArgs } from "./pack.ts";

test("parses the image, the directory, and the geometry", () => {
	expect(parsePackArgs(["-i", "disk.atr"])).toEqual({
		image: "disk.atr",
		directory: ".",
		family: undefined,
		variant: undefined,
		sectorSize: 128,
		sectorCount: 720,
		writeBootSectors: false,
		setDosFile: undefined,
		force: false,
		noTimestamps: false,
		text: [],
		strict: false,
		volumeName: undefined,
	});
	expect(parsePackArgs(["-i", "d.atr", "stuff", "--dd"])).toMatchObject({
		directory: "stuff",
		sectorSize: 256,
		sectorCount: 720,
	});
	// --dd sets only the size, so --sector-count rides along.
	expect(
		parsePackArgs(["-i", "d.atr", "--dd", "--sector-count", "65535"]),
	).toMatchObject({ sectorSize: 256, sectorCount: 65535 });
	expect(
		parsePackArgs([
			"-i",
			"d.atr",
			"--fs",
			"atari/mydos",
			"--sector-count",
			"1440",
		]),
	).toMatchObject({ variant: "mydos", sectorCount: 1440 });
});

test("--set-dos-file needs boot code to point at", () => {
	expect(() =>
		parsePackArgs(["-i", "d.atr", "--set-dos-file", "dos.sys"]),
	).toThrow(/needs --write-boot-sectors/);
	expect(
		parsePackArgs([
			"-i",
			"d.atr",
			"--set-dos-file",
			"dos.sys",
			"--write-boot-sectors",
		]),
	).toMatchObject({ setDosFile: "dos.sys", writeBootSectors: true });
});

test("validates the argument list", () => {
	expect(() => parsePackArgs([])).toThrow(/missing --image/);
	expect(() => parsePackArgs(["-i", "d.atr", "a", "b"])).toThrow(
		/unexpected argument/,
	);
	expect(() => parsePackArgs(["-i", "d.atr", "--sd", "--dd"])).toThrow(
		/mutually exclusive/,
	);
	expect(() =>
		parsePackArgs(["-i", "d.atr", "--ed", "--sector-size", "256"]),
	).toThrow(/cannot be combined/);
	expect(() => parsePackArgs(["-i", "d.atr", "--sector-size", "100"])).toThrow(
		/invalid --sector-size/,
	);
});

test("--text takes the pattern, since pack has no spec of its own", () => {
	expect(parsePackArgs(["-i", "d.atr", "--text", "*.txt"]).text).toEqual([
		"*.txt",
	]);
	expect(
		parsePackArgs(["-i", "d.atr", "--text", "*.txt", "--text", "*.md"]).text,
	).toEqual(["*.txt", "*.md"]);
	expect(() => parsePackArgs(["-i", "d.atr", "--text"])).toThrow();
});

test("the boot record follows dos.sys wherever packing puts it", async () => {
	const { mkdtempSync, writeFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { packCommand, BOOT_FILE } = await import("./pack.ts");
	const { openAtr } = await import("../atr.ts");
	const { readFileSync } = await import("node:fs");

	const dir = mkdtempSync(join(tmpdir(), "spift-pack-"));
	// A boot record as unpack would have written it: three sectors, marked
	// bootable, pointing at sector 4 - where its old disk kept the DOS.
	const boot = new Uint8Array(384);
	boot[1] = 3;
	boot[0x0e] = 1;
	boot[0x0f] = 4;
	writeFileSync(join(dir, BOOT_FILE), boot);
	// Something that sorts before dos.sys, so dos.sys cannot land on 4.
	writeFileSync(join(dir, "aaa.bin"), new Uint8Array(3000));
	writeFileSync(join(dir, "dos.sys"), new Uint8Array(500));

	const image = join(dir, "out.atr");
	await packCommand(["-i", image, dir, "--write-boot-sectors", "-f"]);

	const medium = openAtr(readFileSync(image));
	const record = medium.readSector(1) as Uint8Array;
	const pointer = (record[0x0f] as number) | ((record[0x10] as number) << 8);
	expect(pointer).not.toBe(4); // the stale value from the old disk
	expect(record[0x0e]).toBe(1); // still bootable

	// And it points at dos.sys, not at whatever landed on sector 4.
	const { openAtariDos } = await import("../atari-dos.ts");
	const fs = openAtariDos(medium, "dos20");
	const dos = [...fs.entries("dos.sys")][0];
	expect(pointer).toBe(dos?.startSector);
});

test("packing no dos.sys marks the record not bootable", async () => {
	const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { packCommand, BOOT_FILE } = await import("./pack.ts");
	const { openAtr } = await import("../atr.ts");

	const dir = mkdtempSync(join(tmpdir(), "spift-pack-"));
	const boot = new Uint8Array(384);
	boot[1] = 3;
	boot[0x0e] = 1;
	boot[0x0f] = 4;
	writeFileSync(join(dir, BOOT_FILE), boot);
	writeFileSync(join(dir, "aaa.bin"), new Uint8Array(3000));

	const image = join(dir, "out.atr");
	await packCommand(["-i", image, dir, "--write-boot-sectors", "-f"]);

	const record = openAtr(readFileSync(image)).readSector(1) as Uint8Array;
	// Byte 14 zero is what every DOS 2 boot code checks first, and what a
	// real FORMAT leaves behind.
	expect(record[0x0e]).toBe(0);
	expect((record[0x0f] as number) | ((record[0x10] as number) << 8)).toBe(0);
});

test("an explicit --fs sparta pack needs a volume name", () => {
	expect(
		parsePackArgs(["-i", "d.atr", "--fs", "sparta/20", "--volume-name", "v"]),
	).toMatchObject({ family: "sparta", variant: "sdfs20", volumeName: "v" });
	expect(() => parsePackArgs(["-i", "d.atr", "--fs", "sparta"])).toThrow(
		/needs a volume name/,
	);
	// With no --fs the sector size decides, which parsing cannot see, so the
	// name is just carried.
	expect(parsePackArgs(["-i", "d.atr", "--volume-name", "v"]).volumeName).toBe(
		"v",
	);
});

test("pack picks the family from the sector size like mkfs", async () => {
	const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } =
		await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { packCommand } = await import("./pack.ts");
	const { openAtr } = await import("../atr.ts");
	const { openSpartaDos } = await import("../sparta-dos.ts");

	const src = mkdtempSync(join(tmpdir(), "spift-pack-src-"));
	writeFileSync(join(src, "readme.txt"), "hi\x9b");
	mkdirSync(join(src, "sub"));
	writeFileSync(join(src, "sub", "inner.dat"), new Uint8Array([1, 2, 3]));
	const out = mkdtempSync(join(tmpdir(), "spift-pack-out-"));

	// A 512-byte geometry defaults to SpartaDOS, which needs a volume name.
	const hd = join(out, "hd.atr");
	await expect(
		packCommand([
			"-i",
			hd,
			src,
			"--sector-size",
			"512",
			"--sector-count",
			"512",
		]),
	).rejects.toThrow(/needs a volume name/);
	await packCommand([
		"-i",
		hd,
		src,
		"--sector-size",
		"512",
		"--sector-count",
		"512",
		"--volume-name",
		"hd",
		"-f",
	]);
	const filesystem = openSpartaDos(openAtr(readFileSync(hd)));
	expect(filesystem.variant).toBe("sdfs21");
	expect(filesystem.volume().label).toBe("hd");
	expect(
		[...filesystem.entries(undefined, { recursive: true })].map((e) => e.path),
	).toContain("sub/inner.dat");

	// A volume name on an Atari-defaulting geometry is rejected, family named.
	await expect(
		packCommand(["-i", join(out, "a.atr"), src, "--sd", "--volume-name", "x"]),
	).rejects.toThrow(/--volume-name is SpartaDOS's/);

	// A sector size no filesystem uses is refused without naming a family.
	await expect(
		packCommand([
			"-i",
			join(out, "o.atr"),
			src,
			"--sector-size",
			"8192",
			"--sector-count",
			"100",
		]),
	).rejects.toThrow(/128-, 256-, or 512-byte sectors, not 8192/);
});
