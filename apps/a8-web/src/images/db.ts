// The image library's IndexedDB store: `a8.library`, three object stores.
//
//   entries    one row per USER image, keyed by its UUID `id`
//   blobs      content-addressed bytes (keyPath = the hash), shared across
//              same-bytes entries
//   overrides  user edits to BUILT-IN metadata, keyed by the built-in slug
//
// The entries/blobs split keeps listing and filtering from ever deserializing
// megabyte blobs. Schema changes bump DB_VERSION and extend migrate().

import { storageName } from "../storage.ts";
import type { BlobEncoding } from "./metadata.ts";

const DB_NAME = storageName("library");
const DB_VERSION = 1;

export const STORE_ENTRIES = "entries";
export const STORE_BLOBS = "blobs";
export const STORE_OVERRIDES = "overrides";

/** A content-addressed blob row in the `blobs` store. */
export interface BlobRecord {
	/** The content hash — the store's key, and the locator's `ref`. */
	ref: string;
	bytes: ArrayBuffer;
	encoding: BlobEncoding;
}

let dbPromise: Promise<IDBDatabase> | undefined;

/** Open (and lazily memoize) the library database. */
export function openLibraryDb(): Promise<IDBDatabase> {
	return (dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => migrate(request.result);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	}));
}

function migrate(db: IDBDatabase): void {
	if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
		const entries = db.createObjectStore(STORE_ENTRIES, { keyPath: "id" });
		entries.createIndex("hash", "hash", { unique: false });
		entries.createIndex("type", "derived.type");
		entries.createIndex("size", "size");
		entries.createIndex("createdAt", "createdAt");
		// Sparse type-fact indexes: a record without the keyPath isn't indexed,
		// so each is automatically scoped to the type that has the fact.
		entries.createIndex("cartType", "derived.cartType");
		entries.createIndex("sectorSize", "derived.sectorSize");
		entries.createIndex("sectors", "derived.sectors");
		// Booleans can't be IndexedDB keys, so slot membership is a multiEntry
		// array index rather than per-slot boolean flags.
		entries.createIndex("slots", "user.slots", { multiEntry: true });
		entries.createIndex("tags", "user.tags", { multiEntry: true });
	}
	if (!db.objectStoreNames.contains(STORE_BLOBS)) {
		db.createObjectStore(STORE_BLOBS, { keyPath: "ref" });
	}
	if (!db.objectStoreNames.contains(STORE_OVERRIDES)) {
		db.createObjectStore(STORE_OVERRIDES, { keyPath: "id" });
	}
}

/**
 * Run a single-store operation in its own transaction and resolve with the
 * request's result once the transaction commits.
 */
export function withStore<T>(
	db: IDBDatabase,
	store: string,
	mode: IDBTransactionMode,
	op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const transaction = db.transaction(store, mode);
		const request = op(transaction.objectStore(store));
		transaction.oncomplete = () => resolve(request.result);
		transaction.onerror = () => reject(transaction.error);
		transaction.onabort = () => reject(transaction.error);
	});
}
