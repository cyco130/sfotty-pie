/**
 * A resolved compile-time value. Iteration 1: integers (`bigint`, so width is
 * never the limit) and strings. The typed-value system (operands, lists, dicts)
 * arrives with macros; this union grows additively then.
 */
export type Value = bigint | string;

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
