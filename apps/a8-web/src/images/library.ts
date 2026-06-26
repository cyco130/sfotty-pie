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
import { deleteEntry, loadEntries, loadOverrides, putEntry } from "./store.ts";

const blobs = idbBlobStore();

// Live user state, loaded from IndexedDB once on first use, then kept in sync by
// add/remove. The merge below is reactive on these.
const userEntries = signal<StoredEntry[]>([]);
const builtinOverrides = signal<Map<string, Partial<UserMeta>>>(new Map());
let loadPromise: Promise<void> | null = null;

/** Load the user's entries + built-in overrides from IndexedDB (idempotent). */
export function readyLibrary(): Promise<void> {
	return (loadPromise ??= (async () => {
		const [entries, overrides] = await Promise.all([
			loadEntries(),
			loadOverrides(),
		]);
		userEntries.value = entries;
		builtinOverrides.value = new Map(overrides.map((o) => [o.id, o.user]));
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

/**
 * Ingest an uploaded file: canonicalize it (splitting a combined dump), hash
 * each piece, dedup against existing *user* entries, and store the new ones in
 * IndexedDB. A built-in match is never a reason to skip storing — a later
 * deploy may drop that built-in. Throws if the file isn't a recognized image.
 */
export async function addImage(
	bytes: Uint8Array,
	fileName: string,
): Promise<AddResult> {
	await readyLibrary();
	const pieces = canonicalize(bytes, fileName); // throws on an unrecognized file
	const baseName = fileName.replace(/\.[^./]+$/, "");
	const added: ImageEntry[] = [];
	let deduped = 0;

	for (const piece of pieces) {
		const hash = await sha256Hex(piece.bytes);
		if (userEntries.value.some((e) => e.hash === hash)) {
			deduped++; // already in the user's library
			continue;
		}
		const raw = bytes.subarray(piece.from, piece.to);
		const fw = detectFirmware(raw);
		const slots = primeSlots(fw?.type ?? null, piece.kind);
		const entry: StoredEntry = {
			id: crypto.randomUUID(),
			hash,
			size: piece.bytes.length,
			createdAt: Date.now(),
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
		userEntries.value = [...userEntries.value, entry];
		added.push(userImageEntry(entry));
	}
	return { added, deduped };
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
