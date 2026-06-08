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

	formatMessage(
		start: number,
		end: number,
		message: string,
		showLine = false,
	): string {
		const location = this.getLocation(start, end);
		let errorLine = `${this.shortName}:${location.startLine}:${location.startColumn}: ${message}`;

		if (showLine) {
			const lineMatch = this.source.slice(location.lineStart).match(/[^\r\n]*/);

			if (lineMatch) {
				const line = lineMatch[0];
				errorLine += "\n" + line;

				let pointerLine = "";
				for (let i = 0; i < location.startColumn - 1; i++) {
					if (line[i] === "\t") {
						pointerLine += "\t";
					} else {
						pointerLine += " ";
					}
				}

				// Caret width is measured in columns on the shown line, not bytes:
				// a token that runs onto the next line (e.g. a CRLF newline) clamps
				// to the line end, so it shows one caret at the break, not two.
				const visibleEnd =
					location.startLine === location.endLine
						? location.endColumn
						: line.length + 1;
				const caretWidth = Math.max(1, visibleEnd - location.startColumn);

				pointerLine += "^".repeat(caretWidth);
				errorLine += "\n" + pointerLine;
			}
		}

		return errorLine;
	}
}

export interface SourceLocation {
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
	lineStart: number;
}
