import { expect, test } from "vitest";
import { parseInstallDosArgs } from "./install-dos.ts";

test("parses the target and the master it copies from", () => {
	expect(
		parseInstallDosArgs(["-i", "disk.atr", "--from", "master.atr"]),
	).toEqual({
		image: "disk.atr",
		from: "master.atr",
		fs: undefined,
		variant: undefined,
		force: false,
	});
	expect(
		parseInstallDosArgs([
			"-i",
			"d.atr",
			"--from",
			"m.atr",
			"-f",
			"--fs",
			"mydos",
		]),
	).toMatchObject({ force: true, variant: "mydos" });
});

test("validates the argument list", () => {
	expect(() => parseInstallDosArgs([])).toThrow(/missing --image/);
	expect(() => parseInstallDosArgs(["-i", "disk.atr"])).toThrow(
		/missing --from/,
	);
	expect(() =>
		parseInstallDosArgs(["-i", "a.atr", "b.atr", "--from", "m.atr"]),
	).toThrow(/unexpected argument/);
});
