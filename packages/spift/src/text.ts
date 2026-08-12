// Text recoding between a family's own character set and Unicode.
//
// ATASCII is the only family set so far. The Atari's international
// character ROM is deliberately NOT folded in: its 27 accented letters sit
// on codes $00-$1A and $7B, which the standard ROM shows as graphics, so
// writing "e-acute" as $14 produces a file that reads as a graphics glyph
// on any machine not running that ROM. It belongs in its own encoding.
//
// Conversion pivots through the family bytes rather than through the text,
// so "unicode" and "escaped-unicode" are two spellings of the same thing
// and converting between them goes through ATASCII, dropping whatever
// ATASCII has no code for - which is the honest answer, since both are
// representations OF ATASCII text.

/** Glyph per ATASCII code $00-$7F. The high half is these, inverse. */
const GLYPHS =
	// $00
	"♥├▕┘┤┐╱╲◢▗◣▝▘▔▁▖" +
	// $10
	"♣┌─┼•▄▏┬┴▌└␛↑↓←→" +
	// $20
	" !\"#$%&'()*+,-./" +
	// $30
	"0123456789:;<=>?" +
	// $40
	"@ABCDEFGHIJKLMNO" +
	// $50
	"PQRSTUVWXYZ[\\]^_" +
	// $60
	"♦abcdefghijklmno" +
	// $70
	"pqrstuvwxyz♠|↖◀▶";

const CODE_OF = new Map<string, number>(
	[...GLYPHS].map((glyph, code) => [glyph, code]),
);

const EOL = 0x9b;
/** Inverse video, and the two braces, in the text form. */
const INVERSE_MARK = "~";
const SUBSTITUTE = "?";

export const TEXT_ENCODINGS = [
	"atascii",
	"unicode",
	"escaped-unicode",
] as const;
export type TextEncoding = (typeof TEXT_ENCODINGS)[number];

export type EolStyle = "lf" | "crlf" | "native";

export interface RecodeOptions {
	/**
	 * Refuse anything that will not survive the round trip instead of
	 * substituting "?" - a character with no ATASCII code, or a "~" that
	 * opens inverse video and lets the line ending close it, which is what
	 * ordinary host text containing a tilde looks like. Encoding only:
	 * decoding is total, since every one of the 256 codes has a glyph or an
	 * escape.
	 */
	strict?: boolean;
	/** What EOL becomes. Decoding only; encoding takes LF, CR, and CRLF. */
	eol?: EolStyle;
}

export interface RecodeResult {
	bytes: Uint8Array;
	/** What --strict would have refused, in the order met. */
	diagnostics: string[];
}

/**
 * The glyph an ATASCII code shows, ignoring inverse video (the high bit).
 * Every one of the 128 has one, which is why decoding never fails - and why
 * no test can tell an Atari text file from a binary.
 */
export function atasciiGlyph(code: number): string {
	return GLYPHS[code & 0x7f] as string;
}

export function isTextEncoding(name: string): name is TextEncoding {
	return (TEXT_ENCODINGS as readonly string[]).includes(name);
}

/**
 * Recodes between any two of the encodings. Throws when `strict` is set and
 * something would not survive; otherwise the losses come back as
 * diagnostics and the output substitutes "?".
 */
export function recodeText(
	bytes: Uint8Array,
	from: TextEncoding,
	to: TextEncoding,
	options?: RecodeOptions,
): RecodeResult {
	const native: EncodeResult =
		from === "atascii" ? { bytes, diagnostics: [] } : toAtascii(bytes, options);
	if (to === "atascii") {
		return native;
	}
	return {
		bytes: new TextEncoder().encode(
			fromAtascii(native.bytes, to === "escaped-unicode", options?.eol ?? "lf"),
		),
		diagnostics: native.diagnostics,
	};
}

interface EncodeResult {
	bytes: Uint8Array;
	diagnostics: string[];
}

/**
 * ATASCII bytes to their text form. Total: the printable codes are
 * themselves, EOL is the line ending, inverse video is bracketed by "~",
 * and anything left is a "{ddd}" escape - so this always round-trips.
 * `escaped` writes every non-ASCII glyph as an escape too, for terminals
 * and fonts that cannot show the Atari graphics.
 */
export function fromAtascii(
	bytes: Uint8Array,
	escaped: boolean,
	eol: EolStyle = "lf",
): string {
	const lineEnding =
		eol === "crlf"
			? "\r\n"
			: eol === "native"
				? process.platform === "win32"
					? "\r\n"
					: "\n"
				: "\n";
	let out = "";
	let inverse = false;
	for (const byte of bytes) {
		// EOL is a line ending first and an inverse ESC never: it is the one
		// high-bit code that means something other than "the low code, in
		// inverse", and it turns inverse off on the Atari as it does here.
		if (byte === EOL) {
			if (inverse) {
				out += INVERSE_MARK;
				inverse = false;
			}
			out += lineEnding;
			continue;
		}
		const glyph = GLYPHS[byte & 0x7f] as string;
		// An escape names a byte outright, so it says everything including
		// the inverse bit and leaves the "~" state alone - mixing the two
		// would have the high bit stated twice, and dropped once.
		if (escaped && !isPlainAscii(glyph)) {
			out += `{${byte}}`;
			continue;
		}
		const high = (byte & 0x80) !== 0;
		if (high !== inverse) {
			out += INVERSE_MARK;
			inverse = high;
		}
		out += glyph;
	}
	if (inverse) {
		out += INVERSE_MARK;
	}
	return out;
}

function isPlainAscii(glyph: string): boolean {
	const code = glyph.codePointAt(0) ?? 0;
	return code >= 0x20 && code < 0x7f;
}

/**
 * Text back to ATASCII. "~" toggles inverse video and a line ending turns
 * it off; "{ddd}" and "{$hh}" emit a byte outright, with "{!ddd}" and
 * "{!$hh}" accepted as the same thing (the "!" tells the paste path to skip
 * an ESC prefix, which a file has no use for). Anything with no ATASCII
 * code - the backtick, a brace that is not an escape, an accented letter,
 * an emoji - becomes "?".
 */
export function toAtascii(
	text: Uint8Array | string,
	options?: RecodeOptions,
): EncodeResult {
	const input =
		typeof text === "string" ? text : new TextDecoder().decode(text);
	const out: number[] = [];
	const diagnostics: string[] = [];
	let inverse = 0;
	let line = 1;
	// Where the run of inverse video started, for the unmatched-tilde check.
	let opened: number | undefined;

	const lose = (what: string) => {
		diagnostics.push(`line ${line}: ${what}`);
		out.push(CODE_OF.get(SUBSTITUTE) ?? 0x3f);
	};

	for (let i = 0; i < input.length; i++) {
		const char = input[i] as string;

		if (char === "\r" || char === "\n") {
			// CRLF is one ending, not two.
			if (char === "\r" && input[i + 1] === "\n") {
				i++;
			}
			if (inverse !== 0 && options?.strict === true) {
				diagnostics.push(
					`line ${opened ?? line}: "~" opens inverse video and the line ` +
						`ending closes it - ordinary text holding a tilde looks like this`,
				);
			}
			out.push(EOL);
			inverse = 0;
			opened = undefined;
			line++;
			continue;
		}

		if (char === INVERSE_MARK) {
			inverse ^= 0x80;
			opened = inverse === 0 ? undefined : line;
			continue;
		}

		if (char === "{") {
			const escape = readEscape(input, i);
			if (escape !== undefined) {
				out.push(escape.byte);
				i = escape.end;
				continue;
			}
			lose(`"{" is not the start of a {ddd} or {$hh} escape`);
			continue;
		}

		const code = CODE_OF.get(char);
		if (code === undefined) {
			lose(`"${char}" has no ATASCII character`);
			continue;
		}
		out.push(code | inverse);
	}

	if (inverse !== 0 && options?.strict === true) {
		diagnostics.push(
			`line ${opened ?? line}: "~" opens inverse video and is never closed`,
		);
	}
	if (options?.strict === true && diagnostics.length > 0) {
		throw new Error(diagnostics.join("\n"));
	}
	return { bytes: Uint8Array.from(out), diagnostics };
}

/** Reads "{ddd}", "{$hh}", or either with a "!" after the brace. */
function readEscape(
	text: string,
	start: number,
): { byte: number; end: number } | undefined {
	const close = text.indexOf("}", start);
	if (close === -1) {
		return undefined;
	}
	let body = text.slice(start + 1, close);
	if (body.startsWith("!")) {
		body = body.slice(1);
	}
	const value = /^\$([0-9a-f]{1,2})$/i.test(body)
		? Number.parseInt(body.slice(1), 16)
		: /^\d{1,3}$/.test(body)
			? Number.parseInt(body, 10)
			: undefined;
	if (value === undefined || value > 255) {
		return undefined;
	}
	return { byte: value, end: close };
}
