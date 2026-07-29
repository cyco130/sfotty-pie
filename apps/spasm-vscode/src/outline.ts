import { SEP, type Definition, type Value } from "@sfotty-pie/spasm";

/**
 * Document-outline building, kept free of LSP library imports so it can run
 * standalone (structurally compatible with `DocumentSymbol`).
 */

interface Position {
	line: number;
	character: number;
}

interface Range {
	start: Position;
	end: Position;
}

/** The LSP `SymbolKind` constants this outline uses (protocol-stable). */
const KIND = {
	namespace: 3,
	method: 6,
	field: 8,
	function: 12,
	variable: 13,
	constant: 14,
	enumMember: 22,
} as const;

type OutlineKind = (typeof KIND)[keyof typeof KIND];

export interface OutlineSymbol {
	name: string;
	detail?: string;
	kind: OutlineKind;
	range: Range;
	selectionRange: Range;
	children: OutlineSymbol[];
}

interface PositionMapper {
	positionAt(offset: number): Position;
}

/**
 * Build the outline for `path` from the assemble result's definitions: code
 * labels (with their `@` locals nested, spanning to the next label so
 * breadcrumbs know what routine the cursor is in), constants and `:=`
 * addresses, dictionaries with their entries, and macros with their params.
 * Hygiene machinery (gensym'd `name@N`, `.if`-arm `name@ifN`, anonymous
 * labels) stays out.
 */
export function buildOutline(
	path: string,
	definitions: Map<string, Definition>,
	text: string,
	doc: PositionMapper,
): OutlineSymbol[] {
	const prefix = path + SEP;

	interface Entry {
		segments: string[];
		macro: boolean;
		definition: Definition;
	}
	const entries: Entry[] = [];
	for (const [key, definition] of definitions) {
		if (definition.file !== path || definition.kind === "module") continue;
		if (!key.startsWith(prefix)) continue;
		const rest = key.slice(prefix.length);
		const macro = rest.startsWith(SEP);
		entries.push({
			segments: (macro ? rest.slice(1) : rest).split(SEP),
			macro,
			definition,
		});
	}
	// Parents before children, then source order.
	entries.sort(
		(a, b) =>
			a.segments.length - b.segments.length ||
			a.definition.start - b.definition.start,
	);

	const top: OutlineSymbol[] = [];
	const symbolNodes = new Map<string, OutlineSymbol>();
	const macroNodes = new Map<string, OutlineSymbol>();
	/** Top-level labels by name, for attaching `@` locals. */
	const labels = new Map<string, OutlineSymbol>();

	const spanRange = (definition: Definition): Range => ({
		start: doc.positionAt(definition.start),
		end: doc.positionAt(definition.end),
	});

	for (const { segments, macro, definition } of entries) {
		const last = segments[segments.length - 1]!;
		if (!macro && segments.length === 1) {
			if (last.startsWith(":")) continue; // anonymous label
			const at = last.indexOf("@");
			if (at > 0) {
				const local = last.slice(at + 1);
				if (/^(?:if)?\d+$/.test(local)) continue; // hygiene gensym
				const node: OutlineSymbol = {
					name: "@" + local,
					kind: KIND.field,
					range: spanRange(definition),
					selectionRange: spanRange(definition),
					children: [],
				};
				appendValueDetail(node, definition.value);
				const owner = labels.get(last.slice(0, at));
				(owner?.children ?? top).push(node);
				continue;
			}
		}

		const node: OutlineSymbol = {
			name: last,
			kind: kindOf(definition, segments.length > 1),
			range: spanRange(definition),
			selectionRange: spanRange(definition),
			children: [],
		};
		appendValueDetail(node, definition.value);

		if (macro) {
			if (segments.length === 1) {
				macroNodes.set(last, node);
				node.kind = KIND.method;
				top.push(node);
			} else {
				node.kind = KIND.variable;
				(macroNodes.get(segments[0]!)?.children ?? top).push(node);
			}
			continue;
		}

		const rest = segments.join(SEP);
		symbolNodes.set(rest, node);
		if (segments.length === 1) {
			top.push(node);
			if (definition.kind === "label") labels.set(last, node);
		} else {
			const parent = symbolNodes.get(segments.slice(0, -1).join(SEP));
			(parent?.children ?? top).push(node);
		}
	}

	extendLabelRanges(top, text, doc);
	sortTree(top);
	return top;
}

function kindOf(definition: Definition, isDictEntry: boolean): OutlineKind {
	switch (definition.kind) {
		case "label":
			return KIND.function;
		case "namespace":
			return KIND.namespace;
		case "function":
			return KIND.function;
		case "macro":
			return KIND.method;
		case "parameter":
			return KIND.variable;
		default:
			return isDictEntry ? KIND.enumMember : KIND.constant;
	}
}

function appendValueDetail(
	node: OutlineSymbol,
	value: Value | undefined,
): void {
	const formatted = formatValue(value);
	if (formatted !== undefined) node.detail = `= ${formatted}`;
}

/**
 * A `name:` code label (colon after the token) owns the region up to the
 * next code label, so breadcrumbs and sticky scroll track the enclosing
 * routine; `name := addr` stays a point definition. Parents also widen over
 * their children (locals must be contained).
 */
function extendLabelRanges(
	top: OutlineSymbol[],
	text: string,
	doc: PositionMapper,
): void {
	const isCode = (node: OutlineSymbol): boolean =>
		node.kind === KIND.function &&
		text.slice(offsetOfEnd(node, text), offsetOfEnd(node, text) + 1) === ":";

	// Work in offsets via a side table to avoid re-deriving from positions.
	const codeLabels = top
		.filter(isCode)
		.sort((a, b) => compare(a.range.start, b.range.start));
	for (let i = 0; i < codeLabels.length; i++) {
		const next = codeLabels[i + 1];
		codeLabels[i]!.range = {
			start: codeLabels[i]!.range.start,
			end: next ? next.range.start : doc.positionAt(text.length),
		};
	}

	const widen = (node: OutlineSymbol): void => {
		for (const child of node.children) {
			widen(child);
			if (compare(child.range.end, node.range.end) > 0) {
				node.range = { start: node.range.start, end: child.range.end };
			}
		}
	};
	for (const node of top) widen(node);
}

// The selection span's end offset. Positions round-trip exactly because the
// selection range was built with positionAt on the same document.
function offsetOfEnd(node: OutlineSymbol, text: string): number {
	let offset = 0;
	let line = 0;
	while (line < node.selectionRange.end.line) {
		const next = text.indexOf("\n", offset);
		if (next === -1) return text.length;
		offset = next + 1;
		line++;
	}
	return offset + node.selectionRange.end.character;
}

function compare(a: Position, b: Position): number {
	return a.line - b.line || a.character - b.character;
}

function sortTree(nodes: OutlineSymbol[]): void {
	nodes.sort((a, b) => compare(a.range.start, b.range.start));
	for (const node of nodes) sortTree(node.children);
}

export function formatValue(value: Value | undefined): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "bigint") {
		const negative = value < 0n;
		const magnitude = negative ? -value : value;
		const hex = magnitude.toString(16).toUpperCase();
		const padded = hex.padStart(hex.length <= 2 ? 2 : 4, "0");
		return `${negative ? "-" : ""}$${padded} (${value.toString(10)})`;
	}
	if (typeof value === "string") return JSON.stringify(value);
	if (value.type === "dict") {
		return `{ ${[...value.entries.keys()].join(", ")} }`;
	}
	if (value.type === "operand") {
		const inner = formatValue(value.value) ?? "?";
		switch (value.shape) {
			case "a":
			case "x":
			case "y":
				return value.shape;
			case "immediate":
				return `#${inner}`;
			case "x_indexed":
				return `${inner},x`;
			case "y_indexed":
				return `${inner},y`;
			case "indirect":
				return `(${inner})`;
			case "x_indexed_indirect":
				return `(${inner},x)`;
			case "indirect_y_indexed":
				return `(${inner}),y`;
		}
	}
	return `(${value.params.join(", ")}) - expression macro`;
}
