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
	test("without showLine, just the file:line:col header", () => {
		const sf = new SourceFile("f.s", "abc\ndef");
		expect(sf.formatMessage(4, 7, "error", "SP2001", "oops")).toBe(
			"f.s:2:1 - error SP2001: oops",
		);
	});

	test("with showLine, a gutter-prefixed excerpt and a squiggle marker", () => {
		const sf = new SourceFile("f.s", "abc\ndef");
		expect(
			sf.formatMessage(4, 5, "error", "SP2001", "bad", { showLine: true }),
		).toBe("f.s:2:1 - error SP2001: bad\n\n2 def\n  ~");
	});

	test("one squiggle per byte of the span", () => {
		const sf = new SourceFile("f.s", "abcdef");
		expect(
			sf.formatMessage(0, 3, "error", "SP2001", "x", { showLine: true }),
		).toBe("f.s:1:1 - error SP2001: x\n\n1 abcdef\n  ~~~");
	});

	test("tabs in the indent are reproduced in the marker line", () => {
		const sf = new SourceFile("f.s", "\tlda");
		expect(
			sf.formatMessage(1, 4, "error", "SP2001", "y", { showLine: true }),
		).toBe("f.s:1:2 - error SP2001: y\n\n1 \tlda\n  \t~~~");
	});

	test("a newline token points at the end of the line it terminates", () => {
		const lf = new SourceFile("f.s", "ab\ncd");
		expect(
			lf.formatMessage(2, 3, "error", "SP2001", "nl", { showLine: true }),
		).toBe("f.s:1:3 - error SP2001: nl\n\n1 ab\n    ~");

		// CRLF is two bytes but shows one squiggle (clamped to the line end), so
		// it reads the same as LF rather than the confusing "~~".
		const crlf = new SourceFile("f.s", "ab\r\ncd");
		expect(
			crlf.formatMessage(2, 4, "error", "SP2001", "nl", { showLine: true }),
		).toBe("f.s:1:3 - error SP2001: nl\n\n1 ab\n    ~");
	});

	test("shortName defaults to id but overrides it when given", () => {
		expect(
			new SourceFile("long/path/f.s", "x").formatMessage(
				0,
				1,
				"error",
				"SP2001",
				"m",
			),
		).toBe("long/path/f.s:1:1 - error SP2001: m");
		expect(
			new SourceFile("id", "x", "f.s").formatMessage(
				0,
				1,
				"error",
				"SP2001",
				"m",
			),
		).toBe("f.s:1:1 - error SP2001: m");
	});

	test("color mode paints file, position, kind, gutter, and squiggles", () => {
		const sf = new SourceFile("f.s", "abcdef");
		const out = sf.formatMessage(0, 3, "error", "SP2001", "x", {
			showLine: true,
			color: true,
		});
		expect(out).toContain("\x1b[36mf.s\x1b[0m"); // file: cyan
		expect(out).toContain("\x1b[33m1:1\x1b[0m"); // line:col: yellow
		expect(out).toContain("\x1b[31merror SP2001\x1b[0m: x"); // kind + code: red
		expect(out).toContain("\x1b[7m1\x1b[0m abcdef"); // gutter: inverse
		expect(out).toContain("\x1b[7m \x1b[0m \x1b[31m~~~\x1b[0m"); // marker
	});

	test("the note kind paints gray", () => {
		const sf = new SourceFile("f.s", "abc");
		const out = sf.formatMessage(0, 1, "note", undefined, "n", { color: true });
		expect(out).toContain("\x1b[90mnote\x1b[0m: n");
	});
});
