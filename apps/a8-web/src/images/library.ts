// The unified image library: the merge of built-in images (the build manifest)
// and user images (IndexedDB), plus the operations over them. This is the one
// abstraction the UI and the host see; it hides whether an image is bundled or
// uploaded, and where its bytes physically live.

import { computed, signal } from "@preact/signals";
import {
	canonicalize,
	detectFirmware,
	type FirmwareType,
	type ImageKind,
} from "@sfotty-pie/a8";
import {
	builtinFirmware,
	type FirmwareLibraryEntry,
} from "virtual:firmware-library";
import { idbBlobStore } from "./blob-store.ts";
import { loadImageBytes } from "./fetch.ts";
import { sha256Hex } from "./hash.ts";
import type {
	ImageEntry,
	ImageSlot,
	StoredEntry,
	UserMeta,
} from "./metadata.ts";
import {
	clearAll,
	deleteEntry,
	loadEntries,
	loadOverrides,
	putEntry,
} from "./store.ts";

const blobs = idbBlobStore();

/**
 * A bulk import's phase: `preparing` while the dropped folder tree is walked
 * (no count yet), then `adding` while files are ingested. `elapsedMs` is the
 * ingest time so far — computed here (not in render) so an indicator can derive
 * an ETA purely.
 */
export type ImportProgress =
	| { phase: "preparing" }
	| { phase: "adding"; done: number; total: number; elapsedMs: number };

/**
 * Live progress of an in-flight bulk import, or null when none is running.
 * Module-level (not panel state) so a top-level indicator keeps tracking it
 * after the library panel is closed — the import runs to completion regardless.
 * The `preparing` phase is set by the caller (it owns the folder walk); this
 * module drives `adding`.
 */
export const importProgress = signal<ImportProgress | null>(null);

// Live user state, loaded from IndexedDB once on first use, then kept in sync by
// add/remove. The merge below is reactive on these.
const userEntries = signal<StoredEntry[]>([]);
const builtinOverrides = signal<Map<string, Partial<UserMeta>>>(new Map());
let loadPromise: Promise<void> | null = null;

/**
 * Load the user's entries + built-in overrides from IndexedDB (idempotent).
 * Resilient: if IndexedDB is unavailable (private mode, quota, blocked), the
 * library runs with built-ins only rather than failing — callers (including the
 * host's boot path) can always await it.
 */
export function readyLibrary(): Promise<void> {
	return (loadPromise ??= (async () => {
		try {
			const [entries, overrides] = await Promise.all([
				loadEntries(),
				loadOverrides(),
			]);
			userEntries.value = entries;
			builtinOverrides.value = new Map(overrides.map((o) => [o.id, o.user]));
		} catch {
			// No persistent library this session; built-ins still work.
		}
	})());
}

// --- built-in ↔ unified mapping -----------------------------------------

/** A built-in's stable identity: its firmware key when known, else its path id. */
function builtinId(fw: FirmwareLibraryEntry): string {
	return fw.firmwareKey ?? fw.id;
}

/** Prime the slot pickers from a firmware type — standard-8K carts only. */
function primeSlots(
	type: FirmwareType | null,
	kind: ImageKind,
): ImageSlot[] | undefined {
	if (kind.type !== "cart") return undefined;
	if (type === "basic") return ["basic"];
	if (type === "game") return ["game"];
	return undefined;
}

function builtinEntry(
	fw: FirmwareLibraryEntry & { kind: ImageKind },
	override: Partial<UserMeta> | undefined,
): ImageEntry {
	const slots = primeSlots(fw.firmwareType, fw.kind);
	return {
		id: builtinId(fw),
		hash: fw.hash,
		source: "builtin",
		size: fw.size,
		locator: { kind: "builtin", url: fw.url },
		derived: fw.kind,
		user: { displayName: fw.name, ...(slots && { slots }), ...override },
	};
}

function userImageEntry(e: StoredEntry): ImageEntry {
	return {
		id: e.id,
		hash: e.hash,
		source: "user",
		size: e.size,
		...(e.transient && { transient: true }),
		locator: { kind: "user", backend: e.locator.backend, ref: e.locator.ref },
		derived: e.derived,
		user: e.user,
	};
}

/** The merged library: built-ins (with overrides applied) ∪ user entries. */
export const libraryEntries = computed<ImageEntry[]>(() => {
	const overrides = builtinOverrides.value;
	const builtins = builtinFirmware
		.filter(
			(fw): fw is FirmwareLibraryEntry & { kind: ImageKind } =>
				fw.kind !== null,
		)
		.map((fw) => builtinEntry(fw, overrides.get(builtinId(fw))));
	return [...builtins, ...userEntries.value.map(userImageEntry)];
});

export function getImage(id: string): ImageEntry | undefined {
	return libraryEntries.value.find((e) => e.id === id);
}

/**
 * Resolve an image's bytes: a built-in serves its raw asset (a `#slice` of it);
 * a user image serves its canonical blob (decompressed by the blob store).
 */
export async function getImageBytes(id: string): Promise<Uint8Array> {
	const entry = getImage(id);
	if (!entry) throw new Error(`unknown image "${id}"`);
	if (entry.locator.kind === "builtin") {
		return loadImageBytes(entry.locator.url, entry.id);
	}
	const bytes = await blobs.get(entry.locator.ref);
	if (!bytes) throw new Error(`missing blob for "${id}"`);
	return bytes;
}

/** The outcome of an {@link addImage}: entries created, and how many deduped. */
export interface AddResult {
	added: ImageEntry[];
	deduped: number;
}

/** Summary counts for a bulk {@link addFiles}. */
export interface BulkAddResult {
	added: number;
	deduped: number;
	failed: number;
}

// Ingest one file's canonical pieces into `into`, deduping against `seen` (a set
// of hashes it updates — including earlier pieces in the same batch). Does the
// blob + metadata writes. Throws if the file isn't a recognized image. A
// built-in match is never a reason to skip storing (a later deploy may drop the
// built-in), so `seen` holds only user hashes.
async function ingestFile(
	bytes: Uint8Array,
	fileName: string,
	seen: Set<string>,
	into: StoredEntry[],
	transient = false,
): Promise<{ added: number; deduped: number }> {
	const pieces = canonicalize(bytes, fileName); // throws on an unrecognized file
	const baseName = fileName.replace(/\.[^./]+$/, "");
	let added = 0;
	let deduped = 0;
	for (const piece of pieces) {
		const hash = await sha256Hex(piece.bytes);
		if (seen.has(hash)) {
			deduped++; // already in the user's library
			continue;
		}
		seen.add(hash);
		const raw = bytes.subarray(piece.from, piece.to);
		const fw = detectFirmware(raw);
		const slots = primeSlots(fw?.type ?? null, piece.kind);
		const entry: StoredEntry = {
			id: crypto.randomUUID(),
			hash,
			size: piece.bytes.length,
			createdAt: Date.now(),
			...(transient && { transient: true }),
			locator: { backend: "idb", ref: hash },
			derived: piece.kind,
			user: {
				displayName:
					fw?.name ?? (piece.role ? `${baseName} (${piece.role})` : baseName),
				...(slots && { slots }),
			},
		};
		await blobs.put(hash, piece.bytes);
		await putEntry(entry);
		into.push(entry);
		added++;
	}
	return { added, deduped };
}

/**
 * Resolve an in-memory image (e.g. one being booted/attached from the file
 * picker) to a library id: return the existing entry's id if its canonical bytes
 * are already in the library, else add it (as `transient` when so flagged) and
 * return the new id. Returns null if the bytes aren't a recognized image.
 */
export async function addOrFindImage(
	bytes: Uint8Array,
	fileName: string,
	transient: boolean,
): Promise<string | null> {
	await readyLibrary();
	let hash: string;
	try {
		const piece = canonicalize(bytes, fileName)[0];
		if (!piece) return null;
		hash = await sha256Hex(piece.bytes);
	} catch {
		return null; // unrecognized
	}
	const existing = userEntries.value.find((e) => e.hash === hash);
	if (existing) return existing.id;

	const into: StoredEntry[] = [];
	await ingestFile(
		bytes,
		fileName,
		new Set(userEntries.value.map((e) => e.hash)),
		into,
		transient,
	);
	const added = into[0];
	if (!added) return null;
	userEntries.value = [...userEntries.value, ...into];
	return added.id;
}

/**
 * Ingest one uploaded file: canonicalize (splitting a combined dump), hash, dedup
 * against existing user entries, store the new pieces. Throws if unrecognized.
 */
export async function addImage(
	bytes: Uint8Array,
	fileName: string,
): Promise<AddResult> {
	await readyLibrary();
	const seen = new Set(userEntries.value.map((e) => e.hash));
	const into: StoredEntry[] = [];
	const { deduped } = await ingestFile(bytes, fileName, seen, into);
	if (into.length > 0) userEntries.value = [...userEntries.value, ...into];
	return { added: into.map(userImageEntry), deduped };
}

/**
 * Bulk-ingest many files (a folder drop). Dedups via a Set (O(1) per file) and
 * commits each file to the merged list *as it lands*, so the library stays
 * usable mid-import (preferred over finishing faster). Drives {@link
 * importProgress} so a top-level indicator can track it independent of any
 * panel. Unrecognized files are counted, not thrown. Slow but live at thousands
 * of items — chunked batching is the lever if that changes.
 */
export async function addFiles(files: File[]): Promise<BulkAddResult> {
	await readyLibrary();
	const seen = new Set(userEntries.value.map((e) => e.hash));
	let added = 0;
	let deduped = 0;
	let failed = 0;
	let done = 0;
	const total = files.length;
	const startedAt = performance.now();
	importProgress.value = { phase: "adding", done: 0, total, elapsedMs: 0 };
	try {
		for (const file of files) {
			const into: StoredEntry[] = [];
			try {
				const bytes = new Uint8Array(await file.arrayBuffer());
				const result = await ingestFile(bytes, file.name, seen, into);
				added += result.added;
				deduped += result.deduped;
			} catch {
				failed++; // unrecognized — canonicalize threw
			}
			if (into.length > 0) userEntries.value = [...userEntries.value, ...into];
			importProgress.value = {
				phase: "adding",
				done: ++done,
				total,
				elapsedMs: performance.now() - startedAt,
			};
		}
	} finally {
		importProgress.value = null;
	}
	return { added, deduped, failed };
}

/**
 * Wipe the entire library store (entries, blobs, overrides) and reset the
 * in-memory state — a dev/test reset, exposed on the console, not the UI.
 */
export async function nukeLibrary(): Promise<void> {
	await clearAll();
	userEntries.value = [];
	builtinOverrides.value = new Map();
	loadPromise = null;
}

/**
 * Overwrite a user image's bytes in place — e.g. saving a disk the machine has
 * written to. Re-hashes, rewrites the (content-addressed) blob and reclaims the
 * old one, keeping the entry id. Returns false (a no-op) for built-ins or an
 * unknown id, which aren't writable.
 */
export async function updateImage(
	id: string,
	bytes: Uint8Array,
): Promise<boolean> {
	await readyLibrary();
	const entry = userEntries.value.find((e) => e.id === id);
	if (!entry) return false;

	const hash = await sha256Hex(bytes);
	const oldRef = entry.locator.ref;
	await blobs.put(hash, bytes);
	const updated: StoredEntry = {
		...entry,
		hash,
		size: bytes.length,
		locator: { ...entry.locator, ref: hash },
	};
	await putEntry(updated);
	userEntries.value = userEntries.value.map((e) => (e.id === id ? updated : e));
	if (
		oldRef !== hash &&
		!userEntries.value.some((e) => e.locator.ref === oldRef)
	) {
		await blobs.delete(oldRef);
	}
	return true;
}

/** Remove a user image; reclaim its blob if no other entry still references it. */
export async function removeImage(id: string): Promise<void> {
	await readyLibrary();
	const entry = userEntries.value.find((e) => e.id === id);
	if (!entry) return; // built-ins aren't removable
	await deleteEntry(id);
	const remaining = userEntries.value.filter((e) => e.id !== id);
	if (!remaining.some((e) => e.hash === entry.hash)) {
		await blobs.delete(entry.hash);
	}
	userEntries.value = remaining;
}
