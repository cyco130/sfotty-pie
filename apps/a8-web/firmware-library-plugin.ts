import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
	detectFileFormat,
	detectFirmware,
	type AtariFileFormat,
	type FirmwareKey,
	type FirmwareType,
} from "@sfotty-pie/a8";
import type { Plugin } from "vite";

// A build-time scan of the image library that emits `virtual:firmware-library`.
//
// Both library roots are deep-scanned; the on-disk folder shape (firmware/,
// other/, …) is for human organisation only and is ignored — every file is
// classified from its bytes via detectFileFormat (format/size) + detectFirmware
// (identity). A 32K XEGS combined ROM is split, by its documented layout, into
// three slice entries that share the combined's asset URL and carry a
// `#start-end` byte range (decoded later by the loader — nothing is written to
// disk). Entries are de-duplicated by firmware key (falling back to a content
// hash for unrecognised files); when two share a key, a standalone file beats a
// slice, then a local file beats a committed one.
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

// The XEGS internal ROM is [8K built-in game][8K BASIC][16K XL/XE OS]. Ranges
// are hex byte offsets, end-exclusive — the same form the URL fragment uses.
const XEGS_SLICES = [
	{ range: "0000-2000", start: 0x0000, end: 0x2000 },
	{ range: "2000-4000", start: 0x2000, end: 0x4000 },
	{ range: "4000-8000", start: 0x4000, end: 0x8000 },
] as const;

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
	/** De-dup fallback for keyless files; not emitted. */
	contentHash: string;
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

function makeEntry(
	bytes: Uint8Array,
	opts: {
		id: string;
		globKey: string;
		origin: Origin;
		range: string | null;
		/** Name hint for format detection; omit for slices (content-based). */
		formatName: string | undefined;
		fallbackName: string;
	},
): RawEntry {
	const fw = detectFirmware(bytes);
	return {
		id: opts.id,
		name: fw?.name ?? opts.fallbackName,
		globKey: opts.globKey,
		range: opts.range,
		origin: opts.origin,
		size: bytes.length,
		format: detectFileFormat(bytes, opts.formatName),
		firmwareKey: fw?.key ?? null,
		firmwareType: fw?.type ?? null,
		contentHash: createHash("sha1").update(bytes).digest("hex"),
	};
}

function classify(
	bytes: Uint8Array,
	ctx: { id: string; globKey: string; origin: Origin; fileName: string },
	out: RawEntry[],
): void {
	const baseName = stripExtension(ctx.fileName);

	if (detectFileFormat(bytes, ctx.fileName) === "xegs-rom-32k") {
		for (const slice of XEGS_SLICES) {
			out.push(
				makeEntry(bytes.subarray(slice.start, slice.end), {
					id: `${ctx.id}#${slice.range}`,
					globKey: ctx.globKey,
					origin: ctx.origin,
					range: slice.range,
					formatName: undefined,
					fallbackName: `${baseName} (${slice.range})`,
				}),
			);
		}
		return;
	}

	out.push(
		makeEntry(bytes, {
			id: ctx.id,
			globKey: ctx.globKey,
			origin: ctx.origin,
			range: null,
			formatName: ctx.fileName,
			fallbackName: baseName,
		}),
	);
}

/** Lower wins: standalone before slice, then local before committed. */
function priority(e: RawEntry): number {
	return (e.range ? 2 : 0) + (e.origin === "committed" ? 1 : 0);
}

function dedupe(raw: RawEntry[]): RawEntry[] {
	const best = new Map<string, RawEntry>();
	for (const entry of raw) {
		const key = entry.firmwareKey ?? `hash:${entry.contentHash}`;
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
	// Emit every field except the de-dup-only contentHash.
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
