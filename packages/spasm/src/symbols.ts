import { isEqual, type Value } from "./value.ts";

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
 * itself - its entries are ordinary constants under qualified names); a
 * function is an expression macro (`DOUBLE(x) = 2 * x`).
 */
export type SymbolKind = "label" | "constant" | "namespace" | "function";

interface Entry {
	value: Value | undefined;
	kind: SymbolKind;
	definedAt: readonly [number, number];
}

/**
 * Where a symbol was defined: the module whose source `start`/`end` index
 * into, and the symbol's kind. Hygiene keeps file and scope aligned: a
 * macro-stamped definition defines in the macro's module, and its tokens come
 * from that module's source. Kind `"module"` marks the synthetic definition
 * every module gets (keyed by its bare id - unambiguous, since qualified
 * names always contain `SEP`), the target of `.import` specifier references.
 * Kinds `"macro"` and `"parameter"` mark code-macro definitions, which live
 * in their own namespace: keyed `module SEP SEP name` (and
 * `module SEP SEP name SEP param`) - the double `SEP` cannot occur in a
 * symbol key, whose components are never empty.
 */
export interface Definition {
	file: string;
	start: number;
	end: number;
	kind: SymbolKind | "module" | "macro" | "parameter";
	/** The converged value; `undefined` when it never resolved. */
	value: Value | undefined;
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
	): readonly [number, number] | undefined {
		const prior = this.#entries.get(name);
		if (this.#definedThisPass.has(name)) return prior!.definedAt;
		this.#definedThisPass.add(name);
		this.#entries.set(name, { value, kind, definedAt });
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

	definedAt(name: string): readonly [number, number] | undefined {
		return this.#entries.get(name)?.definedAt;
	}

	/** Every defined symbol's kind and definition span, by qualified key. */
	*definitions(): IterableIterator<
		[string, SymbolKind, readonly [number, number]]
	> {
		for (const [name, entry] of this.#entries) {
			yield [name, entry.kind, entry.definedAt];
		}
	}

	/** Snapshot of values, for fixpoint detection. */
	snapshot(): Map<string, Value | undefined> {
		const snapshot = new Map<string, Value | undefined>();
		for (const [name, entry] of this.#entries) snapshot.set(name, entry.value);
		return snapshot;
	}

	/**
	 * Did any value (or the set of names) change since the snapshot? Compared
	 * with `isEqual`, not `!==`: an aggregate is rebuilt every pass, so identity
	 * would always differ, and skipping aggregates entirely would converge early
	 * on a change still in flight inside one (see design.md).
	 */
	changedSince(snapshot: Map<string, Value | undefined>): boolean {
		if (snapshot.size !== this.#entries.size) return true;
		for (const [name, entry] of this.#entries) {
			if (!snapshot.has(name)) return true;
			if (!isEqual(snapshot.get(name), entry.value)) return true;
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
}
