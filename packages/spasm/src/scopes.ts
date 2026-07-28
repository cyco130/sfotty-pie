import type { LoadedModule } from "./loader.ts";
import type { Statement } from "./parser.ts";
import {
	SEP,
	SymbolTable,
	type Definition,
	type SymbolKind,
} from "./symbols.ts";
import type { Value } from "./value.ts";

type Span = readonly [number, number];

/** A resolved reference: where in `file` (the map key), and to which symbol
 * (a qualified name in the `Message.symbol` spelling - a `definitions` key).
 */
export interface Reference {
	start: number;
	end: number;
	symbol: string;
}

/**
 * Per-module symbol scopes layered over one `SymbolTable` via qualified keys.
 * A name resolves to a module's own symbol, to an exported symbol of a module
 * it splat-imports, or - when its root is a namespace binding
 * (`lib = .import "m"`) - to an exported symbol of the bound module via
 * `lib::name`. Module export sets and import lists are structural, computed
 * once.
 */
export class Scopes {
	#table = new SymbolTable();
	#exports = new Map<string, ReadonlySet<string>>();
	#splats = new Map<string, readonly string[]>();
	#bindings = new Map<string, ReadonlyMap<string, string>>();
	#references = new Map<string, Reference[]>();
	#referenceSpans = new Set<string>();

	constructor(modules: readonly LoadedModule[]) {
		for (const module of modules) {
			this.#splats.set(
				module.id,
				module.imports.filter((i) => i.binding === null).map((i) => i.id),
			);
			this.#bindings.set(
				module.id,
				new Map(
					module.imports
						.filter((i) => i.binding !== null)
						.map((i) => [i.binding!, i.id]),
				),
			);
			this.#exports.set(module.id, exportedNames(module));
		}
	}

	beginPass(): void {
		this.#table.beginPass();
		// References re-record each pass so only the converged pass's survive
		// (same discipline as diagnostics - earlier passes see stale values).
		this.#references.clear();
		this.#referenceSpans.clear();
	}
	snapshot(): Map<string, Value | undefined> {
		return this.#table.snapshot();
	}
	changedSince(snapshot: Map<string, Value | undefined>): boolean {
		return this.#table.changedSince(snapshot);
	}

	defineLocal(
		moduleId: string,
		name: string,
		value: Value | undefined,
		kind: SymbolKind,
		span: Span,
	): Span | undefined {
		return this.#table.define(moduleId + SEP + name, value, kind, span);
	}

	/** Whether `name` is defined in `moduleId`'s own scope (any value state). */
	isDefined(moduleId: string, name: string): boolean {
		return this.#table.has(moduleId + SEP + name);
	}

	/** Resolve `name` as seen from `moduleId`: own scope, then splat imports. */
	resolve(moduleId: string, name: string): Value | undefined {
		const key = this.#scopeKey(moduleId, name);
		return key === undefined ? undefined : this.#table.resolve(key);
	}

	/**
	 * A module's resolved symbols, unqualified (for the assemble result).
	 * Dictionary entries surface under their user-facing `::` paths.
	 */
	resolvedFor(moduleId: string): Map<string, Value> {
		const prefix = moduleId + SEP;
		const out = new Map<string, Value>();
		for (const [key, value] of this.#table.resolved()) {
			// Functions are static machinery, not result data. Dictionaries are
			// data, and surface whole - flattening them into `::` paths is a
			// consumer's job (a debug-info format's, when there is one).
			if (typeof value === "object" && value.type === "function") continue;
			if (!key.startsWith(prefix)) continue;
			const name = key.slice(prefix.length);
			// Dictionary entries have their own qualified symbols (for
			// definition sites), but surface through the whole dict here.
			if (name.includes(SEP)) continue;
			out.set(name, value);
		}
		return out;
	}

	/**
	 * Record that `name` was referenced at `span` in `moduleId`'s source (the
	 * caller passes the hygiene-adjusted module, so span and file agree). A
	 * name that resolves to nothing records nothing; a span records once (an
	 * expression can re-evaluate within a pass - collect and render both walk
	 * `.res` counts, for instance).
	 */
	recordReference(moduleId: string, name: string, span: Span): void {
		const key = this.#scopeKey(moduleId, name);
		if (key === undefined) return;
		const spanKey = moduleId + SEP + span[0] + SEP + span[1];
		if (this.#referenceSpans.has(spanKey)) return;
		this.#referenceSpans.add(spanKey);
		const list = this.#references.get(moduleId);
		const reference = { start: span[0], end: span[1], symbol: key };
		if (list) list.push(reference);
		else this.#references.set(moduleId, [reference]);
	}

	/** The recorded references of the last (converged) pass, per file. */
	references(): Map<string, Reference[]> {
		return this.#references;
	}

	/**
	 * The definition `name` resolves to as seen from `moduleId` (own scope,
	 * splat imports, or a namespaced path), if any.
	 */
	definitionOf(moduleId: string, name: string): Definition | undefined {
		const key = this.#scopeKey(moduleId, name);
		return key === undefined ? undefined : this.#definitionFor(key);
	}

	/**
	 * Every symbol definition, keyed by qualified name (module NUL name,
	 * dictionary paths NUL-joined further - the same spelling as
	 * `Message.symbol`). Includes unresolved and function-valued symbols;
	 * kinds distinguish them.
	 */
	definitions(): Map<string, Definition> {
		const out = new Map<string, Definition>();
		for (const [key] of this.#table.definitions()) {
			out.set(key, this.#definitionFor(key)!);
		}
		return out;
	}

	// The file is the qualified key's module: a definition's span always
	// indexes into the module it defines under (hygiene stamps both the scope
	// and the token source to the macro's module - see `Definition`).
	#definitionFor(key: string): Definition | undefined {
		const definedAt = this.#table.definedAt(key);
		if (definedAt === undefined) return undefined;
		return {
			file: key.slice(0, key.indexOf(SEP)),
			start: definedAt[0],
			end: definedAt[1],
			kind: this.#table.kindOf(key)!,
			value: this.#table.resolve(key),
		};
	}

	/**
	 * The qualified key `name` would resolve to from `moduleId`, or undefined.
	 * Public for diagnostics (e.g. matching an undefined reference to a label
	 * in a discarded segment): the import branches test structural export
	 * *sets*, so they answer correctly even for names that were never defined.
	 * The own-scope branch requires a table entry, so callers interested in
	 * never-defined own-module names must check the direct key themselves.
	 */
	resolutionTarget(moduleId: string, name: string): string | undefined {
		return this.#scopeKey(moduleId, name);
	}

	// The qualified key `name` resolves to from `moduleId`, or undefined.
	// `name` may itself be qualified (a dictionary path `N\0key`); export
	// checks test the relevant root - exporting a dict exports its entries.
	#scopeKey(moduleId: string, name: string): string | undefined {
		const own = moduleId + SEP + name;
		if (this.#table.has(own)) return own;
		const sep = name.indexOf(SEP);
		const root = sep === -1 ? name : name.slice(0, sep);

		// A namespace binding: `lib::rest` reaches the bound module's exports.
		const bound = this.#bindings.get(moduleId)?.get(root);
		if (bound !== undefined) {
			if (sep === -1) return undefined; // bare `lib` is not a value
			const rest = name.slice(sep + 1);
			const restSep = rest.indexOf(SEP);
			const restRoot = restSep === -1 ? rest : rest.slice(0, restSep);
			if (this.#exports.get(bound)?.has(restRoot)) return bound + SEP + rest;
			return undefined;
		}

		for (const importId of this.#splats.get(moduleId) ?? []) {
			if (this.#exports.get(importId)?.has(root)) return importId + SEP + name;
		}
		return undefined;
	}
}

/**
 * The names a module's statements export. Only `.export <assignment>` defines
 * an exported *symbol* (exported macros are collected separately, and removed
 * from the stream, by macro expansion).
 */
export function exportedNames(module: {
	statements: readonly Statement[];
}): ReadonlySet<string> {
	const names = new Set<string>();
	for (const statement of module.statements) {
		const content = statement.content;
		if (content?.type !== "export") continue;
		if (content.nameToken) names.add(content.nameToken.text);
		else if (content.content?.type === "assignment") {
			names.add(content.content.identifier.text);
		}
	}
	return names;
}
