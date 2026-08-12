import { expect, test } from "vitest";
import { parseCatArgs } from "./cat.ts";

test("parses the image and the specs", () => {
	expect(parseCatArgs(["-i", "d.atr", "notes.txt"])).toEqual({
		image: "d.atr",
		specs: ["notes.txt"],
		fs: undefined,
		variant: undefined,
		eol: "lf",
	});
	expect(parseCatArgs(["-i", "d.atr", "*.txt", "a.doc"]).specs).toEqual([
		"*.txt",
		"a.doc",
	]);
	expect(parseCatArgs(["-i", "d.atr", "a", "--eol", "crlf"]).eol).toBe("crlf");
});

test("validates the argument list", () => {
	expect(() => parseCatArgs(["notes.txt"])).toThrow(/missing --image/);
	expect(() => parseCatArgs(["-i", "d.atr"])).toThrow(/missing the file/);
	expect(() => parseCatArgs(["-i", "d.atr", "a", "--eol", "cr"])).toThrow(
		/unknown --eol/,
	);
	// There is no --text: cat is text, which is what an image holds. Raw
	// bytes are hexdump's business.
	expect(() => parseCatArgs(["-i", "d.atr", "a", "--text"])).toThrow();
});
