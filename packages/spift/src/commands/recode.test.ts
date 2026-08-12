import { expect, test } from "vitest";
import { parseRecodeArgs } from "./recode.ts";

test("whichever side you leave out is unicode", () => {
	expect(parseRecodeArgs(["-f", "atascii"])).toEqual({
		from: "atascii",
		to: "unicode",
		files: [],
		inPlace: false,
		strict: false,
		eol: "lf",
	});
	expect(parseRecodeArgs(["-t", "atascii", "a.txt"])).toMatchObject({
		from: "unicode",
		to: "atascii",
		files: ["a.txt"],
	});
	expect(
		parseRecodeArgs(["-f", "atascii", "-t", "escaped-unicode"]),
	).toMatchObject({ from: "atascii", to: "escaped-unicode" });
});

test("options", () => {
	expect(
		parseRecodeArgs(["-t", "atascii", "a", "--strict", "--in-place"]),
	).toMatchObject({ strict: true, inPlace: true, files: ["a"] });
	expect(parseRecodeArgs(["-f", "atascii", "--eol", "crlf"]).eol).toBe("crlf");
	expect(parseRecodeArgs(["-f", "ATASCII"]).from).toBe("atascii");
});

test("validates the argument list", () => {
	// Neither side named would mean unicode to unicode.
	expect(() => parseRecodeArgs(["a.txt"])).toThrow(
		/give --from \(-f\) or --to/,
	);
	expect(() => parseRecodeArgs(["-f", "petscii"])).toThrow(
		/unknown encoding "petscii"/,
	);
	expect(() => parseRecodeArgs(["-f", "atascii", "--eol", "cr"])).toThrow(
		/unknown --eol/,
	);
	expect(() => parseRecodeArgs(["-t", "atascii", "--in-place"])).toThrow(
		/--in-place needs the files/,
	);
});
