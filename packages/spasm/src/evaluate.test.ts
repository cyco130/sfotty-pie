import { describe, test, expect } from "vitest";
import { parse, type Assignment } from "./parser.ts";
import { SourceFile } from "./source-file.ts";
import { evaluate, type EvalEnv } from "./evaluate.ts";
import type { Value } from "./value.ts";

interface Opts {
	symbols?: Record<string, Value>;
	pc?: bigint;
}

// Parse `src` as the RHS of an assignment, evaluate it, return value + reports.
function evalSrc(
	src: string,
	opts: Opts = {},
): { value: Value | undefined; reports: string[] } {
	const { module, errors } = parse(new SourceFile("t", `_ = ${src}`));
	expect(errors).toEqual([]);
	const content = module.statements[0]!.content as Assignment;
	const reports: string[] = [];
	const env: EvalEnv = {
		resolve: (name) => opts.symbols?.[name],
		locationCounter: opts.pc,
		report: (message) => reports.push(message),
	};
	return { value: evaluate(content.expression, env), reports };
}

// Evaluate and assert no errors were reported.
function val(src: string, opts?: Opts): Value | undefined {
	const { value, reports } = evalSrc(src, opts);
	expect(reports).toEqual([]);
	return value;
}

describe("literals", () => {
	test("integers (decimal, hex, underscores)", () => {
		expect(val("42")).toBe(42n);
		expect(val("1_000")).toBe(1000n);
		expect(val("$ff")).toBe(255n);
		expect(val("$0a")).toBe(10n);
		expect(val("$DE_AD")).toBe(0xdeadn);
	});

	test("strings and escapes", () => {
		expect(val('"hi"')).toBe("hi");
		expect(val('"a\\"b"')).toBe('a"b'); // embedded escaped quote
		expect(val('"x\\ny"')).toBe("x\ny"); // \n -> newline
	});

	test("character literals", () => {
		expect(val("'A'")).toBe(65n);
		expect(val("' '")).toBe(32n);
		expect(val("'\\n'")).toBe(10n);
	});

	test("a character literal must be a single byte", () => {
		const oneByte = {
			value: undefined,
			reports: ["A character literal must be a single byte"],
		};
		expect(evalSrc("'ab'")).toEqual(oneByte); // multiple characters
		expect(evalSrc("'ü'")).toEqual(oneByte); // one codepoint, two UTF-8 bytes
	});
});

describe("symbols and location counter", () => {
	test("symbols resolve via env", () => {
		expect(val("foo + 1", { symbols: { foo: 10n } })).toBe(11n);
		expect(val("foo", { symbols: { foo: 0x1234n } })).toBe(0x1234n);
	});

	test("an unresolved symbol is undefined (not an error)", () => {
		expect(evalSrc("foo")).toEqual({ value: undefined, reports: [] });
	});

	test("location counter `*`", () => {
		expect(val("* + 2", { pc: 0x0400n })).toBe(0x0402n);
	});
});

describe("arithmetic, precedence, associativity", () => {
	test("precedence and grouping", () => {
		expect(val("2 + 3 * 4")).toBe(14n);
		expect(val("(2 + 3) * 4")).toBe(20n);
	});

	test("left-associativity and truncating division", () => {
		expect(val("10 - 3 - 2")).toBe(5n);
		expect(val("7 / 2")).toBe(3n);
		expect(val("7 % 2")).toBe(1n);
		expect(val("-5")).toBe(-5n);
	});
});

describe("comparison, logical, prefix", () => {
	test("comparisons yield 1 or 0", () => {
		expect(val("3 < 5")).toBe(1n);
		expect(val("5 < 3")).toBe(0n);
		expect(val("3 = 3")).toBe(1n);
		expect(val("3 != 3")).toBe(0n);
	});

	test("logical operators short-circuit", () => {
		expect(val("0 && foo")).toBe(0n); // foo never evaluated
		expect(val("1 || foo")).toBe(1n);
		expect(val("1 && 2")).toBe(1n);
		expect(val("5 || 0")).toBe(1n);
		expect(evalSrc("1 && foo").value).toBeUndefined(); // foo needed, unresolved
	});

	test("lo/hi byte and logical not", () => {
		expect(val("<$1234")).toBe(0x34n);
		expect(val(">$1234")).toBe(0x12n);
		expect(val("!0")).toBe(1n);
		expect(val("!5")).toBe(0n);
	});
});

describe("errors", () => {
	test("division and modulo by zero", () => {
		expect(evalSrc("1 / 0")).toEqual({
			value: undefined,
			reports: ["Division by zero"],
		});
		expect(evalSrc("1 % 0")).toEqual({
			value: undefined,
			reports: ["Modulo by zero"],
		});
	});

	test("a string in arithmetic is a type error", () => {
		expect(evalSrc('"a" + 1')).toEqual({
			value: undefined,
			reports: ["Expected a number, got a string"],
		});
	});

	test("unknown escape is reported but kept verbatim", () => {
		expect(evalSrc('"\\q"')).toEqual({
			value: "q",
			reports: ['Unknown escape sequence "\\q"'],
		});
	});
});

describe("unresolved propagation", () => {
	test("an unresolved operand makes the whole expression undefined", () => {
		expect(evalSrc("foo + 1")).toEqual({ value: undefined, reports: [] });
		expect(evalSrc("foo * (1 + 2)")).toEqual({ value: undefined, reports: [] });
	});
});
