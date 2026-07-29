import {
	BUILTIN_NAMES,
	DOT_KEYWORDS,
	OPCODES,
	SEP,
	type Definition,
	type ModuleScope,
} from "@sfotty-pie/spasm";

import { formatValue } from "./outline.ts";

/**
 * Completion candidate building, kept free of LSP library imports so it can
 * run standalone (structurally compatible with `CompletionItem`).
 */

/** The LSP `CompletionItemKind` constants this module uses. */
const KIND = {
	method: 2,
	function: 3,
	field: 5,
	variable: 6,
	module: 9,
	enumMember: 20,
	constant: 21,
	keyword: 14,
} as const;

export interface CompletionCandidate {
	label: string;
	kind: (typeof KIND)[keyof typeof KIND];
	detail?: string;
}

export interface CompletionInputs {
	/** The current file's module id (absolute path). */
	path: string;
	/** Offset of the cursor in the document. */
	offset: number;
	/** The line's text from its start up to the cursor. */
	linePrefix: string;
	/** The document's full text (for enclosing-macro-body detection). */
	text: string;
	definitions: Map<string, Definition>;
	moduleScopes: Map<string, ModuleScope>;
}

// Optional label prefixes (named or anonymous), then the word being typed.
// Matching means the cursor is naming a statement: a mnemonic, a directive,
// or a macro call.
const STATEMENT_PREFIX =
	/^[ \t]*(?::[ \t]+)?(?:@?[A-Za-z_]\w*[ \t]*:[ \t]+)*\.?@?\w*$/;

// A `::` path hugging the cursor's word: capture the segments before it.
const PATH_PREFIX = /(@?[A-Za-z_]\w*(?:::@?[A-Za-z_]\w*)*)::@?\w*$/;

// The start of an assignment's right-hand side: the one expression spot where
// a directive (`name = .import "m"`) is valid.
const ASSIGNMENT_RHS =
	/^[ \t]*(?:\.export[ \t]+)?@?[A-Za-z_]\w*(?:\([^)]*\))?[ \t]*:?=[ \t]*\.?\w*$/;

// An expression macro's parameter list, when the cursor is in its body (same
// line by definition): `DOUBLE(v) = 2 * v`.
const EXPRESSION_MACRO =
	/^[ \t]*(?:\.export[ \t]+)?@?[A-Za-z_]\w*\(([^)]*)\)[ \t]*=/;

export function buildCompletions(
	inputs: CompletionInputs,
): CompletionCandidate[] {
	const { linePrefix } = inputs;
	if (inComment(linePrefix) || inString(linePrefix)) return [];

	const statement = STATEMENT_PREFIX.test(linePrefix);
	const path = PATH_PREFIX.exec(linePrefix);
	if (path) return pathCompletions(inputs, path[1]!.split("::"), statement);
	if (statement) return statementCompletions(inputs);
	return expressionCompletions(inputs);
}

function inComment(linePrefix: string): boolean {
	// A ; outside a string starts a comment; strings are single-line, so
	// scanning the prefix suffices.
	let quoted: '"' | "'" | undefined;
	for (let i = 0; i < linePrefix.length; i++) {
		const char = linePrefix[i]!;
		if (quoted) {
			if (char === "\\") i++;
			else if (char === quoted) quoted = undefined;
		} else if (char === '"' || char === "'") quoted = char;
		else if (char === ";") return true;
	}
	return false;
}

function inString(linePrefix: string): boolean {
	let quoted: '"' | "'" | undefined;
	for (let i = 0; i < linePrefix.length; i++) {
		const char = linePrefix[i]!;
		if (quoted) {
			if (char === "\\") i++;
			else if (char === quoted) quoted = undefined;
		} else if (char === '"' || char === "'") quoted = char;
	}
	return quoted !== undefined;
}

/** Mnemonics, directives, and callable macros. */
function statementCompletions(inputs: CompletionInputs): CompletionCandidate[] {
	const out = new Map<string, CompletionCandidate>();
	// Statement keywords only - the expression builtins complete in
	// expression position instead.
	for (const keyword of DOT_KEYWORDS) {
		if (EXPRESSION_KEYWORDS.has(keyword)) continue;
		out.set("." + keyword, { label: "." + keyword, kind: KIND.keyword });
	}
	for (const mnemonic of Object.keys(OPCODES)) {
		const label = mnemonic.toLowerCase();
		out.set(label, { label, kind: KIND.keyword });
	}
	addMacros(out, inputs, inputs.path, false);
	for (const importId of scopeOf(inputs)?.splats ?? []) {
		addMacros(out, inputs, importId, true);
	}
	addBindings(out, inputs);
	// `.out` params are defined in label position, so bodies offer them here.
	addEnclosingMacroParams(out, inputs);
	return [...out.values()];
}

/** Symbols visible in expression position. */
function expressionCompletions(
	inputs: CompletionInputs,
): CompletionCandidate[] {
	const out = new Map<string, CompletionCandidate>();
	addOwnSymbols(out, inputs);
	for (const importId of scopeOf(inputs)?.splats ?? []) {
		addModuleExports(out, inputs, importId);
	}
	addBindings(out, inputs);
	addLocals(out, inputs);
	addEnclosingMacroParams(out, inputs);
	addExpressionMacroParams(out, inputs);
	addKeywordArgs(out, inputs);
	// The expression builtins: operand constructors/predicates, value
	// predicates, `.segment()`, `.pop()`.
	for (const name of BUILTIN_NAMES) {
		out.set("." + name, { label: "." + name, kind: KIND.keyword });
	}
	out.set(".segment", { label: ".segment", kind: KIND.keyword });
	out.set(".pop", { label: ".pop", kind: KIND.keyword });
	out.set(".null", { label: ".null", kind: KIND.keyword });
	if (ASSIGNMENT_RHS.test(inputs.linePrefix)) {
		out.set(".import", { label: ".import", kind: KIND.keyword });
	}
	return [...out.values()];
}

// The head of a macro-call line: optional labels, then the callee (possibly
// `ns::name`), then whitespace - meaning the cursor is in the argument area.
const CALL_HEAD =
	/^[ \t]*(?::[ \t]+)?(?:@?[A-Za-z_]\w*[ \t]*:[ \t]+)*(@?[A-Za-z_]\w*(?:::@?[A-Za-z_]\w*)?)[ \t]/;

/**
 * In a macro call's argument area, offer the params as keyword arguments
 * (`aux1:`), skipping ones already given by name on the line.
 */
function addKeywordArgs(
	out: Map<string, CompletionCandidate>,
	inputs: CompletionInputs,
): void {
	const head = CALL_HEAD.exec(inputs.linePrefix)?.[1];
	if (!head) return;

	// Resolve the callee to a macro: own, splat-exported, or `ns::name`.
	const scope = inputs.moduleScopes.get(inputs.path);
	let key: string | undefined;
	const sep = head.indexOf("::");
	if (sep !== -1) {
		const bound = scope?.bindings.get(head.slice(0, sep));
		const name = head.slice(sep + 2);
		if (bound && inputs.moduleScopes.get(bound)?.macroExports.has(name)) {
			key = bound + "\0\0" + name;
		}
	} else if (inputs.definitions.has(inputs.path + "\0\0" + head)) {
		key = inputs.path + "\0\0" + head;
	} else {
		for (const importId of scope?.splats ?? []) {
			if (inputs.moduleScopes.get(importId)?.macroExports.has(head)) {
				key = importId + "\0\0" + head;
				break;
			}
		}
	}
	if (key === undefined) return;

	const prefix = key + "\0";
	for (const [symbol, definition] of inputs.definitions) {
		if (definition.kind !== "parameter" || !symbol.startsWith(prefix)) {
			continue;
		}
		const name = symbol.slice(prefix.length);
		if (name.includes("\0")) continue;
		// Already given by name on this line?
		if (new RegExp(`\\b${name}[ \\t]*:`).test(inputs.linePrefix)) continue;
		out.set(name + ":", { label: name + ":", kind: KIND.variable });
	}
}

/** Dot keywords that are expression builtins, not statements. */
const EXPRESSION_KEYWORDS: ReadonlySet<string> = new Set([
	...BUILTIN_NAMES,
	"pop",
	"null",
]);

/**
 * Inside a `.macro` body, the macro's params are in scope. The body extent
 * isn't in the definitions map, so find the enclosing `.macro`/`.endmacro`
 * pair textually (both are line-anchored directives).
 */
function addEnclosingMacroParams(
	out: Map<string, CompletionCandidate>,
	inputs: CompletionInputs,
): void {
	const before = inputs.text.slice(0, inputs.offset);
	const opens =
		/(?:^|\n)[ \t]*(?:\.export[ \t]+)?\.(macro|endmacro)(?:[ \t]+(@?[A-Za-z_]\w*))?/gi;
	let enclosing: string | undefined;
	for (const match of before.matchAll(opens)) {
		enclosing = match[1]!.toLowerCase() === "macro" ? match[2] : undefined;
	}
	if (enclosing === undefined) return;

	const prefix = inputs.path + SEP + SEP + enclosing + SEP;
	for (const [key, definition] of inputs.definitions) {
		if (definition.kind !== "parameter" || !key.startsWith(prefix)) continue;
		const name = key.slice(prefix.length);
		out.set(name, { label: name, kind: KIND.variable });
	}
}

/** On an expression-macro line (`F(x) = ...`), the params are in scope. */
function addExpressionMacroParams(
	out: Map<string, CompletionCandidate>,
	inputs: CompletionInputs,
): void {
	const match = EXPRESSION_MACRO.exec(inputs.linePrefix);
	if (!match) return;
	for (const param of match[1]!.split(",")) {
		const name = param.trim();
		if (/^@?[A-Za-z_]\w*$/.test(name)) {
			out.set(name, { label: name, kind: KIND.variable });
		}
	}
}

/** Completions after `::`: a binding's exports, or a dictionary's keys. */
function pathCompletions(
	inputs: CompletionInputs,
	segments: string[],
	statement: boolean,
): CompletionCandidate[] {
	const out = new Map<string, CompletionCandidate>();
	const root = segments[0]!;

	// A namespace binding: first key completes the bound module's exports
	// (and, in statement position, its exported macros).
	const bound = scopeOf(inputs)?.bindings.get(root);
	if (bound !== undefined) {
		if (segments.length === 1) {
			addModuleExports(out, inputs, bound);
			if (statement) {
				for (const name of inputs.moduleScopes.get(bound)?.macroExports ?? []) {
					out.set(name, { label: name, kind: KIND.method });
				}
			}
		} else {
			addDictKeys(out, inputs, bound, segments.slice(1));
		}
		return [...out.values()];
	}

	// A dictionary in scope: own module first, then splat exports.
	const ownerOf = (module: string): string | undefined =>
		inputs.definitions.has(module + SEP + root) ? module : undefined;
	const owner =
		ownerOf(inputs.path) ??
		(scopeOf(inputs)?.splats ?? []).find(
			(id) =>
				inputs.moduleScopes.get(id)?.exports.has(root) &&
				ownerOf(id) !== undefined,
		);
	if (owner !== undefined) addDictKeys(out, inputs, owner, segments);
	return [...out.values()];
}

function scopeOf(inputs: CompletionInputs): ModuleScope | undefined {
	return inputs.moduleScopes.get(inputs.path);
}

function addBindings(
	out: Map<string, CompletionCandidate>,
	inputs: CompletionInputs,
): void {
	for (const [name] of scopeOf(inputs)?.bindings ?? []) {
		out.set(name, { label: name, kind: KIND.module });
	}
}

function addMacros(
	out: Map<string, CompletionCandidate>,
	inputs: CompletionInputs,
	moduleId: string,
	exportedOnly: boolean,
): void {
	const prefix = moduleId + SEP + SEP;
	const exported = inputs.moduleScopes.get(moduleId)?.macroExports;
	for (const [key, definition] of inputs.definitions) {
		if (definition.kind !== "macro" || !key.startsWith(prefix)) continue;
		const name = key.slice(prefix.length);
		if (name.includes(SEP)) continue;
		if (exportedOnly && !exported?.has(name)) continue;
		out.set(name, { label: name, kind: KIND.method });
	}
}

/** The module's own single-segment symbols (hygiene machinery excluded). */
function addOwnSymbols(
	out: Map<string, CompletionCandidate>,
	inputs: CompletionInputs,
): void {
	const prefix = inputs.path + SEP;
	for (const [key, definition] of inputs.definitions) {
		if (!key.startsWith(prefix) || key.startsWith(prefix + SEP)) continue;
		const name = key.slice(prefix.length);
		if (name.includes(SEP) || name.includes("@") || name.startsWith(":")) {
			continue;
		}
		out.set(name, candidateFor(name, definition));
	}
}

function addModuleExports(
	out: Map<string, CompletionCandidate>,
	inputs: CompletionInputs,
	moduleId: string,
): void {
	for (const name of inputs.moduleScopes.get(moduleId)?.exports ?? []) {
		const definition = inputs.definitions.get(moduleId + SEP + name);
		if (definition) out.set(name, candidateFor(name, definition));
	}
}

/** `@` locals of the enclosing label (the nearest preceding one). */
function addLocals(
	out: Map<string, CompletionCandidate>,
	inputs: CompletionInputs,
): void {
	const prefix = inputs.path + SEP;
	let owner: string | undefined;
	let ownerStart = -1;
	for (const [key, definition] of inputs.definitions) {
		if (!key.startsWith(prefix) || definition.kind !== "label") continue;
		const name = key.slice(prefix.length);
		if (name.includes(SEP) || name.includes("@")) continue;
		if (definition.start < inputs.offset && definition.start > ownerStart) {
			owner = name;
			ownerStart = definition.start;
		}
	}
	if (owner === undefined) return;

	const localPrefix = prefix + owner + "@";
	for (const [key, definition] of inputs.definitions) {
		if (!key.startsWith(localPrefix)) continue;
		const local = key.slice(localPrefix.length);
		if (/^(?:if)?\d+$/.test(local) || local.includes(SEP)) continue;
		out.set("@" + local, {
			label: "@" + local,
			kind: KIND.field,
			detail: detailFor(definition),
		});
	}
}

/** Entries of the dictionary at `moduleId` :: segments, one level deep. */
function addDictKeys(
	out: Map<string, CompletionCandidate>,
	inputs: CompletionInputs,
	moduleId: string,
	segments: string[],
): void {
	const prefix = moduleId + SEP + segments.join(SEP) + SEP;
	for (const [key, definition] of inputs.definitions) {
		if (!key.startsWith(prefix)) continue;
		const name = key.slice(prefix.length);
		if (name.includes(SEP)) continue;
		out.set(name, {
			label: name,
			kind: definition.kind === "namespace" ? KIND.module : KIND.enumMember,
			detail: detailFor(definition),
		});
	}
}

function candidateFor(
	name: string,
	definition: Definition,
): CompletionCandidate {
	const kind =
		definition.kind === "label"
			? KIND.function
			: definition.kind === "namespace"
				? KIND.module
				: definition.kind === "function"
					? KIND.function
					: KIND.constant;
	return { label: name, kind, detail: detailFor(definition) };
}

function detailFor(definition: Definition): string | undefined {
	const formatted = formatValue(definition.value);
	return formatted === undefined ? undefined : `= ${formatted}`;
}
