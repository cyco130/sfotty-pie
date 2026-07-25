import { Codes } from "./codes.ts";
import type { Token } from "./lexer.ts";
import {
	getExpressionLocation,
	type Expression,
	type InfixExpression,
	type MemberExpression,
	type MessageNote,
	type PrefixExpression,
} from "./parser.ts";
import { SEP } from "./symbols.ts";
import { decodeStringLiteral, type Value } from "./value.ts";

export interface EvalEnv {
	/**
	 * Look up a symbol; `undefined` means "not resolved (yet)". `origin`, when
	 * present, is the module the identifier lexically binds to (stamped by macro
	 * expansion); otherwise the name resolves in the containing module.
	 */
	resolve(name: string, origin?: string): Value | undefined;
	/** Value of `*` (the location counter), or `undefined` outside a section. */
	locationCounter: bigint | undefined;
	/**
	 * Report a hard error (type mismatch, divide-by-zero, bad escape). `file`
	 * overrides the module the span refers into - hygiene-stamped tokens point
	 * into their defining module's source. `options.symbol` carries the
	 * qualified symbol name on symbol-related diagnostics.
	 */
	report(
		code: string,
		message: string,
		span: readonly [number, number],
		file?: string,
		options?: { notes?: MessageNote[]; symbol?: string },
	): void;
	/**
	 * When set, an unresolved symbol is reported as undefined. The assemble loop
	 * turns this on so the final (converged) pass flags genuinely-missing names,
	 * while leaving it off for plain evaluation (where unresolved just defers).
	 */
	strict?: boolean;
	/** Function-application nesting depth, for the recursion cap. */
	depth?: number;
}

const MAX_APPLICATION_DEPTH = 64;

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
		case "binary":
			return BigInt("0b" + expr.text.slice(1).replace(/_/g, ""));
		case "string":
			return decodeStringLiteral(expr.text, (escape) =>
				env.report(
					Codes.UnknownEscape,
					`Unknown escape sequence "\\${escape}"`,
					getExpressionLocation(expr),
				),
			);
		case "character": {
			const decoded = decodeStringLiteral(expr.text, (escape) =>
				env.report(
					Codes.UnknownEscape,
					`Unknown escape sequence "\\${escape}"`,
					getExpressionLocation(expr),
				),
			);
			// A character literal is a single byte in the target encoding (UTF-8
			// for now, like `.byte` strings), so multi-byte chars such as 'ü' fail.
			const bytes = new TextEncoder().encode(decoded);
			if (bytes.length !== 1) {
				env.report(
					Codes.CharacterNotSingleByte,
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
					Codes.UndefinedSymbol,
					`Undefined symbol "${expr.text}"`,
					getExpressionLocation(expr),
					expr.origin,
					{ symbol: expr.text },
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
			// A dictionary path: `N::key` (chains for nested dicts). Entries live
			// in the symbol table under qualified names, so this is an ordinary
			// resolve with the joined key; the root's hygiene origin applies to
			// the whole path.
			const path = flattenPath(expr);
			if (!path) {
				env.report(
					Codes.ScopeResolutionOnValue,
					"`::` requires a namespace name on its left",
					getExpressionLocation(expr),
				);
				return undefined;
			}
			const value = env.resolve(path.qualified, path.root.origin);
			if (value === undefined && env.strict) {
				env.report(
					Codes.UndefinedSymbol,
					`Undefined symbol "${path.display}"`,
					getExpressionLocation(expr),
					path.root.origin,
					{ symbol: path.qualified },
				);
			}
			return value;
		}
		case "call-expression": {
			const fn = evaluate(expr.callee, env);
			if (fn === undefined) return undefined; // unresolved; strict reported
			if (typeof fn !== "object" || fn.type !== "function") {
				env.report(
					Codes.NotAFunction,
					`${calleeName(expr.callee)} is not a function`,
					getExpressionLocation(expr.callee),
				);
				return undefined;
			}
			if (expr.args.length !== fn.params.length) {
				env.report(
					Codes.FunctionArity,
					`${calleeName(expr.callee)} expects ${fn.params.length} argument(s), got ${expr.args.length}`,
					getExpressionLocation(expr),
				);
				return undefined;
			}
			const depth = (env.depth ?? 0) + 1;
			if (depth > MAX_APPLICATION_DEPTH) {
				env.report(
					Codes.ApplicationTooDeep,
					"Expression macro application too deep (recursion?)",
					getExpressionLocation(expr),
				);
				return undefined;
			}
			// Eager arguments, evaluated in the caller's scope; the body's free
			// names default to the defining module (lexical hygiene) by forcing
			// the origin - params shadow via the bindings overlay.
			const bindings = new Map<string, Value | undefined>();
			fn.params.forEach((param, i) => {
				bindings.set(param, evaluate(expr.args[i]!, env));
			});
			const inner: EvalEnv = {
				resolve: (name, origin) =>
					origin === undefined && bindings.has(name)
						? bindings.get(name)
						: env.resolve(name, origin ?? fn.moduleId),
				locationCounter: env.locationCounter,
				report: env.report,
				strict: env.strict,
				depth,
			};
			return evaluate(fn.body, inner);
		}
		case "dict-literal":
			env.report(
				Codes.DictionaryPosition,
				"A dictionary literal can only be the right-hand side of a `=` definition",
				getExpressionLocation(expr),
			);
			return undefined;
	}
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

// A short display name for a callee in diagnostics.
function calleeName(callee: Expression): string {
	if (callee.type === "identifier") return `"${callee.text}"`;
	if (callee.type === "member-expression") {
		const path = flattenPath(callee);
		if (path) return `"${path.display}"`;
	}
	return "The expression";
}

/** Coerce an evaluated operand to a number, reporting if it isn't one. */
function asNumber(
	value: Value | undefined,
	expr: Expression,
	env: EvalEnv,
): bigint | undefined {
	if (typeof value === "string") {
		env.report(
			Codes.ExpectedNumber,
			"Expected a number, got a string",
			getExpressionLocation(expr),
		);
		return undefined;
	}
	if (typeof value === "object") {
		env.report(
			Codes.ExpectedNumber,
			"Expected a number, got a function - apply it with `(...)`",
			getExpressionLocation(expr),
		);
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
		case "~":
			// Arbitrary-precision complement: ~$0C is -$0D, and the byte/word
			// truncation does the right thing ($F3) by arithmetic.
			return ~v;
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
		case "^":
			return l ^ r;
		case "&":
			return l & r;
		case "|":
			return l | r;
		case "<<":
		case ">>":
			if (r < 0n) {
				env.report(
					Codes.NegativeShift,
					"Shift count must not be negative",
					getExpressionLocation(expr.right),
				);
				return undefined;
			}
			return op === "<<" ? l << r : l >> r;
		case "/":
		case "%":
			if (r === 0n) {
				env.report(
					Codes.DivisionByZero,
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
