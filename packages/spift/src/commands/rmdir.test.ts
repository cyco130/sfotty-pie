import { expect, test } from "vitest";
import { parseRmdirArgs } from "./rmdir.ts";

test("parses the image and the directories to remove", () => {
	expect(parseRmdirArgs(["-i", "disk.atr", "games"])).toEqual({
		image: "disk.atr",
		paths: ["games"],
		fs: undefined,
		variant: undefined,
	});
	expect(
		parseRmdirArgs(["-i", "d.atr", "a", "b", "--fs", "atari/mydos"]),
	).toMatchObject({ paths: ["a", "b"], fs: "atari", variant: "mydos" });
});

test("validates the argument list", () => {
	expect(() => parseRmdirArgs(["games"])).toThrow(/missing --image/);
	expect(() => parseRmdirArgs(["-i", "a.atr"])).toThrow(/missing DIRECTORY/);
	expect(() => parseRmdirArgs(["-i", "a.atr", "d", "--fs", "fat"])).toThrow(
		/unknown filesystem/,
	);
});
