import {
	type Binding,
	defaultBindingSet,
	labelFor,
	loadLayoutLabels,
} from "./key-bindings.ts";
import { loadPersisted, savePersisted } from "./persist.ts";

// The user's binding set, persisted as one flat list. Generated from the
// defaults on first run (and on explicit reset) and then owned by the user — so
// later code changes to the defaults don't reach an existing store until it's
// reset. Labels are baked in at generation (resolved from the live layout) so
// they survive as editable, layout-stable legends; bump VERSION to invalidate
// stores when the shape changes.
export const KEY_BINDINGS_KEY = "key-bindings";
// v2: bindings keyed by `code` only (the `{ key }` trigger arm was dropped).
// v3: + the global Cmd/Alt+K → OPEN_PALETTE binding and the `scope` field.
const VERSION = 3;

interface Stored {
	v: number;
	bindings: Binding[];
}

/** The persisted binding set, or `undefined` if absent / outdated / malformed
 *  (the caller then generates fresh defaults). */
export function loadStoredBindings(): Binding[] | undefined {
	const stored = loadPersisted(KEY_BINDINGS_KEY) as Stored | undefined;
	if (stored?.v === VERSION && Array.isArray(stored.bindings)) {
		return stored.bindings;
	}
	return undefined;
}

/** Generate the default flat binding set with labels resolved from the live
 *  keyboard layout, persist it, and return it — the first-run and reset path. */
export async function freshBindings(mac: boolean): Promise<Binding[]> {
	const layout = await loadLayoutLabels();
	const bindings = defaultBindingSet(mac).map(
		(b): Binding => ({ ...b, label: labelFor(b, layout) }),
	);
	savePersisted(KEY_BINDINGS_KEY, { v: VERSION, bindings } satisfies Stored);
	return bindings;
}
