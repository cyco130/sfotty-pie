import { expect, test } from "vitest";
import { parseMvArgs } from "./mv.ts";

test("parses the containers, sources, and destination", () => {
	const same = parseMvArgs(["-i", "disk.atr", "*.lst", "*.txt"]);
	expect(same.sources).toEqual(["*.lst"]);
	expect(same.destination).toBe("*.txt");
	expect(same.containers).toMatchObject({
		image: "disk.atr",
		from: undefined,
		to: undefined,
	});

	const across = parseMvArgs([
		"--from",
		"a.atr",
		"--to",
		"b.atr",
		"a.com",
		"b.com",
		"games/",
	]);
	expect(across.sources).toEqual(["a.com", "b.com"]);
	expect(across.destination).toBe("games/");
	expect(across.containers).toMatchObject({ from: "a.atr", to: "b.atr" });
});

test("--fs applies to both sides, --from-fs and --to-fs to one", () => {
	expect(
		parseMvArgs(["-i", "d.atr", "--fs", "atari/mydos", "a", "b"]).containers,
	).toMatchObject({ fromVariant: "mydos", toVariant: "mydos" });
	expect(
		parseMvArgs([
			"--from",
			"a.atr",
			"--to",
			"b.atr",
			"--to-fs",
			"atari/10",
			"x",
			"y",
		]).containers,
	).toMatchObject({ fromVariant: undefined, toVariant: "dos10" });
});

test("validates the argument list", () => {
	expect(() => parseMvArgs(["-i", "a.atr", "only"])).toThrow(
		/missing SOURCE and DESTINATION/,
	);
	expect(() => parseMvArgs([])).toThrow(/missing SOURCE and DESTINATION/);
	expect(() =>
		parseMvArgs(["-i", "a.atr", "--from", "b.atr", "x", "y"]),
	).toThrow(/already means both sides/);
	expect(() => parseMvArgs(["-i", "a.atr", "--fs", "fat", "x", "y"])).toThrow(
		/wants a filesystem/,
	);
});

test("--remove-source is parsed and defaults off", () => {
	expect(parseMvArgs(["-i", "d.atr", "a", "b"]).removeSource).toBe(false);
	expect(
		parseMvArgs(["--to", "d.atr", "a", "b", "--remove-source"]).removeSource,
	).toBe(true);
});
