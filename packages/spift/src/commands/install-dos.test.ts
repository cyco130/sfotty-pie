import { expect, test } from "vitest";
import { parseInstallDosArgs } from "./install-dos.ts";

test("parses the target and the master it copies from", () => {
	expect(parseInstallDosArgs(["disk.atr", "--from", "master.atr"])).toEqual({
		image: "disk.atr",
		from: "master.atr",
		fs: undefined,
		variant: undefined,
		force: false,
	});
	expect(
		parseInstallDosArgs(["d.atr", "--from", "m.atr", "-f", "--fs", "mydos"]),
	).toMatchObject({ force: true, variant: "mydos" });
});

test("validates the argument list", () => {
	expect(() => parseInstallDosArgs([])).toThrow(/missing IMAGE_FILE/);
	expect(() => parseInstallDosArgs(["disk.atr"])).toThrow(/missing --from/);
	expect(() =>
		parseInstallDosArgs(["a.atr", "b.atr", "--from", "m.atr"]),
	).toThrow(/unexpected argument/);
});
