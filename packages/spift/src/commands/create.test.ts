import { expect, test } from "vitest";
import { UsageError } from "../cli-error.ts";
import { parseCreateArgs } from "./create.ts";

test("infers the type from the extension, case-insensitively", () => {
	expect(parseCreateArgs(["-i", "GAME.ATR"])).toEqual({
		image: "GAME.ATR",
		type: "atr",
		sectorSize: 128,
		sectorCount: 720,
		force: false,
		// No --fs still means "format it"; the family and variant resolve
		// from the geometry once the image is open.
		format: {
			image: "GAME.ATR",
			family: undefined,
			variant: undefined,
			bootSectors: undefined,
			master: undefined,
			installDos: false,
			volumeName: undefined,
			reserveLastSector: false,
		},
	});
});

test("--fs selections parse; --fs none means a blank image", () => {
	expect(
		parseCreateArgs(["-i", "a.atr", "--fs", "atari/mydos"]).format,
	).toMatchObject({ family: "atari", variant: "mydos" });
	expect(
		parseCreateArgs(["-i", "a.atr", "--fs", "sparta", "--volume-name", "X"])
			.format,
	).toMatchObject({ family: "sparta", volumeName: "X" });
	expect(parseCreateArgs(["-i", "a.atr", "--fs", "none"]).format).toBe(
		undefined,
	);
	expect(parseCreateArgs(["-i", "a.atr", "--fs", "NONE"]).format).toBe(
		undefined,
	);
});

test("--fs none refuses the formatting flags", () => {
	expect(() =>
		parseCreateArgs(["-i", "a.atr", "--fs", "none", "--volume-name", "X"]),
	).toThrow(/--volume-name is a formatting option/);
	expect(() =>
		parseCreateArgs(["-i", "a.atr", "--fs", "none", "--master", "m.atr"]),
	).toThrow(/--master is a formatting option/);
});

test("the shared mkfs validations apply to create too", () => {
	expect(() => parseCreateArgs(["-i", "a.atr", "--fs", "sparta"])).toThrow(
		/needs a volume name/,
	);
	expect(() => parseCreateArgs(["-i", "a.atr", "--install-dos"])).toThrow(
		/--install-dos needs --master/,
	);
	expect(() =>
		parseCreateArgs([
			"-i",
			"a.atr",
			"--master",
			"m.atr",
			"--boot-sectors",
			"b.bin",
		]),
	).toThrow(/mutually exclusive/);
});

test("a filesystem choice picks its home geometry", () => {
	// The inverse of geometry-picks-the-filesystem: atari/25 is the one
	// variant whose home is not the global 720 x 128 default.
	expect(parseCreateArgs(["-i", "a.atr", "--fs", "atari/25"])).toMatchObject({
		sectorSize: 128,
		sectorCount: 1040,
	});
	expect(parseCreateArgs(["-i", "a.atr", "--fs", "atari/20"]).sectorCount).toBe(
		720,
	);
	expect(
		parseCreateArgs(["-i", "a.atr", "--fs", "atari/mydos"]).sectorCount,
	).toBe(720);
	// An explicit count wins; --sd names just the size, so it rides along.
	expect(
		parseCreateArgs([
			"-i",
			"a.atr",
			"--fs",
			"atari/25",
			"--sector-count",
			"2048",
		]).sectorCount,
	).toBe(2048);
	expect(
		parseCreateArgs(["-i", "a.atr", "--sd", "--fs", "atari/25"]).sectorCount,
	).toBe(1040);
});

test("8192-byte sectors hold no filesystem, so they demand --fs none", () => {
	expect(() =>
		parseCreateArgs(["-i", "a.atr", "--sector-size", "8192"]),
	).toThrow(/create the image blank with --fs none/);
	expect(
		parseCreateArgs(["-i", "a.atr", "--sector-size", "8192", "--fs", "none"])
			.format,
	).toBe(undefined);
});

test("--force and -f", () => {
	expect(parseCreateArgs(["-i", "a.atr"]).force).toBe(false);
	expect(parseCreateArgs(["-i", "a.atr", "--force"]).force).toBe(true);
	expect(parseCreateArgs(["-i", "a.atr", "-f"]).force).toBe(true);
});

test("--type works without an extension and is case-insensitive", () => {
	expect(parseCreateArgs(["-i", "disk", "-t", "ATR"]).type).toBe("atr");
	expect(parseCreateArgs(["-i", "disk", "--type", "atr"]).type).toBe("atr");
});

test("errors when the type is neither given nor inferable", () => {
	expect(() => parseCreateArgs(["-i", "disk"])).toThrow(UsageError);
	expect(() => parseCreateArgs(["-i", "disk"])).toThrow(/cannot infer/);
});

test("errors on unsupported types", () => {
	expect(() => parseCreateArgs(["-i", "disk.xfd"])).toThrow(
		/unsupported image type "xfd"/,
	);
	expect(() => parseCreateArgs(["-i", "disk.atr", "-t", "xex"])).toThrow(
		/unsupported image type "xex"/,
	);
});

test("geometry shorthands", () => {
	const sd = parseCreateArgs(["-i", "a.atr", "--sd"]);
	expect([sd.sectorSize, sd.sectorCount]).toEqual([128, 720]);
	const ed = parseCreateArgs(["-i", "a.atr", "--ed"]);
	expect([ed.sectorSize, ed.sectorCount]).toEqual([128, 1040]);
	const dd = parseCreateArgs(["-i", "a.atr", "--dd"]);
	expect([dd.sectorSize, dd.sectorCount]).toEqual([256, 720]);
});

test("explicit geometry, with defaults for the omitted half", () => {
	const both = parseCreateArgs([
		"-i",
		"a.atr",
		"--sector-size",
		"256",
		"--sector-count",
		"1440",
	]);
	expect([both.sectorSize, both.sectorCount]).toEqual([256, 1440]);
	expect(
		parseCreateArgs(["-i", "a.atr", "--sector-size", "512"]).sectorCount,
	).toBe(720);
	expect(
		parseCreateArgs(["-i", "a.atr", "--sector-count", "40"]).sectorSize,
	).toBe(128);
});

test("shorthands are mutually exclusive", () => {
	expect(() => parseCreateArgs(["-i", "a.atr", "--sd", "--dd"])).toThrow(
		/mutually exclusive/,
	);
});

test("--sd and --dd set only the size, so --sector-count rides along", () => {
	// The reason to have them: a hard-disk-sized image at a chosen density.
	expect(
		parseCreateArgs(["-i", "a.atr", "--dd", "--sector-count", "65535"]),
	).toMatchObject({ sectorSize: 256, sectorCount: 65535 });
	expect(
		parseCreateArgs(["-i", "a.atr", "--sd", "--sector-count", "1040"]),
	).toMatchObject({ sectorSize: 128, sectorCount: 1040 });
	// But not a second --sector-size, and --ed stays a whole geometry.
	expect(() =>
		parseCreateArgs(["-i", "a.atr", "--dd", "--sector-size", "128"]),
	).toThrow(/--dd already sets the sector size/);
	expect(() =>
		parseCreateArgs(["-i", "a.atr", "--ed", "--sector-count", "720"]),
	).toThrow(/--ed is a complete geometry/);
});

test("validates geometry values", () => {
	expect(() =>
		parseCreateArgs(["-i", "a.atr", "--sector-size", "100"]),
	).toThrow(/invalid --sector-size/);
	expect(() => parseCreateArgs(["-i", "a.atr", "--sector-count", "0"])).toThrow(
		/positive integer/,
	);
	expect(() =>
		parseCreateArgs(["-i", "a.atr", "--sector-count", "12x"]),
	).toThrow(/positive integer/);
	expect(() =>
		parseCreateArgs(["-i", "a.atr", "--sector-count", "65536"]),
	).toThrow(/too large/);
});

test("validates the argument list itself", () => {
	expect(() => parseCreateArgs([])).toThrow(/missing --image/);
	expect(() => parseCreateArgs(["-i", "a.atr", "b.atr"])).toThrow(
		/unexpected argument/,
	);
	expect(() => parseCreateArgs(["-i", "a.atr", "--bogus"])).toThrow(UsageError);
});

test("create formats by geometry default, in one step", async () => {
	const { existsSync, readFileSync, mkdtempSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { createCommand } = await import("./create.ts");
	const { openAtr } = await import("../atr.ts");
	const { detectFilesystem } = await import("../detect.ts");

	const dir = mkdtempSync(join(tmpdir(), "spift-create-"));
	const lines: string[] = [];
	const original = process.stdout.write.bind(process.stdout);
	process.stdout.write = ((chunk: string | Uint8Array): boolean => {
		lines.push(chunk.toString());
		return true;
	}) as typeof process.stdout.write;
	try {
		await createCommand(["-i", join(dir, "sd.atr")]);
		await createCommand(["-i", join(dir, "ed.atr"), "--ed"]);
	} finally {
		process.stdout.write = original;
	}

	const sd = openAtr(readFileSync(join(dir, "sd.atr")));
	expect(detectFilesystem(sd)).toEqual({ family: "atari", variant: "dos20" });
	const ed = openAtr(readFileSync(join(dir, "ed.atr")));
	expect(detectFilesystem(ed)).toEqual({ family: "atari", variant: "dos25" });
	expect(lines.join("")).toMatch(/created .*sd\.atr: 720 x 128-byte sectors/);
	expect(lines.join("")).toMatch(/made an atari\/20 filesystem/);
	expect(lines.join("")).toMatch(/made an atari\/25 filesystem/);
	expect(existsSync(join(dir, "sd.atr"))).toBe(true);
});

test("create --fs none leaves the image blank", async () => {
	const { readFileSync, mkdtempSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { createCommand } = await import("./create.ts");

	const dir = mkdtempSync(join(tmpdir(), "spift-create-"));
	const image = join(dir, "blank.atr");
	const lines: string[] = [];
	const original = process.stdout.write.bind(process.stdout);
	process.stdout.write = ((chunk: string | Uint8Array): boolean => {
		lines.push(chunk.toString());
		return true;
	}) as typeof process.stdout.write;
	try {
		await createCommand(["-i", image, "--fs", "none"]);
	} finally {
		process.stdout.write = original;
	}
	const bytes = readFileSync(image);
	expect(bytes.subarray(16).every((byte) => byte === 0)).toBe(true);
	expect(lines.join("")).toMatch(/no filesystem/);
	expect(lines.join("")).not.toMatch(/made an/);
});

test("a failed format leaves no file behind", async () => {
	const { existsSync, mkdtempSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { createCommand } = await import("./create.ts");

	const dir = mkdtempSync(join(tmpdir(), "spift-create-"));
	const image = join(dir, "hd.atr");
	// A 512-byte-sector image defaults to SpartaDOS, which needs a volume
	// name - the create must fail whole, before the file exists.
	await expect(
		createCommand(["-i", image, "--sector-size", "512"]),
	).rejects.toThrow(/needs a volume name/);
	expect(existsSync(image)).toBe(false);
});

test("create --fs sparta formats a named volume", async () => {
	const { readFileSync, mkdtempSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { createCommand } = await import("./create.ts");
	const { openAtr } = await import("../atr.ts");
	const { detectSpartaDos, openSpartaDos } = await import("../sparta-dos.ts");

	const dir = mkdtempSync(join(tmpdir(), "spift-create-"));
	const image = join(dir, "sparta.atr");
	const original = process.stdout.write.bind(process.stdout);
	process.stdout.write = ((): boolean => true) as typeof process.stdout.write;
	try {
		await createCommand([
			"-i",
			image,
			"--dd",
			"--fs",
			"sparta",
			"--volume-name",
			"WORKDISK",
		]);
	} finally {
		process.stdout.write = original;
	}
	const medium = openAtr(readFileSync(image));
	expect(detectSpartaDos(medium)).toBe("sdfs21");
	expect(openSpartaDos(medium).volume().label).toBe("workdisk");
});
