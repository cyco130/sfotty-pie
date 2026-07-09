import {
	type Binding,
	bakeDefaults,
	defaultBindingSet,
	loadLayoutLabels,
	upperLegends,
} from "./key-bindings.ts";
import { KEYBOARD_LAYOUTS } from "./keyboard-layouts.ts";
import { loadPersisted, savePersisted } from "./persist.ts";

// The user's binding set, persisted as one flat list. Generated from the
// defaults on first run (and on explicit reset) and then owned by the user - so
// later code changes to the defaults don't reach an existing store until it's
// reset. Labels and anchoring are baked in at generation from a layout snapshot
// (see below), so the stored set is a self-consistent snapshot that never shifts
// on refresh; bump VERSION to invalidate stores when the shape changes.
export const KEY_BINDINGS_KEY = "key-bindings";
// v2: bindings keyed by `code` only (the `{ key }` trigger arm was dropped).
// v3: + the global Cmd/Alt+K → OPEN_PALETTE binding and the `scope` field.
// v4: letter app-shortcuts (palette, the Alt/Ctrl+letter aliases) anchored to
//     the produced letter via the layout, not the QWERTY position.
const VERSION = 4;

// The layout snapshot the current bindings were baked from - `code` → legend.
// Persisted alongside the bindings so it survives refresh (labels stay stable)
// and so the editor can label brand-new bindings the same way; on reset it's
// re-read from the live keyboard (or, absent getLayoutMap, the user's saved
// layout). Serialized as a plain object.
export const KEY_LAYOUT_KEY = "key-layout";

// The user's layout choice for the manual picker: "auto" (use getLayoutMap when
// available) or a `KEYBOARD_LAYOUTS` id. A manual pick wins over getLayoutMap, so
// it's testable everywhere and honors "declare once"; default is "auto".
export const KEY_LAYOUT_PREF = "key-layout-pref";
export const LAYOUT_AUTO = "auto";

export function saveLayoutPref(pref: string): void {
	savePersisted(KEY_LAYOUT_PREF, pref);
}

export function loadLayoutPref(): string {
	const stored = loadPersisted(KEY_LAYOUT_PREF);
	return typeof stored === "string" ? stored : LAYOUT_AUTO;
}

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

/** Persist the current flat binding set (the editor's save path). */
export function saveBindings(bindings: Binding[]): void {
	savePersisted(KEY_BINDINGS_KEY, { v: VERSION, bindings } satisfies Stored);
}

/** Persist the layout snapshot the bindings were baked from. */
export function saveLayout(layout: Map<string, string>): void {
	savePersisted(KEY_LAYOUT_KEY, Object.fromEntries(layout));
}

/** The persisted layout snapshot, or `undefined` if absent / malformed. */
export function loadStoredLayout(): Map<string, string> | undefined {
	const stored = loadPersisted(KEY_LAYOUT_KEY);
	if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
		return undefined;
	}
	const map = new Map<string, string>();
	for (const [code, label] of Object.entries(stored)) {
		if (typeof label === "string") map.set(code, label);
	}
	return map;
}

// The layout map to bake from: a manual pick wins (the setup page); else the live
// keyboard layout when the browser exposes it (re-read, so a reset in auto mode
// picks up an OS-level switch); else empty - which bakes plain QWERTY.
async function resolveLayout(): Promise<Map<string, string>> {
	const pref = loadLayoutPref();
	if (pref !== LAYOUT_AUTO) {
		const layout = KEYBOARD_LAYOUTS.find((l) => l.id === pref);
		if (layout) return upperLegends(Object.entries(layout.map));
	}
	const live = await loadLayoutLabels();
	if (live.size > 0) return live;
	return new Map();
}

/** Generate the default binding set from the resolved layout, persisting both the
 *  bindings and the layout snapshot - the first-run and reset path. Returns both
 *  so the caller can seed the editor's labeling map without re-reading storage. */
export async function freshBindings(
	mac: boolean,
): Promise<{ bindings: Binding[]; layout: Map<string, string> }> {
	const layout = await resolveLayout();
	saveLayout(layout);
	const bindings = bakeDefaults(defaultBindingSet(mac), layout);
	saveBindings(bindings);
	return { bindings, layout };
}

/** The layout snapshot for labeling the editor's live preview: the persisted one,
 *  or - for a store predating the snapshot - initialized once from the live
 *  layout so previews aren't stuck on QWERTY until the next reset. */
export async function ensureStoredLayout(): Promise<Map<string, string>> {
	const stored = loadStoredLayout();
	if (stored) return stored;
	const live = await loadLayoutLabels();
	if (live.size > 0) saveLayout(live);
	return live;
}
