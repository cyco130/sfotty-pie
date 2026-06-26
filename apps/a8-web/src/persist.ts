import { storageName } from "./storage.ts";

// Per-tab-stable persisted state. Reads sessionStorage (this tab's value, which
// survives its own reload) first, falling back to the localStorage "last used"
// seed a fresh tab inherits; writes update both. So multiple tabs never
// cross-clobber the running machine — each is stable across its own reloads, and
// a new tab inherits the most recent setup. Resilient: storage being
// unavailable (private mode, quota, disabled) just means no persistence.

/** Read a persisted JSON value, or `undefined` if absent/unparsable. */
export function loadPersisted(key: string): unknown {
	const name = storageName(key);
	let raw: string | null;
	try {
		raw = sessionStorage.getItem(name) ?? localStorage.getItem(name);
	} catch {
		return undefined;
	}
	if (raw === null) return undefined;
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

/** Persist a JSON value to this tab (sessionStorage) and the seed (localStorage). */
export function savePersisted(key: string, value: unknown): void {
	const name = storageName(key);
	try {
		const raw = JSON.stringify(value);
		sessionStorage.setItem(name, raw);
		localStorage.setItem(name, raw);
	} catch {
		// Storage unavailable or full — run without persistence this session.
	}
}

// Remove every `a8.*`-namespaced key from a storage area (leaves other sites'
// keys alone).
function clearArea(area: Storage): void {
	const prefix = storageName("");
	const keys: string[] = [];
	for (let i = 0; i < area.length; i++) {
		const key = area.key(i);
		if (key !== null && key.startsWith(prefix)) keys.push(key);
	}
	for (const key of keys) area.removeItem(key);
}

/** Drop this tab's overrides (sessionStorage), reverting to the saved seed. */
export function clearSessionPersisted(): void {
	try {
		clearArea(sessionStorage);
	} catch {
		// unavailable
	}
}

/** Drop all persisted state — this tab's and the saved seed (both stores). */
export function clearAllPersisted(): void {
	try {
		clearArea(sessionStorage);
		clearArea(localStorage);
	} catch {
		// unavailable
	}
}
