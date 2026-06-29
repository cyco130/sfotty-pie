/// <reference lib="webworker" />

// Library zip export/import, off the main thread (the zip library lives here
// only). Export: read entries + blobs from IndexedDB, decompress to real ROM
// bytes, and pack them under human-friendly filenames alongside a manifest.
// Import: unzip, re-ingest each ROM (recomputing hash/derived/firmware), and
// apply the manifest's authored metadata (name/tags/slots) + built-in overrides.

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { blobs, ingestFile } from "./ingest.ts";
import { CANON_EXT } from "./metadata.ts";
import type { ImageSlot, StoredEntry, UserMeta } from "./metadata.ts";
import { loadEntries, loadOverrides, putOverride } from "./store.ts";

const MANIFEST = "sfotty-pie-a8-library.json";
const FLUSH_MS = 100;

/** A library image's authored metadata in the manifest, linked to its file. */
interface ManifestImage {
	file: string;
	name: string;
	tags?: string[];
	slots?: ImageSlot[];
}
/** A built-in's override (metadata only — the bytes are bundled), by built-in id. */
interface ManifestOverride {
	id: string;
	name?: string;
	tags?: string[];
	slots?: ImageSlot[];
}
interface Manifest {
	version: number;
	images: ManifestImage[];
	builtinOverrides: ManifestOverride[];
}

export type ZipRequest =
	| { type: "export" }
	| { type: "import"; zip: Uint8Array };

export type ZipResponse =
	| { type: "exportProgress"; done: number; total: number }
	| { type: "compressing" }
	| { type: "exported"; bytes: Uint8Array }
	| {
			type: "progress";
			done: number;
			total: number;
			added: number;
			deduped: number;
			failed: number;
			newEntries: StoredEntry[];
	  }
	| { type: "done"; added: number; deduped: number; failed: number }
	| { type: "error"; message: string };

const worker = globalThis as unknown as DedicatedWorkerGlobalScope;

// A filename-safe display name (illegal characters → "_"; never empty).
function sanitize(name: string): string {
	// eslint-disable-next-line no-control-regex
	return name.replace(/[/\\:*?"<>|\x00-\x1f]/g, "_").trim() || "image";
}

// A unique `name.ext`, suffixing " (2)", " (3)" … on collision (case-folded,
// for case-insensitive filesystems).
function uniqueName(base: string, ext: string, used: Set<string>): string {
	let candidate = `${base}.${ext}`;
	let n = 2;
	while (used.has(candidate.toLowerCase()))
		candidate = `${base} (${n++}).${ext}`;
	used.add(candidate.toLowerCase());
	return candidate;
}

async function exportLibrary(): Promise<Uint8Array> {
	const [entries, overrides] = await Promise.all([
		loadEntries(),
		loadOverrides(),
	]);
	const files: Record<string, Uint8Array> = {};
	const images: ManifestImage[] = [];
	const used = new Set<string>();
	const persistent = entries.filter((e) => !e.transient);
	let done = 0;
	let lastFlush = performance.now();
	for (const e of persistent) {
		const bytes = await blobs.get(e.locator.ref); // decompressed canonical ROM
		done++;
		if (performance.now() - lastFlush >= FLUSH_MS) {
			worker.postMessage({
				type: "exportProgress",
				done,
				total: persistent.length,
			} satisfies ZipResponse);
			lastFlush = performance.now();
		}
		if (!bytes) continue;
		const file = uniqueName(
			sanitize(e.user.displayName),
			CANON_EXT[e.derived.type],
			used,
		);
		files[file] = bytes;
		images.push({
			file,
			name: e.user.displayName,
			...(e.user.tags?.length && { tags: e.user.tags }),
			...(e.user.slots?.length && { slots: e.user.slots }),
		});
	}
	const builtinOverrides: ManifestOverride[] = overrides.map((o) => ({
		id: o.id,
		...(o.user.displayName && { name: o.user.displayName }),
		...(o.user.tags?.length && { tags: o.user.tags }),
		...(o.user.slots?.length && { slots: o.user.slots }),
	}));
	const manifest: Manifest = { version: 1, images, builtinOverrides };
	files[MANIFEST] = strToU8(JSON.stringify(manifest, null, 2));
	worker.postMessage({ type: "compressing" } satisfies ZipResponse);
	return zipSync(files, { level: 6 });
}

function parseManifest(bytes: Uint8Array | undefined): Manifest | null {
	if (!bytes) return null;
	try {
		const m = JSON.parse(strFromU8(bytes)) as Manifest;
		return Array.isArray(m.images) ? m : null;
	} catch {
		return null;
	}
}

async function importLibrary(zip: Uint8Array): Promise<void> {
	const unzipped = unzipSync(zip);
	const manifest = parseManifest(unzipped[MANIFEST]);
	const metaByFile = new Map<string, ManifestImage>();
	for (const img of manifest?.images ?? []) metaByFile.set(img.file, img);

	const seen = new Set((await loadEntries()).map((e) => e.hash));
	const fileNames = Object.keys(unzipped).filter((f) => f !== MANIFEST);
	const total = fileNames.length;

	let added = 0;
	let deduped = 0;
	let failed = 0;
	let done = 0;
	let batch: StoredEntry[] = [];
	let lastFlush = performance.now();
	const flush = (force: boolean): void => {
		if (!force && performance.now() - lastFlush < FLUSH_MS) return;
		worker.postMessage({
			type: "progress",
			done,
			total,
			added,
			deduped,
			failed,
			newEntries: batch,
		} satisfies ZipResponse);
		batch = [];
		lastFlush = performance.now();
	};

	for (const file of fileNames) {
		const bytes = unzipped[file];
		const m = metaByFile.get(file);
		const meta: Partial<UserMeta> = m
			? {
					displayName: m.name,
					...(m.tags && { tags: m.tags }),
					...(m.slots && { slots: m.slots }),
				}
			: {};
		const into: StoredEntry[] = [];
		try {
			const result = await ingestFile(bytes!, file, seen, into, false, meta);
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

	// Apply built-in overrides, merging onto any the importing machine already has.
	if (manifest) {
		const existing = new Map(
			(await loadOverrides()).map((o) => [o.id, o.user]),
		);
		for (const o of manifest.builtinOverrides ?? []) {
			const user: Partial<UserMeta> = { ...existing.get(o.id) };
			if (o.name) user.displayName = o.name;
			if (o.tags) user.tags = o.tags;
			if (o.slots) user.slots = o.slots;
			await putOverride({ id: o.id, user });
		}
	}

	worker.postMessage({
		type: "done",
		added,
		deduped,
		failed,
	} satisfies ZipResponse);
}

worker.onmessage = async (event: MessageEvent<ZipRequest>) => {
	try {
		if (event.data.type === "export") {
			const bytes = await exportLibrary();
			worker.postMessage({ type: "exported", bytes } satisfies ZipResponse, [
				bytes.buffer,
			]);
		} else {
			await importLibrary(event.data.zip);
		}
	} catch (error) {
		worker.postMessage({
			type: "error",
			message: error instanceof Error ? error.message : String(error),
		} satisfies ZipResponse);
	}
};
