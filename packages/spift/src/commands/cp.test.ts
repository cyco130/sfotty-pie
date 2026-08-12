import { expect, test } from "vitest";
import { parseCpArgs } from "./cp.ts";

test("the last positional is the destination, the rest are sources", () => {
	const one = parseCpArgs(["-i", "disk.atr", "a.com", "games/"]);
	expect(one.sources).toEqual(["a.com"]);
	expect(one.destination).toBe("games/");

	const many = parseCpArgs(["--to", "d.atr", "a.xex", "b.xex", "c.bin", "/"]);
	expect(many.sources).toEqual(["a.xex", "b.xex", "c.bin"]);
	expect(many.destination).toBe("/");
	expect(many.containers).toMatchObject({ from: undefined, to: "d.atr" });
});

test("-R and -r both recurse", () => {
	expect(parseCpArgs(["-i", "d.atr", "-R", "a", "b"]).recursive).toBe(true);
	expect(parseCpArgs(["-i", "d.atr", "-r", "a", "b"]).recursive).toBe(true);
	expect(parseCpArgs(["-i", "d.atr", "a", "b"]).recursive).toBe(false);
});

test("validates the argument list", () => {
	expect(() => parseCpArgs(["-i", "a.atr", "only"])).toThrow(
		/missing SOURCE and DESTINATION/,
	);
	expect(() => parseCpArgs(["--from", "a.atr", "--image", "b.atr"])).toThrow(
		/already means both sides/,
	);
});
