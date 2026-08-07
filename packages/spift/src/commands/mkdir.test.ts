import { expect, test } from "vitest";
import { parseMkdirArgs } from "./mkdir.ts";

test("parses the image and the directories to create", () => {
	expect(parseMkdirArgs(["-i", "disk.atr", "games"])).toEqual({
		image: "disk.atr",
		paths: ["games"],
		fs: undefined,
		variant: undefined,
		parents: false,
	});
	expect(
		parseMkdirArgs(["-i", "d.atr", "a", "b", "-p", "--fs", "mydos"]),
	).toMatchObject({ paths: ["a", "b"], parents: true, variant: "mydos" });
});

test("validates the argument list", () => {
	expect(() => parseMkdirArgs(["games"])).toThrow(/missing --image/);
	expect(() => parseMkdirArgs(["-i", "a.atr"])).toThrow(/missing DIRECTORY/);
	expect(() => parseMkdirArgs(["-i", "a.atr", "d", "--fs", "fat"])).toThrow(
		/unknown filesystem/,
	);
});
