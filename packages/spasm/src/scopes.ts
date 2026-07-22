import type { LoadedModule } from "./loader.ts";
import type { Statement } from "./parser.ts";
import { SymbolTable, type SymbolKind } from "./symbols.ts";
import type { Value } from "./value.ts";

// A NUL separator can't appear in a module id or symbol name, so qualified keys
// never collide.
const SEP = "\0";

type Span = readonly [number, number];

/**
 * Per-module symbol scopes layered over one `SymbolTable` via qualified keys.
 * A name resolves to a module's own symbol, or to an exported symbol of a
 * module it splat-imports. Module export sets and import lists are structural,
 * computed once.
 */
export class Scopes {
	#table = new SymbolTable();
	#exports = new Map<string, ReadonlySet<string>>();
	#imports = new Map<string, readonly string[]>();

	constructor(modules: readonly LoadedModule[]) {
		for (const module of modules) {
			this.#imports.set(module.id, module.imports);
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
	): Span | undefined {
		return this.#table.define(moduleId + SEP + name, value, kind, span);
	}

	/** Resolve `name` as seen from `moduleId`: own scope, then splat imports. */
	resolve(moduleId: string, name: string): Value | undefined {
		const key = this.#scopeKey(moduleId, name);
		return key === undefined ? undefined : this.#table.resolve(key);
	}

	/** A module's resolved symbols, unqualified (for the assemble result). */
	resolvedFor(moduleId: string): Map<string, Value> {
		const prefix = moduleId + SEP;
		const out = new Map<string, Value>();
		for (const [key, value] of this.#table.resolved()) {
			if (key.startsWith(prefix)) out.set(key.slice(prefix.length), value);
		}
		return out;
	}

	// The qualified key `name` resolves to from `moduleId`, or undefined.
	#scopeKey(moduleId: string, name: string): string | undefined {
		const own = moduleId + SEP + name;
		if (this.#table.has(own)) return own;
		for (const importId of this.#imports.get(moduleId) ?? []) {
			if (this.#exports.get(importId)?.has(name)) return importId + SEP + name;
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
		if (content?.type === "export" && content.content.type === "assignment") {
			names.add(content.content.identifier.text);
		}
	}
	return names;
}
