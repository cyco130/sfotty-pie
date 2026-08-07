import { expect, test } from "vitest";
import { parseMvArgs } from "./mv.ts";

test("parses the image, source, and destination", () => {
	expect(parseMvArgs(["-i", "disk.atr", "*.lst", "*.txt"])).toEqual({
		image: "disk.atr",
		source: "*.lst",
		destination: "*.txt",
		fs: undefined,
		variant: undefined,
		force: false,
	});
	expect(
		parseMvArgs(["-i", "d.atr", "a.com", "games/", "-f", "--fs", "mydos"]),
	).toMatchObject({ destination: "games/", force: true, variant: "mydos" });
});

test("validates the argument list", () => {
	expect(() => parseMvArgs(["a", "b"])).toThrow(/missing --image/);
	expect(() => parseMvArgs(["-i", "a.atr", "only"])).toThrow(
		/missing SOURCE and DESTINATION/,
	);
	expect(() => parseMvArgs(["-i", "a.atr", "a", "b", "c"])).toThrow(
		/unexpected argument/,
	);
});
