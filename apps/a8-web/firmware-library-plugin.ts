import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
	canonicalize,
	detectFileFormat,
	detectFirmware,
	type AtariFileFormat,
	type FirmwareKey,
	type FirmwareType,
	type ImageKind,
} from "@sfotty-pie/a8";
import type { Plugin } from "vite";

// A build-time scan of the image library that emits `virtual:firmware-library`.
//
// Both library roots are deep-scanned; the on-disk folder shape (firmware/,
// other/, …) is for human organisation only and is ignored — every file is run
// through canonicalize (which derives each image's canonical `.car`/raw form
// and its content kind) plus detectFirmware (identity). A 32K XEGS combined ROM
// is split by canonicalize into its three constituents, emitted as slice
// entries that share the combined's asset URL and carry a `#start-end` byte
// range (decoded later by the loader — nothing is written to disk; built-ins
// still serve the raw slice). Each entry also carries the precomputed canonical
// SHA-256 (the content id user uploads dedup against) and its ImageKind.
// Entries are de-duplicated by firmware key (falling back to the canonical
// hash); when two share a key, a standalone file beats a slice, then a local
// file beats a committed one.
//
// URLs are not baked in: the generated module resolves them through
// `import.meta.glob` so Vite still does the asset hashing/dev-serving.

const VIRTUAL_ID = "virtual:firmware-library";
const RESOLVED_ID = "\0virtual:firmware-library";

const SOURCES = [
	{ sub: "library", origin: "committed" },
	{ sub: "library.local", origin: "local" },
] as const;

type Origin = (typeof SOURCES)[number]["origin"];

interface RawEntry {
	id: string;
	name: string;
	/** The `import.meta.glob` key its asset URL is looked up under. */
	globKey: string;
	/** Hex `start-end` byte range for a slice, else null. */
	range: string | null;
	origin: Origin;
	size: number;
	format: AtariFileFormat | null;
	firmwareKey: FirmwareKey | null;
	firmwareType: FirmwareType | null;
	/** SHA-256 of the canonical image (hex) — content id, and the de-dup fallback. */
	hash: string;
	/** Content-derived facts, or null for an unrecognized file. */
	kind: ImageKind | null;
}

function walk(dir: string): string[] {
	let items: string[];
	try {
		items = readdirSync(dir);
	} catch {
		return []; // a missing root (e.g. no library.local) contributes nothing
	}
	const files: string[] = [];
	for (const item of items) {
		if (item.startsWith(".")) continue;
		const full = join(dir, item);
		if (statSync(full).isDirectory()) files.push(...walk(full));
		else files.push(full);
	}
	return files;
}

function stripExtension(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(0, dot) : name;
}

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function hexRange(from: number, to: number): string {
	return `${from.toString(16)}-${to.toString(16)}`;
}

// `raw` is the bytes the asset URL serves (a slice of the file); `canonical` is
// the canonicalized image those bytes stand for, hashed as the content id.
function makeEntry(
	raw: Uint8Array,
	canonical: Uint8Array,
	opts: {
		id: string;
		globKey: string;
		origin: Origin;
		range: string | null;
		/** Name hint for format detection; omit for slices (content-based). */
		formatName: string | undefined;
		fallbackName: string;
		kind: ImageKind | null;
	},
): RawEntry {
	const fw = detectFirmware(raw);
	return {
		id: opts.id,
		name: fw?.name ?? opts.fallbackName,
		globKey: opts.globKey,
		range: opts.range,
		origin: opts.origin,
		size: raw.length,
		format: detectFileFormat(raw, opts.formatName),
		firmwareKey: fw?.key ?? null,
		firmwareType: fw?.type ?? null,
		hash: sha256(canonical),
		kind: opts.kind,
	};
}

function classify(
	bytes: Uint8Array,
	ctx: { id: string; globKey: string; origin: Origin; fileName: string },
	out: RawEntry[],
): void {
	const baseName = stripExtension(ctx.fileName);

	let pieces;
	try {
		pieces = canonicalize(bytes, ctx.fileName);
	} catch {
		// Unrecognized: emit the whole file raw, no canonical kind. Its hash is
		// over the raw bytes — there's no canonical form to prefer.
		out.push(
			makeEntry(bytes, bytes, {
				id: ctx.id,
				globKey: ctx.globKey,
				origin: ctx.origin,
				range: null,
				formatName: ctx.fileName,
				fallbackName: baseName,
				kind: null,
			}),
		);
		return;
	}

	for (const piece of pieces) {
		const raw = bytes.subarray(piece.from, piece.to);
		const whole =
			pieces.length === 1 && piece.from === 0 && piece.to === bytes.length;
		const range = whole ? null : hexRange(piece.from, piece.to);
		out.push(
			makeEntry(raw, piece.bytes, {
				id: whole ? ctx.id : `${ctx.id}#${range}`,
				globKey: ctx.globKey,
				origin: ctx.origin,
				range,
				// Whole file: let the filename guide format detection. Slice:
				// content-based (no name).
				formatName: whole ? ctx.fileName : undefined,
				fallbackName: whole ? baseName : `${baseName} (${range})`,
				kind: piece.kind,
			}),
		);
	}
}

/** Lower wins: standalone before slice, then local before committed. */
function priority(e: RawEntry): number {
	return (e.range ? 2 : 0) + (e.origin === "committed" ? 1 : 0);
}

function dedupe(raw: RawEntry[]): RawEntry[] {
	const best = new Map<string, RawEntry>();
	for (const entry of raw) {
		const key = entry.firmwareKey ?? `hash:${entry.hash}`;
		const current = best.get(key);
		if (!current || priority(entry) < priority(current)) best.set(key, entry);
	}
	return [...best.values()];
}

/** Scan both library roots under `root` and return the classified, deduped set. */
export function scanLibrary(root: string): RawEntry[] {
	const raw: RawEntry[] = [];
	for (const { sub, origin } of SOURCES) {
		const base = join(root, sub);
		for (const file of walk(base)) {
			const rel = relative(base, file).split(sep).join("/");
			classify(
				new Uint8Array(readFileSync(file)),
				{
					id: `${sub}/${rel}`,
					globKey: `/${sub}/${rel}`,
					origin,
					fileName: rel.slice(rel.lastIndexOf("/") + 1),
				},
				raw,
			);
		}
	}
	return dedupe(raw);
}

function generate(entries: RawEntry[]): string {
	const data = entries.map((e) => ({
		id: e.id,
		name: e.name,
		globKey: e.globKey,
		range: e.range,
		origin: e.origin,
		size: e.size,
		format: e.format,
		firmwareKey: e.firmwareKey,
		firmwareType: e.firmwareType,
		hash: e.hash,
		kind: e.kind,
	}));
	return `// Generated by firmware-library-plugin — do not edit.
const committed = import.meta.glob("/library/**/*", { import: "default", eager: true });
const local = import.meta.glob("/library.local/**/*", { import: "default", eager: true });
const urls = { ...committed, ...local };
const entries = ${JSON.stringify(data, null, 2)};
export const builtinFirmware = entries.map(({ globKey, range, ...rest }) => ({
	...rest,
	url: range ? urls[globKey] + "#" + range : urls[globKey],
}));
`;
}

export function firmwareLibrary(): Plugin {
	let root = ".";
	return {
		name: "firmware-library",
		configResolved(config) {
			root = config.root;
		},
		resolveId(id) {
			return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
		},
		load(id) {
			return id === RESOLVED_ID ? generate(scanLibrary(root)) : undefined;
		},
		configureServer(server) {
			const dirs = SOURCES.map((s) => join(root, s.sub));
			for (const dir of dirs) server.watcher.add(dir);
			const refresh = (file: string): void => {
				if (!dirs.some((dir) => file.startsWith(dir))) return;
				const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
				if (mod) server.moduleGraph.invalidateModule(mod);
				server.ws.send({ type: "full-reload" });
			};
			server.watcher.on("add", refresh);
			server.watcher.on("unlink", refresh);
		},
	};
}
