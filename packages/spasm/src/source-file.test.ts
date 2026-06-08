import { describe, test, expect } from "vitest";
import { SourceFile } from "./source-file.ts";

describe("getLocation", () => {
	test("columns on a single line", () => {
		const sf = new SourceFile("f", "abcdef");
		expect(sf.getLocation(0, 1)).toMatchObject({
			startLine: 1,
			startColumn: 1,
		});
		expect(sf.getLocation(3, 4)).toMatchObject({
			startLine: 1,
			startColumn: 4,
		});
	});

	test("LF line breaks advance the line and reset the column", () => {
		const sf = new SourceFile("f", "abc\ndef\nghi");
		expect(sf.getLocation(4, 5)).toMatchObject({
			startLine: 2,
			startColumn: 1,
			lineStart: 4,
		});
		expect(sf.getLocation(6, 7)).toMatchObject({
			startLine: 2,
			startColumn: 3,
		});
		expect(sf.getLocation(8, 9)).toMatchObject({
			startLine: 3,
			startColumn: 1,
			lineStart: 8,
		});
	});

	test("CRLF is one break and the column skips the \\r", () => {
		const sf = new SourceFile("f", "ab\r\ncd");
		expect(sf.getLocation(1, 2)).toMatchObject({
			startLine: 1,
			startColumn: 2,
		});
		expect(sf.getLocation(4, 5)).toMatchObject({
			startLine: 2,
			startColumn: 1,
			lineStart: 4,
		});
	});

	test("a lone \\r is a line break", () => {
		const sf = new SourceFile("f", "ab\rcd");
		expect(sf.getLocation(3, 4)).toMatchObject({
			startLine: 2,
			startColumn: 1,
		});
	});

	// Regression: a token starting on the \r of a CRLF must map to the end of the
	// line it terminates (line N), not fall back to the start of line N+1.
	test("token starting on a CRLF \\r maps to end of its line", () => {
		const sf = new SourceFile("f", "ab\r\ncd");
		expect(sf.getLocation(2, 4)).toMatchObject({
			startLine: 1,
			startColumn: 3,
		});
	});

	test("a zero-width span at EOF resolves to the end position", () => {
		const sf = new SourceFile("f", "abc");
		expect(sf.getLocation(3, 3)).toEqual({
			startLine: 1,
			startColumn: 4,
			endLine: 1,
			endColumn: 4,
			lineStart: 0,
		});
	});

	test("a multi-line span tracks end separately from start", () => {
		const sf = new SourceFile("f", "abc\ndef");
		expect(sf.getLocation(1, 7)).toMatchObject({
			startLine: 1,
			startColumn: 2,
			endLine: 2,
			endColumn: 4,
		});
	});
});

describe("formatMessage", () => {
	test("without showLine, just file:line:col: message", () => {
		const sf = new SourceFile("f.s", "abc\ndef");
		expect(sf.formatMessage(4, 7, "oops")).toBe("f.s:2:1: oops");
	});

	test("with showLine, underlines the token", () => {
		const sf = new SourceFile("f.s", "abc\ndef");
		expect(sf.formatMessage(4, 5, "bad", true)).toBe("f.s:2:1: bad\ndef\n^");
	});

	test("one caret per byte of the span", () => {
		const sf = new SourceFile("f.s", "abcdef");
		expect(sf.formatMessage(0, 3, "x", true)).toBe("f.s:1:1: x\nabcdef\n^^^");
	});

	test("tabs in the indent are reproduced in the pointer", () => {
		const sf = new SourceFile("f.s", "\tlda");
		expect(sf.formatMessage(1, 4, "y", true)).toBe("f.s:1:2: y\n\tlda\n\t^^^");
	});

	test("a newline token points at the end of the line it terminates", () => {
		const lf = new SourceFile("f.s", "ab\ncd");
		expect(lf.formatMessage(2, 3, "nl", true)).toBe("f.s:1:3: nl\nab\n  ^");

		// CRLF is two bytes but shows one caret (clamped to the line end), so it
		// reads the same as LF rather than the confusing "^^".
		const crlf = new SourceFile("f.s", "ab\r\ncd");
		expect(crlf.formatMessage(2, 4, "nl", true)).toBe("f.s:1:3: nl\nab\n  ^");
	});

	test("shortName defaults to id but overrides it when given", () => {
		expect(new SourceFile("long/path/f.s", "x").formatMessage(0, 1, "m")).toBe(
			"long/path/f.s:1:1: m",
		);
		expect(new SourceFile("id", "x", "f.s").formatMessage(0, 1, "m")).toBe(
			"f.s:1:1: m",
		);
	});
});
