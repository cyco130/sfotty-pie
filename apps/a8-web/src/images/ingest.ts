// The signal-free ingest core: turn file bytes into stored library entries
// (canonicalize → hash → blob + metadata write). Kept apart from the reactive
// library facade so it can run unchanged inside the import worker — it touches
// only IndexedDB, crypto, and CompressionStream, all available off the main
// thread. Each JS context (main thread, worker) opens its own blob handle to the
// same database.

import {
	canonicalize,
	detectFirmware,
	type FirmwareType,
	type ImageKind,
} from "@sfotty-pie/a8";
import { idbBlobStore } from "./blob-store.ts";
import { sha256Hex } from "./hash.ts";
import type { ImageSlot, StoredEntry } from "./metadata.ts";
import { putEntry } from "./store.ts";

export const blobs = idbBlobStore();

/** Prime the slot pickers from a firmware type — standard-8K carts only. */
export function primeSlots(
	type: FirmwareType | null,
	kind: ImageKind,
): ImageSlot[] | undefined {
	if (kind.type !== "cart") return undefined;
	if (type === "basic") return ["basic"];
	if (type === "game") return ["game"];
	return undefined;
}

// Ingest one file's canonical pieces into `into`, deduping against `seen` (a set
// of hashes it updates — including earlier pieces in the same batch). Does the
// blob + metadata writes. Throws if the file isn't a recognized image. A
// built-in match is never a reason to skip storing (a later deploy may drop the
// built-in), so `seen` holds only user hashes.
export async function ingestFile(
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
