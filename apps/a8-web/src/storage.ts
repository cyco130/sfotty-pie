// The root namespace for all of this emulator's client-side storage —
// IndexedDB databases, localStorage keys, and (later) OPFS directories. A
// sibling emulator would use its own root, so storage never collides even when
// two share an origin. Everything that names a store goes through here, so the
// prefix lives in exactly one place.

const STORAGE_NS = "a8";

/** A namespaced storage name, dot-joined: `a8.<…parts>`. */
export function storageName(...parts: string[]): string {
	return [STORAGE_NS, ...parts].join(".");
}
