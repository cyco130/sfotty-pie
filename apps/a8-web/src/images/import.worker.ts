/// <reference lib="webworker" />

// The bulk-import worker: ingests an entire file list off the main thread —
// reading bytes, canonicalizing, hashing, compressing, and writing blobs +
// entries straight to IndexedDB (the worker is the sole writer for the import's
// duration). It posts progress back in batches so the library can fill in live
// without flooding the main thread with a message per file.

import { ingestFile } from "./ingest.ts";
import type { StoredEntry } from "./metadata.ts";
import { loadEntries } from "./store.ts";

export interface ImportRequest {
	files: File[];
	/** Tags stamped onto every imported entry (already normalized). */
	tags: string[];
}

export type ImportResponse =
	| {
			type: "progress";
			done: number;
			total: number;
			added: number;
			deduped: number;
			failed: number;
			/** Entries written since the previous message (for the live merge). */
			newEntries: StoredEntry[];
	  }
	| { type: "done"; added: number; deduped: number; failed: number };

// Coalesce progress posts to ~10/s so a huge import doesn't drown the main
// thread; newEntries accumulate between flushes.
const FLUSH_MS = 100;

const worker = globalThis as unknown as DedicatedWorkerGlobalScope;

worker.onmessage = async (event: MessageEvent<ImportRequest>) => {
	const { files, tags } = event.data;
	const total = files.length;

	// Dedup against what's already stored; the worker owns writes for the import.
	const seen = new Set((await loadEntries()).map((e) => e.hash));

	let added = 0;
	let deduped = 0;
	let failed = 0;
	let done = 0;
	let batch: StoredEntry[] = [];
	let lastFlush = performance.now();

	const flush = (force: boolean): void => {
		if (!force && performance.now() - lastFlush < FLUSH_MS) return;
		const message: ImportResponse = {
			type: "progress",
			done,
			total,
			added,
			deduped,
			failed,
			newEntries: batch,
		};
		worker.postMessage(message);
		batch = [];
		lastFlush = performance.now();
	};

	for (const file of files) {
		const into: StoredEntry[] = [];
		try {
			const bytes = new Uint8Array(await file.arrayBuffer());
			const result = await ingestFile(bytes, file.name, seen, into, false, {
				tags,
			});
			added += result.added;
			deduped += result.deduped;
		} catch {
			failed++; // unrecognized — canonicalize threw
		}
		if (into.length > 0) batch.push(...into);
		done++;
		flush(false);
	}
	flush(true);

	const done_: ImportResponse = { type: "done", added, deduped, failed };
	worker.postMessage(done_);
};
