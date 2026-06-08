import { describe, test, expect } from "vitest";
import { parse } from "./parser.ts";
import { SourceFile } from "./source-file.ts";
import type {
	Byte,
	Expression,
	Operand,
	Statement,
	StatementContent,
} from "./parser.ts";

// Serialize the AST back to a source-like form, with grouping shown as [ ... ]
// and infix nesting fully parenthesized, so precedence/shape is visible in tests.
function expr(e: Expression): string {
	switch (e.type) {
		case "infix-expression":
			return `(${expr(e.left)} ${e.operator.text} ${expr(e.right)})`;
		case "prefix-expression":
			return `${e.operator.text}${expr(e.expression)}`;
		case "grouped-expression":
			return `[${expr(e.expression)}]`;
		case "member-expression":
			return `${expr(e.object)}::${e.member.text}`;
		default:
			return e.text;
	}
}

function operand(o: Operand): string {
	switch (o.type) {
		case "accumulator-operand":
			return o.accumulatorToken.text;
		case "immediate-operand":
			return `#${expr(o.expression)}`;
		case "simple-operand":
			return expr(o.expression);
		case "indexed-operand":
			return `${expr(o.expression)},${o.register.text}`;
		case "indirect-operand":
			return `(${expr(o.expression)})`;
		case "indexed-indirect-operand":
			return `(${expr(o.expression)},${o.register.text})`;
		case "indirect-indexed-operand":
			return `(${expr(o.expression)}),${o.register.text}`;
	}
}

function list(items: Byte["list"]): string {
	return items.map(([e, comma]) => expr(e) + (comma ? "," : "")).join(" ");
}

function content(c: StatementContent): string {
	switch (c.type) {
		case "instruction":
			return c.operand
				? `${c.mnemonic.text} ${operand(c.operand)}`
				: c.mnemonic.text;
		case "assignment":
			return `${c.identifier.text} ${c.operatorToken.text} ${expr(c.expression)}`;
		case "org":
			return `.org ${expr(c.expression)}`;
		case "byte":
			return `.byte ${list(c.list)}`;
		case "word":
			return `.word ${list(c.list)}`;
		case "define-segment":
			return `.define_segment ${c.nameToken.text}`;
		case "segment":
			return `.segment ${c.nameToken.text}`;
		case "emit":
			return `.emit ${c.nameToken.text}`;
		case "emplace":
			return `.emplace ${c.nameToken.text}`;
		case "import":
			return `.import ${c.specToken.text}`;
		case "export":
			return `.export ${content(c.content)}`;
		case "global":
			return `.global ${c.nameToken.text}`;
	}
}

function stmt(s: Statement): string {
	const labels = s.labels.map((l) => `${l.identifier.text}:`).join(" ");
	const body = s.content ? content(s.content) : "";
	return [labels, body].filter((x) => x).join(" ");
}

/** Parse, assert no errors, and return the statements. */
function parseOk(src: string): Statement[] {
	const { module, errors } = parse(new SourceFile("t", src));
	expect(errors).toEqual([]);
	return module.statements;
}

/** Parse and dump each statement to its source-like form (no-error path). */
function dump(src: string): string[] {
	return parseOk(src).map(stmt);
}

describe("statements", () => {
	test("labels (single, multiple, label-only line)", () => {
		expect(dump("foo:\nbar: baz: nop")).toEqual(["foo:", "bar: baz: nop"]);
	});

	test("assignment with = (constant) and := (label)", () => {
		expect(dump("FOO = $1234")).toEqual(["FOO = $1234"]);
		expect(dump("EXIT := $0200")).toEqual(["EXIT := $0200"]);
		const [s] = parseOk("EXIT := $0200");
		expect(s!.content).toMatchObject({ operatorToken: { type: ":=" } });
	});

	test("blank lines are empty statements", () => {
		expect(dump("\n\nnop\n")).toEqual(["", "", "nop"]);
	});

	test("a final line needs no trailing newline", () => {
		const [s] = parseOk("nop");
		expect(s!.newline).toBeNull();
	});
});

describe("operands", () => {
	test("every addressing form", () => {
		expect(
			dump(
				[
					"nop", // implied
					"asl a", // accumulator
					"lda #$10", // immediate
					"lda $1234", // absolute / simple
					"lda $12,x", // indexed X
					"lda $12,y", // indexed Y
					"jmp (foo)", // indirect
					"lda (foo,x)", // indexed-indirect
					"lda (foo),y", // indirect-indexed
					"lda (foo),x", // grouped value, absolute X (NOT indirect)
					"jmp (sym + 2) * 2", // grouped value with a tail
					"jmp (sym + 2) * 2, x", // grouped value with a tail, indexed
				].join("\n"),
			),
		).toEqual([
			"nop",
			"asl a",
			"lda #$10",
			"lda $1234",
			"lda $12,x",
			"lda $12,y",
			"jmp (foo)",
			"lda (foo,x)",
			"lda (foo),y",
			"lda [foo],x",
			"jmp ([(sym + 2)] * 2)",
			"jmp ([(sym + 2)] * 2),x",
		]);
	});
});

describe("expression precedence and associativity", () => {
	test("multiplicative binds tighter than additive", () => {
		expect(dump("lda #p + q * r")).toEqual(["lda #(p + (q * r))"]);
		expect(dump("lda #p * q + r")).toEqual(["lda #((p * q) + r)"]);
	});

	test("&& binds tighter than ||", () => {
		expect(dump("lda #p && q || r")).toEqual(["lda #((p && q) || r)"]);
		expect(dump("lda #p || q && r")).toEqual(["lda #(p || (q && r))"]);
	});

	test("comparison binds looser than additive", () => {
		expect(dump("lda #p = q + r")).toEqual(["lda #(p = (q + r))"]);
	});

	test("binary operators are left-associative", () => {
		expect(dump("lda #p - q - r")).toEqual(["lda #((p - q) - r)"]);
	});

	test("grouping overrides precedence", () => {
		expect(dump("lda #(p + q) * r")).toEqual(["lda #([(p + q)] * r)"]);
	});

	test("prefix operators", () => {
		expect(dump("lda #<foo")).toEqual(["lda #<foo"]);
		expect(dump("lda #-1")).toEqual(["lda #-1"]);
	});

	test("primaries: identifier, decimal, hex, string, location counter", () => {
		expect(dump("FOO = 42")).toEqual(["FOO = 42"]);
		expect(dump("FOO = $2a")).toEqual(["FOO = $2a"]);
		expect(dump('FOO = "hi"')).toEqual(['FOO = "hi"']);
		expect(dump("FOO = *")).toEqual(["FOO = *"]);
	});
});

describe("directives", () => {
	test("org", () => {
		expect(dump(".org $0400")).toEqual([".org $0400"]);
	});

	test("byte / word lists", () => {
		expect(dump('.byte "hi", $0a, 0')).toEqual(['.byte "hi", $0a, 0']);
		expect(dump(".word foo, bar")).toEqual([".word foo, bar"]);
	});

	test("segment directives", () => {
		expect(dump('.define_segment "CODE"')).toEqual(['.define_segment "CODE"']);
		expect(dump('.segment "CODE"')).toEqual(['.segment "CODE"']);
		expect(dump('.emit "CODE"')).toEqual(['.emit "CODE"']);
		expect(dump('.emplace "BSS"')).toEqual(['.emplace "BSS"']);
	});

	test("a segment directive needs a string name", () => {
		const { errors } = parse(new SourceFile("t", ".segment CODE\n"));
		expect(errors).toHaveLength(1);
	});

	test("module directives", () => {
		expect(dump('.import "./lib.s"')).toEqual(['.import "./lib.s"']);
		expect(dump(".global start")).toEqual([".global start"]);
		expect(dump(".export EXIT := $0200")).toEqual([".export EXIT := $0200"]);
	});

	test("scope resolution with ::", () => {
		expect(dump("sym := .global::start")).toEqual(["sym := .global::start"]);
		expect(dump("lda #foo::bar")).toEqual(["lda #foo::bar"]);
	});

	test("trailing comma is accepted and preserved", () => {
		const [s] = parseOk(".byte 1,");
		const c = s!.content;
		expect(c?.type).toBe("byte");
		if (c?.type === "byte") {
			expect(c.list).toHaveLength(1);
			expect(c.list[0]![1]).toBeDefined(); // the trailing comma token
		}
		expect(dump(".byte 1,")).toEqual([".byte 1,"]);
	});
});

describe("error recovery", () => {
	test("a bad line is reported and parsing recovers on the next", () => {
		const { module, errors } = parse(new SourceFile("t", "lda (\nnop\n"));
		expect(errors).toHaveLength(1);
		expect(errors[0]!.message).toBe("Expression expected");
		expect(module.statements.map(stmt)).toEqual(["nop"]);
	});

	test("recovery can run to EOF (final line, no newline)", () => {
		const { module, errors } = parse(new SourceFile("t", "lda ("));
		expect(errors).toHaveLength(1);
		expect(module.statements).toEqual([]);
	});
});

describe("trivia (formatter raw material)", () => {
	test("comments are captured as trivia on the surrounding tokens", () => {
		const [s] = parseOk("nop ; trailing\n");
		const c = s!.content;
		expect(c?.type).toBe("instruction");
		if (c?.type === "instruction") {
			const after = c.mnemonic.after ?? [];
			expect(
				after.some((t) => t.type === "comment" && t.text === "; trailing"),
			).toBe(true);
		}
	});
});
