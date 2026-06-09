import {
	getExpressionLocation,
	type Expression,
	type InfixExpression,
	type PrefixExpression,
} from "./parser.ts";
import { decodeStringLiteral, type Value } from "./value.ts";

export interface EvalEnv {
	/** Look up a symbol; `undefined` means "not resolved (yet)". */
	resolve(name: string): Value | undefined;
	/** Look up an ambient (`.global::name`) symbol, if the env supports it. */
	resolveGlobal?(name: string): Value | undefined;
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
 * not-yet-defined symbol) or an error made it uncomputable — callers tell the
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
			const value = env.resolve(expr.text);
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
		case "global":
			env.report(
				"`.global` is a namespace, not a value",
				getExpressionLocation(expr),
			);
			return undefined;
		case "member-expression": {
			if (expr.object.type === "global") {
				const value = env.resolveGlobal?.(expr.member.text);
				if (value === undefined && env.strict) {
					env.report(
						`Undefined global "${expr.member.text}"`,
						getExpressionLocation(expr),
					);
				}
				return value;
			}
			env.report(
				"Only `.global::name` member access is supported",
				getExpressionLocation(expr),
			);
			return undefined;
		}
	}
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
