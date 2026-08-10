import { expect, test } from "vitest";
import { hexdumpLine, parseHexdumpArgs } from "./hexdump.ts";

test("parses files or a sector range, but not both", () => {
	expect(parseHexdumpArgs(["-i", "d.atr", "a.txt"])).toMatchObject({
		specs: ["a.txt"],
		sectors: undefined,
	});
	expect(parseHexdumpArgs(["-i", "d.atr", "-s", "361"]).sectors).toEqual({
		first: 361,
		last: 361,
	});
	expect(
		parseHexdumpArgs(["-i", "d.atr", "--sectors", "361-368"]).sectors,
	).toEqual({ first: 361, last: 368 });
	expect(() => parseHexdumpArgs(["-i", "d.atr", "a", "-s", "1"])).toThrow(
		/not both/,
	);
	expect(() => parseHexdumpArgs(["-i", "d.atr"])).toThrow(/missing a file/);
	expect(() => parseHexdumpArgs(["-i", "d.atr", "-s", "9-1"])).toThrow(
		/not a range/,
	);
	expect(() => parseHexdumpArgs(["-i", "d.atr", "-s", "x"])).toThrow(
		/takes a sector or a range/,
	);
});

test("a line is offset, hex, and what an Atari would show", () => {
	const line = hexdumpLine(0, Uint8Array.from([0x48, 0x49, 0x9b, 0x00]), false);
	// The glyph column is the point: xxd would render the last two as dots,
	// where these are the characters the machine displays.
	expect(line).toBe(
		"00000000  48 49 9b 00                                       |HI␛♥|\n",
	);
});

test("inverse video is shown in reverse video, where there is colour", () => {
	const inverse = Uint8Array.from([0xc1, 0xc2, 0x43]);
	expect(hexdumpLine(0, inverse, true)).toContain("\x1b[7mAB\x1b[0mC");
	// Without colour the glyphs still read; the hex column carries the truth.
	expect(hexdumpLine(0, inverse, false)).toContain("|ABC|");
});

test("a short last line pads the hex so the columns line up", () => {
	const short = hexdumpLine(0x10, Uint8Array.from([0x41]), false);
	expect(short.startsWith("00000010  41 ")).toBe(true);
	expect(short.endsWith("|A|\n")).toBe(true);
});
