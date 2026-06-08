export class Lexer {
	constructor(source: string) {
		this.#source = source;
	}

	next(): Token {
		const rest = this.#source.slice(this.position);
		const match = rest.match(BIG_REGEX);

		if (!match) {
			const start = this.position;

			// Consume
			this.position++;

			return {
				type: "error",
				text: this.#source.slice(start, this.position),
				start,
				end: this.position,
			};
		}

		for (let i = 1; i < match.length; i++) {
			const text = match[i];

			if (text !== undefined) {
				const type = REGEXES[i - 1]![1];
				const start = this.position;
				const end = this.position + text.length;
				this.position = end;

				return { type, text, start, end } as Token;
			}
		}

		throw new Error("Unreachable");
	}

	position = 0;

	#source: string;
}

export const DOT_KEYWORDS = [
	"byte",
	"org",
	"word",
	"segment",
	"define_segment",
	"emit",
	"emplace",
	"import",
	"export",
	"global",
] as const;

const REGISTER_NAMES = ["a", "x", "y"] as const;

// Helper to turn "byte" into "[bB][yY][tT][eE]"
function ignoreCaseSource(str: string) {
	return str
		.split("")
		.map((char) =>
			/[a-z]/i.test(char)
				? `[${char.toLowerCase()}${char.toUpperCase()}]`
				: char,
		)
		.join("");
}

const REGEXES = [
	// Delimiters
	[/$/, "eof"],
	[/\n|\r\n?/, "newline"],

	// Whitespaces
	[/[ \t]+/, "whitespace"],
	[/;[^\n\r]*/, "comment"],

	// Keywords
	...DOT_KEYWORDS.map(
		(keyword) =>
			[
				new RegExp(`\\.${ignoreCaseSource(keyword)}(?![a-zA-Z_0-9])`),
				keyword,
			] as const,
	),

	[/\.[a-zA-Z_][a-zA-Z_0-9]*/, "error:keyword"],

	...REGISTER_NAMES.map(
		(keyword) =>
			[
				new RegExp(`${ignoreCaseSource(keyword)}(?![a-zA-Z_0-9])`),
				keyword,
			] as const,
	),
	[/[a-zA-Z_][a-zA-Z_0-9]*/, "identifier"],

	// Numeric literals
	[/[0-9_]+/, "decimal"],
	[/\$[0-9_A-Fa-f]+/, "hexadecimal"],

	// String literals (single-line: a raw line break ends recovery here)
	[/"(?:[^"\r\n\\]|\\.)*"/, "string"],
	[/"(?:[^"\r\n\\]|\\.)*/, "error:string"],

	// Character literals (single-line)
	[/'(?:[^'\r\n\\]|\\.)*'/, "character"],
	[/'(?:[^'\r\n\\]|\\.)*/, "error:character"],

	// Multi character punctuation (must precede the single-character ":")
	[/\|\|/, "||"],
	[/&&/, "&&"],
	[/!=/, "!="],
	[/:=/, ":="],
	[/::/, "::"],

	// Single character punctuation
	[/#/, "#"],
	[/\(/, "("],
	[/\)/, ")"],
	[/,/, ","],

	[/:/, ":"],
	[/=/, "="],

	[/!/, "!"],
	[/</, "<"],
	[/>/, ">"],
	[/\+/, "+"],
	[/-/, "-"],
	[/\*/, "*"],
	[/\//, "/"],
	[/%/, "%"],
] as const;

const BIG_REGEX = new RegExp(
	REGEXES.map(([regex]) => {
		const source = typeof regex === "string" ? regex : regex.source;
		return "(^(?:" + source + "))";
	}).join("|"),
);

export type TokenType = (typeof REGEXES)[number][1] | "error";

export type Token<T extends TokenType = TokenType> = Distribute<T>;

interface TypedToken<T extends TokenType = TokenType> {
	type: T;
	text: string;
	start: number;
	end: number;
	before?: Array<SkippedToken>;
	after?: Array<SkippedToken>;
}

export type SkippedToken = Token<"whitespace" | "comment">;

type Distribute<T> = T extends TokenType ? TypedToken<T> : never;
