import { describe, test, expect } from "vitest";
import { Lexer, DOT_KEYWORDS, type Token } from "./lexer.ts";

/** Lex `src` to completion, including the trailing `eof` token. */
function tokens(src: string): Token[] {
	const lx = new Lexer(src);
	const out: Token[] = [];
	for (;;) {
		const t = lx.next();
		out.push(t);
		if (t.type === "eof") return out;
	}
}

const TRIVIA = new Set<string>(["whitespace", "comment", "newline"]);

/** `[type, text]` pairs, dropping trivia and the `eof`. */
function code(src: string): Array<[string, string]> {
	return tokens(src)
		.filter((t) => t.type !== "eof" && !TRIVIA.has(t.type))
		.map((t) => [t.type, t.text]);
}

/** Assert `src` is a single token (+ eof) and return its type. */
function one(src: string): string {
	const ts = tokens(src);
	expect(ts.map((t) => t.text)).toEqual([src, ""]);
	return ts[0]!.type;
}

describe("single tokens", () => {
	test("delimiters", () => {
		expect(tokens("")).toEqual([{ type: "eof", text: "", start: 0, end: 0 }]);
		expect(one("\n")).toBe("newline");
		expect(one("\r\n")).toBe("newline");
		expect(one("\r")).toBe("newline");
		expect(one("   \t ")).toBe("whitespace");
		expect(one("; a comment")).toBe("comment");
	});

	test("identifiers and numbers", () => {
		expect(one("foo")).toBe("identifier");
		expect(one("_x9")).toBe("identifier");
		expect(one("123")).toBe("decimal");
		expect(one("1_000")).toBe("decimal");
		expect(one("$ff")).toBe("hexadecimal");
		expect(one("$0A_F0")).toBe("hexadecimal");
	});

	test("string and character literals", () => {
		expect(one('"hi"')).toBe("string");
		expect(one('"with \\" escape"')).toBe("string");
		expect(one("'a'")).toBe("character");
		expect(one("'\\n'")).toBe("character");
	});

	test("punctuation", () => {
		const expected: Array<[string, string]> = [
			["||", "||"],
			["&&", "&&"],
			["!=", "!="],
			["#", "#"],
			["(", "("],
			[")", ")"],
			[",", ","],
			[":", ":"],
			["=", "="],
			["!", "!"],
			["<", "<"],
			[">", ">"],
			["+", "+"],
			["-", "-"],
			["*", "*"],
			["/", "/"],
			["%", "%"],
		];
		for (const [text, type] of expected) {
			expect(one(text)).toBe(type);
		}
	});
});

describe("registers vs identifiers", () => {
	test("standalone a/x/y are registers", () => {
		expect(one("a")).toBe("a");
		expect(one("x")).toBe("x");
		expect(one("y")).toBe("y");
	});

	test("registers are case-insensitive but keep their text", () => {
		const [t] = tokens("X");
		expect(t).toMatchObject({ type: "x", text: "X" });
	});

	test("a register name is only a register on its own", () => {
		expect(one("xy")).toBe("identifier");
		expect(one("axe")).toBe("identifier");
		expect(one("x1")).toBe("identifier");
		expect(one("a_")).toBe("identifier");
	});

	test("mnemonics lex as plain identifiers (reserved-ness is the parser's job)", () => {
		expect(one("lda")).toBe("identifier");
		expect(one("LDA")).toBe("identifier");
	});
});

describe("dotted keywords", () => {
	test("each keyword lexes to its own type", () => {
		for (const kw of DOT_KEYWORDS) {
			expect(one("." + kw)).toBe(kw);
		}
	});

	test("dotted keywords are case-insensitive", () => {
		expect(one(".BYTE")).toBe("byte");
		expect(one(".Org")).toBe("org");
	});

	test("an unknown dotted word is error:keyword, not a silent split", () => {
		expect(one(".bytes")).toBe("error:keyword");
		expect(one(".foo")).toBe("error:keyword");
	});

	test("a lone dot is an error", () => {
		expect(one(".")).toBe("error");
	});
});

describe("error recovery", () => {
	test("unterminated string and character", () => {
		expect(one('"abc')).toBe("error:string");
		expect(one("'a")).toBe("error:character");
	});

	test("unknown bytes become single-char error tokens", () => {
		expect(code("@@")).toEqual([
			["error", "@"],
			["error", "@"],
		]);
	});

	test("string/char literals are single-line; recovery stops at the break", () => {
		// The unterminated literal must not swallow the following line.
		expect(code('"abc\nfoo')).toEqual([
			["error:string", '"abc'],
			["identifier", "foo"],
		]);
		expect(code("'a\nfoo")).toEqual([
			["error:character", "'a"],
			["identifier", "foo"],
		]);
	});

	// Regression: the newline pattern's `\r\n?` branch must stay anchored in the
	// big regex, or an unmatched byte before a CRLF mis-tokenizes as a newline.
	test("unmatched byte before CRLF stays an error at the right span", () => {
		const ts = tokens("@\r\nfoo");
		expect(ts.map((t) => [t.type, t.text, t.start])).toEqual([
			["error", "@", 0],
			["newline", "\r\n", 1],
			["identifier", "foo", 3],
			["eof", "", 6],
		]);
	});
});

describe("hello.s", () => {
	// Inlined (not read from notes.local/) so the test stays self-contained.
	const HELLO = `EXIT = $0200
STDOUT = $0202

; Header
.byte "SFOTTY", 0, 0, 0, 0

; Vectors
.word 0       ; NMI (unused)
.word start   ; reset / entry
.word 0       ; IRQ (unused)

.org $0400
message:
\t.byte "Hello world!", $0a, 0

start:
\tldx #0
loop:
\tlda message,x
\tbeq end
\tsta STDOUT
\tinx
\tjmp loop
end:
\tsta EXIT
`;

	test("lexes with no error tokens", () => {
		const bad = tokens(HELLO).filter(
			(t) => t.type === "error" || t.type.startsWith("error:"),
		);
		expect(bad).toEqual([]);
	});

	test("significant token stream", () => {
		expect(code(HELLO)).toEqual([
			["identifier", "EXIT"],
			["=", "="],
			["hexadecimal", "$0200"],
			["identifier", "STDOUT"],
			["=", "="],
			["hexadecimal", "$0202"],
			["byte", ".byte"],
			["string", '"SFOTTY"'],
			[",", ","],
			["decimal", "0"],
			[",", ","],
			["decimal", "0"],
			[",", ","],
			["decimal", "0"],
			[",", ","],
			["decimal", "0"],
			["word", ".word"],
			["decimal", "0"],
			["word", ".word"],
			["identifier", "start"],
			["word", ".word"],
			["decimal", "0"],
			["org", ".org"],
			["hexadecimal", "$0400"],
			["identifier", "message"],
			[":", ":"],
			["byte", ".byte"],
			["string", '"Hello world!"'],
			[",", ","],
			["hexadecimal", "$0a"],
			[",", ","],
			["decimal", "0"],
			["identifier", "start"],
			[":", ":"],
			["identifier", "ldx"],
			["#", "#"],
			["decimal", "0"],
			["identifier", "loop"],
			[":", ":"],
			["identifier", "lda"],
			["identifier", "message"],
			[",", ","],
			["x", "x"],
			["identifier", "beq"],
			["identifier", "end"],
			["identifier", "sta"],
			["identifier", "STDOUT"],
			["identifier", "inx"],
			["identifier", "jmp"],
			["identifier", "loop"],
			["identifier", "end"],
			[":", ":"],
			["identifier", "sta"],
			["identifier", "EXIT"],
		]);
	});
});
