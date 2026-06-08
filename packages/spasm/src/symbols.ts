import type { Value } from "./value.ts";

interface Entry {
	value: Value | undefined;
	definedAt: readonly [number, number];
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
		definedAt: readonly [number, number],
	): readonly [number, number] | undefined {
		const prior = this.#entries.get(name);
		if (this.#definedThisPass.has(name)) return prior!.definedAt;
		this.#definedThisPass.add(name);
		this.#entries.set(name, { value, definedAt });
		return undefined;
	}

	resolve(name: string): Value | undefined {
		return this.#entries.get(name)?.value;
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
}
