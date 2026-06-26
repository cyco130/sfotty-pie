// The image library's metadata model — the type layer shared across both
// built-in images (the build manifest) and user images (IndexedDB).
//
// Identity is decoupled from content: an entry's `id` is a filename-derived
// slug for built-ins and a minted UUID for user uploads, while `hash` is a
// content attribute (non-unique) used only for dedup detection and
// content-addressed blob sharing. Metadata is two-tier: `derived` is
// recomputed from the bytes (index/cache), `user` is the overridable layer
// primed from the known-image registry.

import type { ImageKind } from "@sfotty-pie/a8";

/**
 * Content-derived facts, recomputed from the bytes — the package's
 * canonicalization result reused verbatim (`os`→`sizeClass`, `cart`→`cartType`,
 * `disk`→`sectorSize`/`sectors`, `xex`).
 */
export type DerivedMeta = ImageKind;

/** The coarse, canonical kind of an image — what it intrinsically is. */
export type ImageType = ImageKind["type"];

/** A slot picker an image can be surfaced in (standard-8K carts only). */
export type ImageSlot = "basic" | "game";

/** User-editable metadata, primed for known firmware/software. */
export interface UserMeta {
	displayName: string;
	/** Slot pickers this image is surfaced in (standard-8K carts only). */
	slots?: ImageSlot[];
	tags?: string[];
	// later: compat (models / tv / basic / requiresOs)
}

/** How a user blob is encoded at rest. Compression-at-rest is deferred. */
export type BlobEncoding = "raw" | "deflate-raw";

/** Which physical blob backend holds a user image's bytes. */
export type BlobBackend = "idb"; // opfs / fsa later

/**
 * Where an entry's bytes come from — the one thing `getBytes` switches on. The
 * blob store self-describes its encoding, so the user locator carries only the
 * backend + ref (no encoding here).
 */
export type BlobLocator =
	| {
			kind: "builtin";
			/** Asset URL; may carry a `#start-end` slice fragment. */
			url: string;
	  }
	| { kind: "user"; backend: BlobBackend; ref: string };

/** A library image — built-in or user — as the merged library presents it. */
export interface ImageEntry {
	/** Stable identity: a filename slug for built-ins, a UUID for user images. */
	id: string;
	/** SHA-256 of the canonical payload (hex) — a content attribute, non-unique. */
	hash: string;
	source: "builtin" | "user";
	/** Total canonical file size in bytes. */
	size: number;
	locator: BlobLocator;
	derived: DerivedMeta;
	user: UserMeta;
}

/** A user image as persisted in the IndexedDB `entries` store. */
export interface StoredEntry {
	/** Minted UUID. */
	id: string;
	/** SHA-256 hex; indexed (non-unique). */
	hash: string;
	/** Total file size in bytes; indexed. */
	size: number;
	/** Creation time, ms since epoch; indexed. */
	createdAt: number;
	locator: { backend: BlobBackend; ref: string };
	derived: DerivedMeta;
	user: UserMeta;
}

/** A built-in metadata override (the `overrides` store), keyed by built-in id. */
export interface OverrideRecord {
	/** The built-in slug. */
	id: string;
	user: Partial<UserMeta>;
}
