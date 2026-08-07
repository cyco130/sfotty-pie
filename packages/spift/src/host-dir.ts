// The host side as a FileStore, so copying can have host files at either end
// and the copy operation never has to know which side is which.
//
// Two modes, because the two ways a host side gets named mean different
// things. A directory named outright (--to out/) is a container: paths are
// relative to it and confined to it, so a rename template can never write
// outside the directory the user pointed at. The host side a
// command falls back to when no flag names one is not a container at all - it
// is simply the host, where paths mean what they mean in the shell, relative
// to the working directory and absolute when they say so.
//
// Mutations do not touch the disk either way. They accumulate in an overlay
// that the store's own reads see through, and commit() applies the lot - the
// same shape as an image, whose mutations sit in memory until the command
// writes the file back. A batch that throws part way leaves the disk
// untouched. commit() itself is not transactional: if it fails part way, what
// it already wrote stays, exactly as a half-written image file would.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import {
	dirname,
	isAbsolute,
	join as joinPath,
	relative as relativePath,
	resolve as resolvePath,
} from "node:path";
import { toHostName } from "./host-names.ts";
import type {
	DirEntry,
	DirEntryAttribute,
	DirEntryAttributes,
	FileContents,
	FileStore,
} from "./filesystem.ts";

export interface HostDirectory extends FileStore {
	readonly family: "host";
	/** Where relative paths start from. */
	readonly root: string;
	/** Applies everything the store has been asked to do. */
	commit(): Promise<void>;
	/** True when anything is waiting to be written. */
	pending(): boolean;
}

type PendingEntry =
	| { kind: "file"; bytes: Uint8Array; readOnly: boolean }
	| { kind: "dir" }
	| { kind: "removed" };

/**
 * Opens the host as a store. `root` is where relative paths start; with
 * `confine` (the default) that is also a boundary no path may cross, which is
 * what a directory the user named outright should mean. Without it the store
 * is the host filesystem seen from `root`: absolute paths address what they
 * say, and ".." walks out as it would in any shell.
 */
export function openHostDirectory(
	root: string,
	options?: { confine?: boolean },
): HostDirectory {
	const base = resolvePath(root);
	const confine = options?.confine !== false;
	const stat = statSync(base, { throwIfNoEntry: false });
	if (stat === undefined) {
		throw new Error(`${root}: no such directory`);
	}
	if (!stat.isDirectory()) {
		throw new Error(`${root}: not a directory`);
	}

	// Keyed by absolute host path, in the order asked for: commit replays it,
	// so a directory made before a file written into it stays that way.
	const overlay = new Map<string, PendingEntry>();

	/** The absolute host path a store path names, honouring the mode. */
	function absolute(path: string): string {
		if (!confine) {
			return resolvePath(base, path);
		}
		if (isAbsolute(path)) {
			throw new Error(
				`${path} is an absolute path, but ${base} was named as the ` +
					`container - give a path inside it`,
			);
		}
		const parts: string[] = [];
		for (const part of path.split("/")) {
			if (part === "" || part === ".") {
				continue;
			}
			if (part === "..") {
				if (parts.pop() === undefined) {
					throw new Error(`${path} leaves the directory`);
				}
				continue;
			}
			parts.push(part);
		}
		return joinPath(base, ...parts);
	}

	/** How a path is spelled back to the user and in DirEntry.path. */
	function display(path: string): string {
		const inside = relativePath(base, path);
		return inside === "" || inside.startsWith("..") ? path : inside;
	}

	/** What the store shows for a path, overlay first, then the disk. */
	function peek(
		path: string,
	): { kind: "file" | "dir"; readOnly: boolean } | null {
		const staged = overlay.get(path);
		if (staged?.kind === "removed") {
			return null;
		}
		if (staged?.kind === "dir") {
			return { kind: "dir", readOnly: false };
		}
		if (staged?.kind === "file") {
			return { kind: "file", readOnly: staged.readOnly };
		}
		const found = statSync(path, { throwIfNoEntry: false });
		if (found === undefined) {
			return null;
		}
		return {
			kind: found.isDirectory() ? "dir" : "file",
			// The owner-write bit is the closest thing the host has to the
			// DOSes' locked flag.
			readOnly: (found.mode & 0o200) === 0,
		};
	}

	function attributesOf(readOnly: boolean): DirEntryAttribute[] {
		return readOnly ? ["ReadOnly"] : [];
	}

	/** Names in a directory: what is on disk, plus and minus the overlay. */
	function namesIn(directory: string): string[] {
		const names = new Set<string>();
		for (const found of readdirSync(directory, { withFileTypes: true })) {
			// Anything that is not a regular file or a directory - a socket, a
			// device - is not ours to copy.
			if (found.isFile() || found.isDirectory()) {
				names.add(found.name);
			}
		}
		for (const [path, staged] of overlay) {
			if (dirname(path) !== directory) {
				continue;
			}
			const leaf = path.slice(directory.length + 1);
			if (staged.kind === "removed") {
				names.delete(leaf);
			} else {
				names.add(leaf);
			}
		}
		return [...names].sort();
	}

	function* walk(
		directory: string,
		matches: ((name: string) => boolean) | undefined,
		recursive: boolean,
	): IterableIterator<DirEntry> {
		for (const name of namesIn(directory)) {
			// Dot-prefixed names are never listed, the way a shell glob passes
			// over them: they are the host's own business (.DS_Store, .git,
			// and spift's own .boot.bin), and none of them can be a native
			// name on any family we write to anyway. Reading one by name
			// still works, which is how pack picks up .boot.bin.
			if (name.startsWith(".")) {
				continue;
			}
			const path = joinPath(directory, name);
			const found = peek(path);
			if (found === null) {
				continue;
			}
			if (matches === undefined || matches(name)) {
				yield {
					name,
					path: display(path),
					kind: found.kind,
					attributes: attributesOf(found.readOnly),
				};
			}
			if (recursive && found.kind === "dir") {
				yield* walk(path, matches, recursive);
			}
		}
	}

	return {
		family: "host",
		root: base,
		pathSeparators: "/",
		// Locked is the one attribute the host can carry, as the owner-write
		// bit. Everything else in the vocabulary is either Atari-specific or
		// derived from a structure the host has no analogue for, so a copy to
		// here drops it.
		writableAttributes: ["ReadOnly"],
		applyNameTemplate: applyHostNameTemplate,
		safeName: toHostName,
		splitPath(path: string): string[] {
			const parts = path.split("/").filter((part) => part !== ".");
			// An absolute path keeps its leading empty component, so joining
			// the parts back with "/" spells the same absolute path.
			return parts.filter((part, index) => part !== "" || index === 0);
		},
		*entries(
			spec?: string,
			options?: { recursive?: boolean; listContents?: boolean },
		): IterableIterator<DirEntry> {
			const parts = spec === undefined ? [] : this.splitPath(spec);
			let pattern = parts.length === 0 ? undefined : (parts.pop() as string);
			// As on an image: a spec naming a directory lists that directory,
			// unless the caller means the entry itself.
			if (
				options?.listContents !== false &&
				pattern !== undefined &&
				!/[*?]/.test(pattern)
			) {
				if (peek(absolute([...parts, pattern].join("/")))?.kind === "dir") {
					parts.push(pattern);
					pattern = undefined;
				}
			}
			const directory = absolute(parts.join("/"));
			if (peek(directory)?.kind !== "dir") {
				throw new Error(`${display(directory)} is not a directory`);
			}
			const matches =
				pattern === undefined ? undefined : compileHostPattern(pattern);
			yield* walk(directory, matches, options?.recursive === true);
		},
		readFile(path: string): FileContents | null {
			const where = absolute(path);
			const staged = overlay.get(where);
			if (staged?.kind === "file") {
				return { bytes: staged.bytes, diagnostics: [] };
			}
			if (staged !== undefined) {
				return null;
			}
			if (peek(where)?.kind !== "file") {
				return null;
			}
			return { bytes: readFileSync(where), diagnostics: [] };
		},
		writeFile(
			path: string,
			bytes: Uint8Array,
			options?: { overwrite?: boolean; attributes?: DirEntryAttributes },
		): string[] {
			const where = absolute(path);
			const existing = peek(where);
			if (existing !== null && options?.overwrite !== true) {
				throw new Error(`${path} already exists`);
			}
			if (existing?.kind === "dir") {
				throw new Error(`${path} is a directory`);
			}
			overlay.set(where, {
				kind: "file",
				bytes,
				readOnly: options?.attributes?.includes("ReadOnly") === true,
			});
			return [];
		},
		removeFile(path: string, options?: { force?: boolean }): string[] {
			const where = absolute(path);
			const found = peek(where);
			if (found === null) {
				throw new Error(`${path} does not exist`);
			}
			if (found.kind === "dir") {
				throw new Error(`${path} is a directory`);
			}
			if (found.readOnly && options?.force !== true) {
				throw new Error(`${path} is read-only`);
			}
			overlay.set(where, { kind: "removed" });
			return [];
		},
		moveFile(
			from: string,
			to: string,
			options?: { force?: boolean },
		): string[] {
			const contents = this.readFile(from);
			if (contents === null) {
				throw new Error(`${from} does not exist`);
			}
			const source = peek(absolute(from));
			this.writeFile(to, contents.bytes, {
				overwrite: options?.force,
				attributes: attributesOf(source?.readOnly === true),
			});
			overlay.set(absolute(from), { kind: "removed" });
			return [];
		},
		makeDirectory(path: string, options?: { parents?: boolean }): void {
			const where = absolute(path);
			if (where === base) {
				throw new Error("no directory name given");
			}
			const existing = peek(where);
			if (existing?.kind === "dir") {
				if (options?.parents === true) {
					return;
				}
				throw new Error(`${path} already exists`);
			}
			if (existing !== null) {
				throw new Error(`${path} is a file, not a directory`);
			}
			// Walk down from the deepest existing parent, so -p reports the
			// same missing-component error a DOS would.
			const missing: string[] = [];
			for (
				let walked = dirname(where);
				walked !== dirname(walked);
				walked = dirname(walked)
			) {
				const found = peek(walked);
				if (found?.kind === "dir") {
					break;
				}
				if (found !== null) {
					throw new Error(`${display(walked)} is a file, not a directory`);
				}
				if (options?.parents !== true) {
					throw new Error(`${display(walked)} does not exist`);
				}
				missing.unshift(walked);
			}
			for (const parent of missing) {
				overlay.set(parent, { kind: "dir" });
			}
			overlay.set(where, { kind: "dir" });
		},
		removeDirectory(path: string): void {
			const where = absolute(path);
			const found = peek(where);
			if (found === null) {
				throw new Error(`${path} does not exist`);
			}
			if (found.kind !== "dir") {
				throw new Error(`${path} is a file, not a directory`);
			}
			if (namesIn(where).some((name) => peek(joinPath(where, name)))) {
				throw new Error(`${path} is not empty`);
			}
			overlay.set(where, { kind: "removed" });
		},
		pending(): boolean {
			return overlay.size > 0;
		},
		async commit(): Promise<void> {
			// Directories first so files have somewhere to land, then writes,
			// then removals - a move within the store stages a write and a
			// remove, and doing them in this order never loses the payload.
			for (const [path, staged] of overlay) {
				if (staged.kind === "dir") {
					await mkdir(path, { recursive: true });
				}
			}
			for (const [path, staged] of overlay) {
				if (staged.kind === "file") {
					// A host directory is made on demand, as every extraction
					// tool does - unlike an image, where a directory is an
					// eight-sector allocation the user has to ask for.
					await mkdir(dirname(path), { recursive: true });
					await writeFile(path, staged.bytes);
					if (staged.readOnly) {
						await chmod(path, 0o444);
					}
				}
			}
			for (const [path, staged] of overlay) {
				if (staged.kind === "removed") {
					await rm(path, { recursive: true, force: true });
				}
			}
			overlay.clear();
		},
	};
}

/**
 * Host rename templates, the same positional rule the Atari DOSes use for
 * RENAME, over stem and extension rather than the 8.3 fields: "*" copies the
 * source from that position to the end of that part, "?" copies one
 * character, anything else replaces, and a template that ends drops the rest.
 * So "*.ttt" -> "*.txt" re-extensions a batch here too.
 *
 * Two differences follow from host names not being fixed-width fields. The
 * split is at the LAST dot, so "archive.tar.gz" has the extension "gz" and a
 * leading-dot name like ".gitignore" is all stem. And there is no padding to
 * copy from, so a "?" reaching past the end of the source contributes
 * nothing, where on a padded 8.3 field it would have copied a space.
 */
export function applyHostNameTemplate(name: string, template: string): string {
	const split = (text: string): [string, string] => {
		const dot = text.lastIndexOf(".");
		return dot <= 0 ? [text, ""] : [text.slice(0, dot), text.slice(dot + 1)];
	};
	const [sourceStem, sourceExt] = split(name);
	const [templateStem, templateExt] = split(template);
	const field = (source: string, pattern: string): string => {
		let out = "";
		for (let i = 0; i < pattern.length; i++) {
			const char = pattern[i];
			if (char === "*") {
				return out + source.slice(i);
			}
			out += char === "?" ? (source[i] ?? "") : char;
		}
		return out;
	};
	const stem = field(sourceStem, templateStem);
	const ext = field(sourceExt, templateExt);
	return ext === "" ? stem : `${stem}.${ext}`;
}

/**
 * Host wildcard semantics for matching: "*" and "?" over the whole name,
 * case-insensitively, with no stem/extension split - a host name may hold any
 * number of dots, and "*.tar.gz" should mean what it looks like.
 */
export function compileHostPattern(pattern: string): (name: string) => boolean {
	let source = "^";
	for (const char of pattern) {
		source +=
			char === "*"
				? "[^/]*"
				: char === "?"
					? "[^/]"
					: char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}
	const compiled = new RegExp(`${source}$`, "i");
	return (name) => compiled.test(name);
}
