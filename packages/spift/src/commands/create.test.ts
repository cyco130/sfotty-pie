import { expect, test } from "vitest";
import { UsageError } from "../cli-error.ts";
import { parseCreateArgs } from "./create.ts";

test("infers the type from the extension, case-insensitively", () => {
	expect(parseCreateArgs(["GAME.ATR"])).toEqual({
		filename: "GAME.ATR",
		type: "atr",
		sectorSize: 128,
		sectorCount: 720,
		force: false,
	});
});

test("--force and -f", () => {
	expect(parseCreateArgs(["a.atr"]).force).toBe(false);
	expect(parseCreateArgs(["a.atr", "--force"]).force).toBe(true);
	expect(parseCreateArgs(["a.atr", "-f"]).force).toBe(true);
});

test("--type works without an extension and is case-insensitive", () => {
	expect(parseCreateArgs(["disk", "-t", "ATR"]).type).toBe("atr");
	expect(parseCreateArgs(["disk", "--type", "atr"]).type).toBe("atr");
});

test("errors when the type is neither given nor inferable", () => {
	expect(() => parseCreateArgs(["disk"])).toThrow(UsageError);
	expect(() => parseCreateArgs(["disk"])).toThrow(/cannot infer/);
});

test("errors on unsupported types", () => {
	expect(() => parseCreateArgs(["disk.xfd"])).toThrow(
		/unsupported image type "xfd"/,
	);
	expect(() => parseCreateArgs(["disk.atr", "-t", "xex"])).toThrow(
		/unsupported image type "xex"/,
	);
});

test("geometry shorthands", () => {
	const sd = parseCreateArgs(["a.atr", "--sd"]);
	expect([sd.sectorSize, sd.sectorCount]).toEqual([128, 720]);
	const ed = parseCreateArgs(["a.atr", "--ed"]);
	expect([ed.sectorSize, ed.sectorCount]).toEqual([128, 1040]);
	const dd = parseCreateArgs(["a.atr", "--dd"]);
	expect([dd.sectorSize, dd.sectorCount]).toEqual([256, 720]);
});

test("explicit geometry, with defaults for the omitted half", () => {
	const both = parseCreateArgs([
		"a.atr",
		"--sector-size",
		"256",
		"--sector-count",
		"1440",
	]);
	expect([both.sectorSize, both.sectorCount]).toEqual([256, 1440]);
	expect(parseCreateArgs(["a.atr", "--sector-size", "512"]).sectorCount).toBe(
		720,
	);
	expect(parseCreateArgs(["a.atr", "--sector-count", "40"]).sectorSize).toBe(
		128,
	);
});

test("shorthands are mutually exclusive", () => {
	expect(() => parseCreateArgs(["a.atr", "--sd", "--dd"])).toThrow(
		/mutually exclusive/,
	);
});

test("a shorthand cannot be combined with explicit geometry", () => {
	expect(() =>
		parseCreateArgs(["a.atr", "--sd", "--sector-count", "100"]),
	).toThrow(/cannot be combined/);
	expect(() =>
		parseCreateArgs(["a.atr", "--dd", "--sector-size", "128"]),
	).toThrow(/cannot be combined/);
});

test("validates geometry values", () => {
	expect(() => parseCreateArgs(["a.atr", "--sector-size", "100"])).toThrow(
		/invalid --sector-size/,
	);
	expect(() => parseCreateArgs(["a.atr", "--sector-count", "0"])).toThrow(
		/positive integer/,
	);
	expect(() => parseCreateArgs(["a.atr", "--sector-count", "12x"])).toThrow(
		/positive integer/,
	);
	expect(() => parseCreateArgs(["a.atr", "--sector-count", "65536"])).toThrow(
		/too large/,
	);
});

test("validates the argument list itself", () => {
	expect(() => parseCreateArgs([])).toThrow(/missing FILENAME/);
	expect(() => parseCreateArgs(["a.atr", "b.atr"])).toThrow(
		/unexpected argument/,
	);
	expect(() => parseCreateArgs(["a.atr", "--bogus"])).toThrow(UsageError);
});
