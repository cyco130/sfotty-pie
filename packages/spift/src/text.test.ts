import { expect, test } from "vitest";
import { fromAtascii, recodeText, toAtascii } from "./text.ts";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const atascii = (...bytes: number[]) => Uint8Array.from(bytes);

test("printable codes, EOL, inverse video, and graphics", () => {
	const sample = atascii(
		0x48,
		0x49,
		0x9b, // HI, end of line
		0xc1,
		0xc2,
		0x9b, // inverse AB, end of line
		0x00,
		0x11, // heart, box corner
	);
	expect(fromAtascii(sample, false)).toBe("HI\n~AB~\n♥┌");
	// The escaped flavour spells the graphics as byte escapes instead, so a
	// terminal without the Atari font still shows something exact.
	expect(fromAtascii(sample, true)).toBe("HI\n~AB~\n{0}{17}");
});

test("both flavours round-trip every byte", () => {
	const every = Uint8Array.from({ length: 256 }, (_, code) => code);
	for (const escaped of [false, true]) {
		const spelled = fromAtascii(every, escaped);
		expect(toAtascii(spelled).bytes).toEqual(every);
	}
});

test("EOL is a line ending, not an inverse escape", () => {
	// $9b is the one high code that does not mean "the low code, inverse",
	// and it closes an open inverse run as it does on the Atari.
	expect(fromAtascii(atascii(0xc1, 0x9b, 0x42), false)).toBe("~A~\nB");
	expect(toAtascii("~A~\nB").bytes).toEqual(atascii(0xc1, 0x9b, 0x42));
});

test("line endings all become EOL, and --eol picks what comes back", () => {
	for (const ending of ["\n", "\r\n", "\r"]) {
		expect(toAtascii(`a${ending}b`).bytes).toEqual(atascii(0x61, 0x9b, 0x62));
	}
	expect(fromAtascii(atascii(0x41, 0x9b), false, "crlf")).toBe("A\r\n");
	expect(fromAtascii(atascii(0x41, 0x9b), false, "lf")).toBe("A\n");
});

test("escapes emit a byte, in decimal or hex, with or without the !", () => {
	for (const spelling of ["{155}", "{$9b}", "{$9B}", "{!155}", "{!$9b}"]) {
		expect(toAtascii(spelling).bytes).toEqual(atascii(0x9b));
	}
	// Not a well-formed escape, so the brace is just a character with no
	// ATASCII code.
	expect(
		text(
			recodeText(new TextEncoder().encode("{x}"), "unicode", "unicode").bytes,
		),
	).toBe("?x?");
});

test("what has no ATASCII character becomes ?", () => {
	const { bytes, diagnostics } = toAtascii("café `{}`");
	// "{}" is not a well-formed escape, so both braces are just characters
	// with no ATASCII code, as are the backticks and the accent.
	expect(text(recodeText(bytes, "atascii", "unicode").bytes)).toBe("caf? ????");
	expect(diagnostics).toHaveLength(5);
	expect(diagnostics[0]).toMatch(/"é" has no ATASCII character/);
});

test("strict refuses rather than substituting", () => {
	expect(() => toAtascii("café", { strict: true })).toThrow(/no ATASCII/);
	// A tilde in ordinary text opens inverse video and lets the line ending
	// close it - which round-trips, so only strict can catch it.
	expect(() => toAtascii("~mask;\n", { strict: true })).toThrow(
		/opens inverse video and the line ending closes it/,
	);
	expect(() => toAtascii("no tilde here\n", { strict: true })).not.toThrow();
	// Properly paired is what it is for, and stays legal.
	expect(() => toAtascii("~MENU~\n", { strict: true })).not.toThrow();
});

test("recodeText converts between the two Unicode flavours", () => {
	const source = new TextEncoder().encode("HI ♥");
	const escaped = recodeText(source, "unicode", "escaped-unicode");
	expect(text(escaped.bytes)).toBe("HI {0}");
	expect(
		text(recodeText(escaped.bytes, "escaped-unicode", "unicode").bytes),
	).toBe("HI ♥");
});
