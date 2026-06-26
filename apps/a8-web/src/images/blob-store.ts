// The user blob backend — where a user image's bytes physically live. The
// library references a blob through its locator `{ backend, ref }`; this is the
// `idb` implementation, the portable baseline. OPFS / File System Access
// backends slot in behind the same interface later.
//
// Blobs are content-addressed (`ref` = the canonical hash), so two entries with
// identical bytes share one row. Compression-at-rest is deferred: bytes are
// stored and returned raw, with the `encoding` field reserved for it.

import {
	type BlobRecord,
	openLibraryDb,
	STORE_BLOBS,
	withStore,
} from "./db.ts";
import type { BlobEncoding } from "./metadata.ts";

export interface BlobStore {
	readonly backend: "idb";
	/** Store `bytes` under content-addressed `ref`; idempotent (overwrites). */
	put(ref: string, bytes: Uint8Array, encoding?: BlobEncoding): Promise<void>;
	get(ref: string): Promise<Uint8Array | undefined>;
	delete(ref: string): Promise<void>;
}

/** The IndexedDB-backed user blob store. */
export function idbBlobStore(): BlobStore {
	return {
		backend: "idb",

		async put(ref, bytes, encoding = "raw") {
			const db = await openLibraryDb();
			// Copy into a standalone ArrayBuffer — `bytes` may be a subarray view
			// over a larger buffer (e.g. an XEGS split), which structured-clone
			// would otherwise persist whole.
			const record: BlobRecord = {
				ref,
				bytes: bytes.slice().buffer,
				encoding,
			};
			await withStore(db, STORE_BLOBS, "readwrite", (store) =>
				store.put(record),
			);
		},

		async get(ref) {
			const db = await openLibraryDb();
			const record = await withStore<BlobRecord | undefined>(
				db,
				STORE_BLOBS,
				"readonly",
				(store) => store.get(ref),
			);
			if (!record) return undefined;
			if (record.encoding !== "raw") {
				// Only raw is written today; a non-raw row would predate its decoder.
				throw new Error(`Unsupported blob encoding "${record.encoding}"`);
			}
			return new Uint8Array(record.bytes);
		},

		async delete(ref) {
			const db = await openLibraryDb();
			await withStore(db, STORE_BLOBS, "readwrite", (store) =>
				store.delete(ref),
			);
		},
	};
}
