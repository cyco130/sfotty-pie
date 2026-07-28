export class SourceFile {
	id: string;
	source: string;
	shortName: string;

	constructor(id: string, source: string, shortName = id) {
		this.id = id;
		this.source = source;
		this.shortName = shortName;
	}

	getLocation(start: number, end: number): SourceLocation {
		// Find line and column
		let lineStart = 0;

		let startLine = 1;
		let startColumn = 1;
		let startFound = false;

		let endLine = 1;
		let endColumn = 1;

		for (let i = 0; i < end; i++) {
			if (i === start) {
				startFound = true;
				startLine = endLine;
				startColumn = endColumn;
			}

			if (this.source[i] === "\r" && this.source[i + 1] === "\n") {
				continue;
			}

			if (this.source[i] === "\r" || this.source[i] === "\n") {
				if (i < start) {
					lineStart = i + 1;
				}

				endLine++;
				endColumn = 1;
			} else {
				endColumn++;
			}
		}

		if (!startFound) {
			startLine = endLine;
			startColumn = endColumn;
		}

		return { startLine, startColumn, endLine, endColumn, lineStart };
	}

	/**
	 * Render a tsc-style diagnostic block:
	 *
	 * ```
	 * f.s:4:44 - error SP2001: message
	 *
	 * 4 lda undef
	 *       ~~~~~
	 * ```
	 *
	 * `code` is the diagnostic's stable code, printed after the kind (notes
	 * have none). With `color`, ANSI codes paint the parts (file cyan,
	 * line:col yellow, the kind + code and the squiggles in the kind's color,
	 * the line-number gutter inverse) - for tty output; the plain form is the
	 * machine-friendly one.
	 */
	formatMessage(
		start: number,
		end: number,
		kind: string,
		code: string | undefined,
		message: string,
		options: { showLine?: boolean; color?: boolean } = {},
	): string {
		const location = this.getLocation(start, end);
		const paint = (text: string, colorCode: string) =>
			options.color ? `\x1b[${colorCode}m${text}\x1b[0m` : text;
		const kindCode = KIND_COLORS[kind] ?? KIND_COLORS["error"]!;

		const label = code === undefined ? kind : `${kind} ${code}`;
		const position = `${location.startLine}:${location.startColumn}`;
		let out = `${paint(this.shortName, CYAN)}:${paint(position, YELLOW)} - ${paint(label, kindCode)}: ${message}`;

		if (options.showLine) {
			const lineMatch = this.source.slice(location.lineStart).match(/[^\r\n]*/);

			if (lineMatch) {
				const line = lineMatch[0];
				const gutter = String(location.startLine);
				out += `\n\n${paint(gutter, INVERSE)} ${line}`;

				let indent = "";
				for (let i = 0; i < location.startColumn - 1; i++) {
					indent += line[i] === "\t" ? "\t" : " ";
				}

				// Squiggle width is measured in columns on the shown line, not
				// bytes: a token that runs onto the next line (e.g. a CRLF newline)
				// clamps to the line end, so it shows one squiggle at the break,
				// not two.
				const visibleEnd =
					location.startLine === location.endLine
						? location.endColumn
						: line.length + 1;
				const width = Math.max(1, visibleEnd - location.startColumn);

				out += `\n${paint(" ".repeat(gutter.length), INVERSE)} ${indent}${paint("~".repeat(width), kindCode)}`;
			}
		}

		return out;
	}
}

const CYAN = "36";
const YELLOW = "33";
const INVERSE = "7";

// The kind label and its squiggles share a color, tsc-style.
const KIND_COLORS: Record<string, string> = {
	error: "31", // red
	warning: "33", // yellow
	info: "34", // blue
	note: "90", // gray
};

export interface SourceLocation {
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
	lineStart: number;
}
