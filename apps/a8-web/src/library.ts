// The built-in image library. Two folders are globbed at build time and merged
// into one immutable set:
//
//   library/        committed, redistributable (Altirra + Atari++ firmware)
//   library.local/  gitignored, per-deploy extras (games, real Atari ROMs)
//
// `.rom` is registered as a binary asset (see vite.config `assetsInclude`), so
// a default import yields the file's hashed-asset URL — nothing is inlined into
// the JS bundle. Items are classified by their top-level subfolder (firmware/
// vs other/). The local folder takes priority: on a path collision its copy
// overrides the committed one.
//
// This is the first slice — filename is the identity (no content hashing) and
// there's no sidecar metadata yet.

export type LibraryCategory = "firmware" | "other";

export interface LibraryEntry {
	/** Path relative to the library root, e.g. "firmware/abas.rom" — the id. */
	id: string;
	fileName: string;
	displayName: string;
	category: LibraryCategory;
	/** Which built-in folder it came from. */
	origin: "committed" | "local";
	/** Hashed asset URL the bytes are fetched from. */
	url: string;
}

// `import.meta.glob` is a compile-time macro: the options must be an inline
// object literal (no shared constant), and the patterns string literals.
const committed = import.meta.glob("../library/**/*", {
	import: "default",
	eager: true,
}) as Record<string, string>;
const local = import.meta.glob("../library.local/**/*", {
	import: "default",
	eager: true,
}) as Record<string, string>;

function stripExtension(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(0, dot) : name;
}

function collect(
	glob: Record<string, string>,
	origin: LibraryEntry["origin"],
	into: Map<string, LibraryEntry>,
): void {
	for (const [path, url] of Object.entries(glob)) {
		// Drop everything up to and including the library root folder, leaving
		// "<category>/<file>".
		const id = path.replace(/^.*\/library(?:\.local)?\//, "");
		const slash = id.indexOf("/");
		if (slash < 0) continue; // loose file directly under the root — ignore
		const category = id.slice(0, slash);
		const fileName = id.slice(slash + 1);
		if (category !== "firmware" && category !== "other") continue;
		if (fileName.startsWith(".") || fileName.includes("/")) continue;
		into.set(id, {
			id,
			fileName,
			displayName: stripExtension(fileName),
			category,
			origin,
			url,
		});
	}
}

const entries = new Map<string, LibraryEntry>();
collect(committed, "committed", entries);
collect(local, "local", entries); // local overrides committed on the same id

/** The merged built-in library, sorted by category then display name. */
export const builtinLibrary: LibraryEntry[] = [...entries.values()].sort(
	(a, b) =>
		a.category.localeCompare(b.category) ||
		a.displayName.localeCompare(b.displayName),
);

/** Fetch an entry's raw bytes. */
export async function loadLibraryEntry(
	entry: LibraryEntry,
): Promise<Uint8Array> {
	const response = await fetch(entry.url);
	if (!response.ok) {
		throw new Error(`Failed to load ${entry.id} (${response.status})`);
	}
	return new Uint8Array(await response.arrayBuffer());
}
