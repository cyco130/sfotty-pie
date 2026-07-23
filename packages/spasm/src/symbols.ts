import type { Value } from "./value.ts";

/**
 * The qualified-name separator. A NUL can't appear in a module id or symbol
 * name, so joined keys never collide. Used for module scoping (module NUL
 * name) and dictionary entries (dict NUL key) alike; the user-facing spelling
 * of a dictionary path is `::`.
 */
export const SEP = "\0";

/**
 * A label is address-valued (`name:` / `name := expr`); a constant is
 * `name = expr`; a namespace is a dict-valued `name = { ... }` (the dict node
 * itself - its entries are ordinary constants under qualified names).
 */
export type SymbolKind = "label" | "constant" | "namespace";

/**
 * Assembler-opaque placement attributes: tracked and surfaced, never
 * interpreted by the assembler itself. `size` so far; more (address space,
 * load address) will join with the same shape.
 */
export interface SymbolAttributes {
	size?: Value | undefined;
}

interface Entry {
	value: Value | undefined;
	kind: SymbolKind;
	definedAt: readonly [number, number];
	attributes: SymbolAttributes;
}

/**
 * The (single, flat) symbol table. Values persist across passes so forward
 * references resolve via the previous pass; `define-once` is enforced per pass.
 */
export class SymbolTable {
	#entries = new Map<string, Entry>();
	#definedThisPass = new Set<string>();

	/** Begin a fresh pass: reset the per-pass define-once tracking. */
	beginPass(): void {
		this.#definedThisPass.clear();
	}

	/**
	 * Define a symbol (re-set across passes). If it was already defined earlier
	 * in THIS pass it's a duplicate: the prior definition's span is returned and
	 * the first definition is kept.
	 */
	define(
		name: string,
		value: Value | undefined,
		kind: SymbolKind,
		definedAt: readonly [number, number],
		attributes: SymbolAttributes = {},
	): readonly [number, number] | undefined {
		const prior = this.#entries.get(name);
		if (this.#definedThisPass.has(name)) return prior!.definedAt;
		this.#definedThisPass.add(name);
		this.#entries.set(name, { value, kind, definedAt, attributes });
		return undefined;
	}

	resolve(name: string): Value | undefined {
		return this.#entries.get(name)?.value;
	}

	/** Whether `name` is defined (in any prior pass), regardless of its value. */
	has(name: string): boolean {
		return this.#entries.has(name);
	}

	kindOf(name: string): SymbolKind | undefined {
		return this.#entries.get(name)?.kind;
	}

	/** Snapshot of values, for fixpoint detection. */
	snapshot(): Map<string, Value | undefined> {
		const snapshot = new Map<string, Value | undefined>();
		for (const [name, entry] of this.#entries) snapshot.set(name, entry.value);
		return snapshot;
	}

	/** Did any value (or the set of names) change since the snapshot? */
	changedSince(snapshot: Map<string, Value | undefined>): boolean {
		if (snapshot.size !== this.#entries.size) return true;
		for (const [name, entry] of this.#entries) {
			if (!snapshot.has(name) || snapshot.get(name) !== entry.value)
				return true;
		}
		return false;
	}

	/** All resolved symbols (unresolved ones omitted). */
	resolved(): Map<string, Value> {
		const out = new Map<string, Value>();
		for (const [name, entry] of this.#entries) {
			if (entry.value !== undefined) out.set(name, entry.value);
		}
		return out;
	}

	/** A symbol's placement attributes; undefined when the symbol isn't known. */
	attributesOf(name: string): SymbolAttributes | undefined {
		return this.#entries.get(name)?.attributes;
	}
}
