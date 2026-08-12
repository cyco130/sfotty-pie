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
	});
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
