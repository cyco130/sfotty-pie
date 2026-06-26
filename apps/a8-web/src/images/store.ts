// Thin CRUD over the IndexedDB metadata stores — user `entries` and built-in
// `overrides`. Blobs live in their own store (see blob-store.ts); this is only
// the structured, queryable metadata.

import {
	openLibraryDb,
	STORE_ENTRIES,
	STORE_OVERRIDES,
	withStore,
} from "./db.ts";
import type { OverrideRecord, StoredEntry } from "./metadata.ts";

export async function loadEntries(): Promise<StoredEntry[]> {
	const db = await openLibraryDb();
	return withStore<StoredEntry[]>(db, STORE_ENTRIES, "readonly", (store) =>
		store.getAll(),
	);
}

export async function putEntry(entry: StoredEntry): Promise<void> {
	const db = await openLibraryDb();
	await withStore(db, STORE_ENTRIES, "readwrite", (store) => store.put(entry));
}

export async function deleteEntry(id: string): Promise<void> {
	const db = await openLibraryDb();
	await withStore(db, STORE_ENTRIES, "readwrite", (store) => store.delete(id));
}

export async function loadOverrides(): Promise<OverrideRecord[]> {
	const db = await openLibraryDb();
	return withStore<OverrideRecord[]>(db, STORE_OVERRIDES, "readonly", (store) =>
		store.getAll(),
	);
}

export async function putOverride(record: OverrideRecord): Promise<void> {
	const db = await openLibraryDb();
	await withStore(db, STORE_OVERRIDES, "readwrite", (store) =>
		store.put(record),
	);
}
