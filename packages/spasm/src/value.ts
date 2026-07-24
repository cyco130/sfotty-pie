import type { Expression } from "./parser.ts";

/**
 * An expression macro: a function-valued symbol (`DOUBLE(x) = 2 * x`). The
 * only operations are application (`DOUBLE(2)`) and assignment aliasing
 * (`D = DOUBLE`). The value is interned per definition site so it stays
 * identity-stable across passes (the fixpoint compares values with `!==`).
 */
export interface FunctionValue {
	type: "function";
	params: readonly string[];
	body: Expression;
	/** The module the body's free names resolve in (lexical hygiene). */
	moduleId: string;
}

/**
 * A resolved compile-time value: integers (`bigint`, so width is never the
 * limit), strings, and functions (expression macros). The typed-value system
 * (operands, lists) grows this union additively.
 */
export type Value = bigint | string | FunctionValue;

const ESCAPES: Record<string, string> = {
	"\\": "\\",
	'"': '"',
	"'": "'",
	n: "\n",
	t: "\t",
	r: "\r",
	"0": "\0",
};

/**
 * Decode a string/character literal's raw text (surrounding quotes included)
 * into its value, calling `onBadEscape` for each unrecognized `\x` (which is
 * then kept verbatim). The full escape/encoding policy (ATASCII, screen codes)
 * is still TODO; this is the minimal C-style set.
 */
export function decodeStringLiteral(
	raw: string,
	onBadEscape: (escape: string) => void,
): string {
	const body = raw.slice(1, -1);
	let result = "";
	for (let i = 0; i < body.length; i++) {
		const char = body[i]!;
		if (char !== "\\") {
			result += char;
			continue;
		}
		// The lexer guarantees a character follows every backslash.
		const escaped = body[++i]!;
		const mapped = ESCAPES[escaped];
		if (mapped === undefined) {
			onBadEscape(escaped);
			result += escaped;
		} else {
			result += mapped;
		}
	}
	return result;
}
