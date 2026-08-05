import { SEP, type Definition, type Reference } from "@sfotty-pie/spasm";

/**
 * Semantic-token building, kept free of LSP library imports so it can run
 * standalone. Produces the LSP delta-encoded token data for one file from
 * the analysis maps - the same substrate as go-to-definition, so an
 * identifier is colored by what it actually resolves to.
 */

/** The legend the server registers; indexes match the encoded data. */
export const TOKEN_TYPES = [
	"namespace",
	"function",
	"variable",
	"parameter",
	"enumMember",
] as const;

export const TOKEN_MODIFIERS = ["declaration", "readonly"] as const;

const TYPE = Object.fromEntries(TOKEN_TYPES.map((t, i) => [t, i])) as Record<
	(typeof TOKEN_TYPES)[number],
	number
>;

const DECLARATION = 1 << 0;
const READONLY = 1 << 1;

interface PositionMapper {
	positionAt(offset: number): { line: number; character: number };
}

export function buildSemanticTokens(
	path: string,
	definitions: Map<string, Definition>,
	references: Map<string, Reference[]>,
	doc: PositionMapper,
): number[] {
	interface Raw {
		start: number;
		length: number;
		type: number;
		modifiers: number;
	}
	const byStart = new Map<number, Raw>();

	const add = (
		start: number,
		end: number,
		classified: { type: number; modifiers: number } | undefined,
		declaration: boolean,
	): void => {
		if (!classified || byStart.has(start)) return;
		byStart.set(start, {
			start,
			length: end - start,
			type: classified.type,
			modifiers: classified.modifiers | (declaration ? DECLARATION : 0),
		});
	};

	for (const reference of references.get(path) ?? []) {
		add(
			reference.start,
			reference.end,
			classify(reference.symbol, definitions),
			false,
		);
	}

	for (const [symbol, definition] of definitions) {
		if (definition.file !== path) continue;
		// Anonymous labels' synthesized names span a bare `:` - leave those
		// to the grammar.
		if (nameOf(symbol).startsWith(":")) continue;
		add(definition.start, definition.end, classify(symbol, definitions), true);
	}

	// LSP delta encoding: sorted by position, each token is [deltaLine,
	// deltaChar, length, type, modifiers] relative to the previous one.
	const sorted = [...byStart.values()].sort((a, b) => a.start - b.start);
	const data: number[] = [];
	let prevLine = 0;
	let prevChar = 0;
	for (const token of sorted) {
		const { line, character } = doc.positionAt(token.start);
		data.push(
			line - prevLine,
			line === prevLine ? character - prevChar : character,
			token.length,
			token.type,
			token.modifiers,
		);
		prevLine = line;
		prevChar = character;
	}
	return data;
}

/** The symbol's name past the module prefix (macro-namespace `SEP` kept). */
function nameOf(symbol: string): string {
	const sep = symbol.indexOf(SEP);
	return sep === -1 ? symbol : symbol.slice(sep + 1);
}

function classify(
	symbol: string,
	definitions: Map<string, Definition>,
): { type: number; modifiers: number } | undefined {
	const definition = definitions.get(symbol);
	if (!definition) return undefined;
	switch (definition.kind) {
		// Macros (both kinds) are the callable things, so they read like
		// function calls in any language; labels are addresses - the "plain
		// symbols" - and read like variables, with constants readonly.
		case "label":
			return { type: TYPE.variable, modifiers: 0 };
		case "namespace":
			return { type: TYPE.namespace, modifiers: 0 };
		case "function":
		case "macro":
			return { type: TYPE.function, modifiers: 0 };
		case "parameter":
			return { type: TYPE.parameter, modifiers: 0 };
		case "constant":
			// A dictionary entry (a `::`-reachable qualified name) reads as an
			// enum member; a plain constant as a readonly variable.
			return nameOf(symbol).includes(SEP) && !nameOf(symbol).startsWith(SEP)
				? { type: TYPE.enumMember, modifiers: 0 }
				: { type: TYPE.variable, modifiers: READONLY };
		case "module":
			return undefined; // import strings keep their string coloring
	}
}
