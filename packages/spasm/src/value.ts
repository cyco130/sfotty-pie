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
 * A dictionary (`N = { A: 1, B: 2 }`): an immutable, statically-keyed record,
 * accessed with `::`. Entries are held inline rather than lowered into the
 * symbol table, so a dictionary is an ordinary value - it can be aliased
 * (`M = N`), and a future list type joins the union beside it.
 *
 * An entry is `undefined` while unresolved, so a dictionary with a forward
 * reference in it is still a value; the fixpoint settles the entry. That means
 * a dictionary carries state between passes, so it takes part in convergence
 * detection (see `isEqual`).
 */
export interface DictValue {
	type: "dict";
	entries: ReadonlyMap<string, Value | undefined>;
}

/**
 * A resolved compile-time value: integers (`bigint`, so width is never the
 * limit), strings, functions (expression macros), and dictionaries. The
 * typed-value system (operands, lists) grows this union additively.
 */
export type Value = bigint | string | FunctionValue | DictValue;

/**
 * Value equality, as the fixpoint needs it: "would the next pass see the same
 * thing?"
 *
 * Numbers and strings compare by value and functions by identity (they're
 * interned per definition site, and comparing bodies would be pointless work).
 * Dictionaries compare structurally and **order-insensitively** - a dictionary
 * is a record, so its identity is its contents, not the order they were
 * written in. Recursion is bounded because dictionary construction caps
 * nesting depth.
 */
export function isEqual(a: Value | undefined, b: Value | undefined): boolean {
	if (a === b) return true; // covers bigint, string, and function identity
	if (a === undefined || b === undefined) return false;
	if (typeof a !== "object" || typeof b !== "object") return false;
	if (a.type !== "dict" || b.type !== "dict") return false;
	if (a.entries.size !== b.entries.size) return false;
	for (const [key, value] of a.entries) {
		if (!b.entries.has(key)) return false;
		if (!isEqual(value, b.entries.get(key))) return false;
	}
	return true;
}

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
