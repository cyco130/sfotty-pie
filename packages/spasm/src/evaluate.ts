import type { Token } from "./lexer.ts";
import {
	getExpressionLocation,
	type BuiltinCall,
	type Expression,
	type InfixExpression,
	type MemberExpression,
	type PrefixExpression,
} from "./parser.ts";
import { SEP, type SymbolAttributes, type SymbolKind } from "./symbols.ts";
import { decodeStringLiteral, type Value } from "./value.ts";

export interface EvalEnv {
	/**
	 * Look up a symbol; `undefined` means "not resolved (yet)". `origin`, when
	 * present, is the module the identifier lexically binds to (stamped by macro
	 * expansion); otherwise the name resolves in the containing module.
	 */
	resolve(name: string, origin?: string): Value | undefined;
	/**
	 * A symbol's kind and placement attributes, for `.attributes()`/
	 * `.sizeof()`; `undefined` means the symbol isn't known (yet). Only
	 * label-kind symbols carry attributes - the evaluator enforces that.
	 */
	attributesOf(
		name: string,
		origin?: string,
	): { kind: SymbolKind; attributes: SymbolAttributes } | undefined;
	/** Value of `*` (the location counter), or `undefined` outside a section. */
	locationCounter: bigint | undefined;
	/** Report a hard error (type mismatch, divide-by-zero, bad escape). */
	report(message: string, span: readonly [number, number]): void;
	/**
	 * When set, an unresolved symbol is reported as undefined. The assemble loop
	 * turns this on so the final (converged) pass flags genuinely-missing names,
	 * while leaving it off for plain evaluation (where unresolved just defers).
	 */
	strict?: boolean;
}

/**
 * Evaluate an expression. Returns `undefined` if any part is unresolved (a
 * not-yet-defined symbol) or an error made it uncomputable - callers tell the
 * two apart by whether `report` fired. Reports may fire on non-final passes;
 * the assemble loop keeps only the final settled pass's diagnostics.
 */
export function evaluate(expr: Expression, env: EvalEnv): Value | undefined {
	switch (expr.type) {
		case "decimal":
			return BigInt(expr.text.replace(/_/g, ""));
		case "hexadecimal":
			return BigInt("0x" + expr.text.slice(1).replace(/_/g, ""));
		case "string":
			return decodeStringLiteral(expr.text, (escape) =>
				env.report(
					`Unknown escape sequence "\\${escape}"`,
					getExpressionLocation(expr),
				),
			);
		case "character": {
			const decoded = decodeStringLiteral(expr.text, (escape) =>
				env.report(
					`Unknown escape sequence "\\${escape}"`,
					getExpressionLocation(expr),
				),
			);
			// A character literal is a single byte in the target encoding (UTF-8
			// for now, like `.byte` strings), so multi-byte chars such as 'ü' fail.
			const bytes = new TextEncoder().encode(decoded);
			if (bytes.length !== 1) {
				env.report(
					"A character literal must be a single byte",
					getExpressionLocation(expr),
				);
				return undefined;
			}
			return BigInt(bytes[0]!);
		}
		case "identifier": {
			const value = env.resolve(expr.text, expr.origin);
			if (value === undefined && env.strict) {
				env.report(
					`Undefined symbol "${expr.text}"`,
					getExpressionLocation(expr),
				);
			}
			return value;
		}
		case "*":
			return env.locationCounter;
		case "grouped-expression":
			return evaluate(expr.expression, env);
		case "prefix-expression":
			return prefix(expr, env);
		case "infix-expression":
			return infix(expr, env);
		case "member-expression": {
			// `.attributes(X)::size` - member access on the attributes dict.
			const base = memberBase(expr);
			if (
				base.object.type === "builtin-call" &&
				base.object.keyword.type === "attributes"
			) {
				const bad = base.keys.find((k) => k.text !== "size");
				if (bad || base.keys.length !== 1) {
					const at = bad ?? base.keys[1]!;
					env.report(`Unknown attribute "${at.text}"`, [at.start, at.end]);
					return undefined;
				}
				return attributeValue(base.object, env);
			}
			// A dictionary path: `N::key` (chains for nested dicts). Entries live
			// in the symbol table under qualified names, so this is an ordinary
			// resolve with the joined key; the root's hygiene origin applies to
			// the whole path.
			const path = flattenPath(expr);
			if (!path) {
				env.report(
					"`::` requires a namespace name on its left",
					getExpressionLocation(expr),
				);
				return undefined;
			}
			const value = env.resolve(path.qualified, path.root.origin);
			if (value === undefined && env.strict) {
				env.report(
					`Undefined symbol "${path.display}"`,
					getExpressionLocation(expr),
				);
			}
			return value;
		}
		case "builtin-call":
			if (expr.keyword.type === "sizeof") {
				// `.sizeof(X)` is shorthand for `.attributes(X)::size`.
				return attributeValue(expr, env);
			}
			env.report(
				"`.attributes(...)` is a dictionary - access an attribute with `::`",
				getExpressionLocation(expr),
			);
			return undefined;
		case "dict-literal":
			env.report(
				"A dictionary literal can only be the right-hand side of a `=` definition",
				getExpressionLocation(expr),
			);
			return undefined;
	}
}

// The `size` attribute of the symbol named by an `.attributes`/`.sizeof`
// argument. Undeclared size reads as 0 (labels are 0-sized for now; `:=`
// equates bake a default of 1 at definition).
function attributeValue(call: BuiltinCall, env: EvalEnv): Value | undefined {
	const arg = call.argument;
	let name: string;
	let display: string;
	let origin: string | undefined;
	if (arg.type === "identifier") {
		name = display = arg.text;
		origin = arg.origin;
	} else if (arg.type === "member-expression") {
		const path = flattenPath(arg);
		if (!path) {
			env.report(
				"`.attributes()` takes a symbol name",
				getExpressionLocation(arg),
			);
			return undefined;
		}
		name = path.qualified;
		display = path.display;
		origin = path.root.origin;
	} else {
		env.report(
			"`.attributes()` takes a symbol name",
			getExpressionLocation(arg),
		);
		return undefined;
	}

	const info = env.attributesOf(name, origin);
	if (info === undefined) {
		if (env.strict) {
			env.report(`Undefined symbol "${display}"`, getExpressionLocation(arg));
		}
		return undefined;
	}
	if (info.kind !== "label") {
		env.report(
			`Only labels have attributes - "${display}" is a ${info.kind}`,
			getExpressionLocation(arg),
		);
		return undefined;
	}
	return "size" in info.attributes ? info.attributes.size : 0n;
}

// Collect a member chain's keys down to its base expression.
function memberBase(expr: MemberExpression): {
	object: Expression;
	keys: { text: string; start: number; end: number }[];
} {
	const keys = [
		{ text: expr.member.text, start: expr.member.start, end: expr.member.end },
	];
	let object = expr.object;
	while (object.type === "member-expression") {
		keys.unshift({
			text: object.member.text,
			start: object.member.start,
			end: object.member.end,
		});
		object = object.object;
	}
	return { object, keys };
}

// Flatten `A::B::C` to its root identifier and joined keys; undefined when the
// path doesn't bottom out at an identifier.
function flattenPath(
	expr: MemberExpression,
):
	| { root: Token<"identifier">; qualified: string; display: string }
	| undefined {
	const keys: string[] = [expr.member.text];
	let object = expr.object;
	while (object.type === "member-expression") {
		keys.unshift(object.member.text);
		object = object.object;
	}
	if (object.type !== "identifier") return undefined;
	keys.unshift(object.text);
	return {
		root: object,
		qualified: keys.join(SEP),
		display: keys.join("::"),
	};
}

/** Coerce an evaluated operand to a number, reporting if it's a string. */
function asNumber(
	value: Value | undefined,
	expr: Expression,
	env: EvalEnv,
): bigint | undefined {
	if (typeof value === "string") {
		env.report("Expected a number, got a string", getExpressionLocation(expr));
		return undefined;
	}
	return value; // bigint | undefined
}

function prefix(expr: PrefixExpression, env: EvalEnv): Value | undefined {
	const v = asNumber(evaluate(expr.expression, env), expr.expression, env);
	if (v === undefined) return undefined;
	switch (expr.operator.type) {
		case "+":
			return v;
		case "-":
			return -v;
		case "<":
			return v & 0xffn; // low byte
		case ">":
			return (v >> 8n) & 0xffn; // high byte
		case "!":
			return v === 0n ? 1n : 0n;
	}
}

function infix(expr: InfixExpression, env: EvalEnv): Value | undefined {
	const op = expr.operator.type;

	// Logical operators short-circuit, so they can resolve even when the right
	// side can't (e.g. `0 && forward_ref`).
	if (op === "&&" || op === "||") {
		const l = asNumber(evaluate(expr.left, env), expr.left, env);
		if (l === undefined) return undefined;
		if (op === "&&" && l === 0n) return 0n;
		if (op === "||" && l !== 0n) return 1n;
		const r = asNumber(evaluate(expr.right, env), expr.right, env);
		if (r === undefined) return undefined;
		return r === 0n ? 0n : 1n;
	}

	const l = asNumber(evaluate(expr.left, env), expr.left, env);
	const r = asNumber(evaluate(expr.right, env), expr.right, env);
	if (l === undefined || r === undefined) return undefined;

	switch (op) {
		case "*":
			return l * r;
		case "/":
		case "%":
			if (r === 0n) {
				env.report(
					op === "/" ? "Division by zero" : "Modulo by zero",
					getExpressionLocation(expr.right),
				);
				return undefined;
			}
			return op === "/" ? l / r : l % r;
		case "+":
			return l + r;
		case "-":
			return l - r;
		case "=":
			return l === r ? 1n : 0n;
		case "!=":
			return l !== r ? 1n : 0n;
		case "<":
			return l < r ? 1n : 0n;
		case ">":
			return l > r ? 1n : 0n;
	}
}
