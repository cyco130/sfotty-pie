import type { LoadedModule } from "./loader.ts";
import type { Statement } from "./parser.ts";
import {
	SEP,
	SymbolTable,
	type SymbolAttributes,
	type SymbolKind,
} from "./symbols.ts";
import type { Value } from "./value.ts";

type Span = readonly [number, number];

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
		attributes?: SymbolAttributes,
	): Span | undefined {
		return this.#table.define(
			moduleId + SEP + name,
			value,
			kind,
			span,
			attributes,
		);
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

	/** The kind and placement attributes of `name` as seen from `moduleId`. */
	attributesOf(
		moduleId: string,
		name: string,
	): { kind: SymbolKind; attributes: SymbolAttributes } | undefined {
		const key = this.#scopeKey(moduleId, name);
		if (key === undefined) return undefined;
		const kind = this.#table.kindOf(key);
		const attributes = this.#table.attributesOf(key);
		if (kind === undefined || attributes === undefined) return undefined;
		return { kind, attributes };
	}

	/**
	 * A module's resolved symbols, unqualified (for the assemble result).
	 * Dictionary entries surface under their user-facing `::` paths.
	 */
	resolvedFor(moduleId: string): Map<string, Value> {
		const prefix = moduleId + SEP;
		const out = new Map<string, Value>();
		for (const [key, value] of this.#table.resolved()) {
			// Functions are static machinery, not result data.
			if (typeof value === "object") continue;
			if (key.startsWith(prefix)) {
				out.set(key.slice(prefix.length).split(SEP).join("::"), value);
			}
		}
		return out;
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
