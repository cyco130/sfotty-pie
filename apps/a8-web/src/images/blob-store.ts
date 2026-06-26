// The user blob backend — where a user image's bytes physically live. The
// library references a blob through its locator `{ backend, ref }`; this is the
// `idb` implementation, the portable baseline. OPFS / File System Access
// backends slot in behind the same interface later.
//
// Blobs are content-addressed (`ref` = the canonical hash), so two entries with
// identical bytes share one row. Bytes are compressed at rest with deflate-raw
// when that wins (store-smaller); the hash is always over the uncompressed
// payload, so dedup and identity never see the compressed form.

import {
	type BlobRecord,
	openLibraryDb,
	STORE_BLOBS,
	withStore,
} from "./db.ts";
import { deflateRaw, inflateRaw } from "./compress.ts";

export interface BlobStore {
	readonly backend: "idb";
	/** Store `bytes` under content-addressed `ref`; idempotent (overwrites). */
	put(ref: string, bytes: Uint8Array): Promise<void>;
	get(ref: string): Promise<Uint8Array | undefined>;
	delete(ref: string): Promise<void>;
}

/** The IndexedDB-backed user blob store. */
export function idbBlobStore(): BlobStore {
	return {
		backend: "idb",

		async put(ref, bytes) {
			const db = await openLibraryDb();
			const compressed = await deflateRaw(bytes);
			// Store-smaller: keep the compressed form only when it actually wins,
			// so incompressible blobs (ROMs) never inflate. `compressed.buffer` is
			// exact; a raw subarray view is copied to its own buffer.
			const record: BlobRecord =
				compressed.length < bytes.length
					? { ref, bytes: compressed.buffer, encoding: "deflate-raw" }
					: { ref, bytes: bytes.slice().buffer, encoding: "raw" };
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
			const stored = new Uint8Array(record.bytes);
			return record.encoding === "deflate-raw" ? inflateRaw(stored) : stored;
		},

		async delete(ref) {
			const db = await openLibraryDb();
			await withStore(db, STORE_BLOBS, "readwrite", (store) =>
				store.delete(ref),
			);
		},
	};
}
