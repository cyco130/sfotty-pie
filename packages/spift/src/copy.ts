// The one copy operation behind cp and mv, in either direction and across
// containers. Nothing here knows whether a side is an image or a host
// directory - both are FileStores, and both hold their mutations until the
// caller commits.

import type {
	DirEntry,
	DirEntryAttribute,
	DirEntryAttributes,
	FileStore,
} from "./filesystem.ts";
import { recodeText, type EolStyle } from "./text.ts";

export interface CopyRequest {
	sources: readonly string[];
	destination: string;
	/** Descend into directories. Required by cp, implied by mv. */
	recursive: boolean;
	/** Overwrite what is already there, and remove read-only sources. */
	force: boolean;
	/** Drop every attribute instead of carrying across what both sides share. */
	noAttributes: boolean;
	/**
	 * Attributes to ask for on every file written, whatever the source
	 * carried - how "--to-fs atari/dos10" says "write these as DOS 1.0
	 * files". An explicit request, so it outlives --no-attributes.
	 */
	attributes?: DirEntryAttributes;
	/** Remove each source once its copy has landed. */
	move: boolean;
	/**
	 * Recode file contents between the two ends' character sets - FTP's
	 * ascii transfer mode. Recoding a binary mangles it, so something has to
	 * say which files are text: for cp that is the source spec, and a
	 * command that copies everything supplies `textMatch` instead.
	 */
	text?: boolean;
	/** Which of the matched files are text. All of them when absent. */
	textMatch?: (entry: DirEntry) => boolean;
	/** With text: refuse what will not survive rather than substituting "?". */
	strict?: boolean;
	/** With text: what EOL becomes on the way out of a family encoding. */
	eol?: EolStyle;
	/**
	 * Carry each entry's timestamp to the target instead of letting it
	 * stamp "now". What cp -p and mv mean on Unix, and what an archiver
	 * does by default - so cp leaves it off, mv and pack/unpack turn it on.
	 */
	preserveTimestamps?: boolean;
}

export interface CopiedFile {
	from: string;
	to: string;
	diagnostics: string[];
}

export interface CopyResult {
	files: CopiedFile[];
	directories: string[];
}

/**
 * A destination is a directory when it says so with a trailing separator, is
 * empty (the root), or already names one; anything else is a name template
 * applied per source, following the target family's own rename rule.
 */
export function destinationIsDirectory(
	target: FileStore,
	destination: string,
): boolean {
	const separators = new Set([...target.pathSeparators, "/"]);
	const last = destination.slice(-1);
	if (last !== "" && separators.has(last)) {
		return true;
	}
	if (target.splitPath(destination).length === 0) {
		return true;
	}
	try {
		const named = [...target.entries(destination, { listContents: false })];
		return named[0]?.kind === "dir";
	} catch {
		return false; // a path that does not resolve is a template
	}
}

/**
 * Attributes that never travel with a copy even though a target could write
 * them. Archived is backup state relative to one particular disk: a copy is
 * a new file no archiver has seen, so it arrives unarchived - measured on
 * SDX 4.50, whose own COPY drops the bit (and whose writes clear it on
 * modification).
 */
const NON_PORTABLE: readonly DirEntryAttribute[] = ["Archived"];

/**
 * What of an entry's attributes survives the trip: the ones the target can
 * actually set, minus the ones that are not properties of the file at all
 * (see NON_PORTABLE). Allocation-specific markings and the boot-file
 * derivation are not in any store's writable set, so they drop out here
 * rather than being special-cased. --no-attributes drops the rest too.
 */
export function portableAttributes(
	target: FileStore,
	attributes: DirEntryAttributes,
	drop: boolean,
): DirEntryAttribute[] {
	if (drop) {
		return [];
	}
	return attributes.filter(
		(attribute) =>
			target.writableAttributes.includes(attribute) &&
			!NON_PORTABLE.includes(attribute),
	);
}

/**
 * Copies (or moves) entries from one store to another. Every conflict is
 * found before anything is written, so a refusal leaves both sides untouched;
 * the caller commits once this returns.
 */
export function copyEntries(
	source: FileStore,
	target: FileStore,
	request: CopyRequest,
): CopyResult {
	const intoDirectory = destinationIsDirectory(target, request.destination);
	const destinationParts = target.splitPath(request.destination);
	const template = intoDirectory ? undefined : destinationParts.pop();
	const destinationPath = destinationParts.join("/");

	// A destination that is just a name renames, whatever the family; only
	// one with wildcards in it needs the family to have a template rule.
	const templated = template !== undefined && /[*?]/.test(template);
	if (templated && target.applyNameTemplate === undefined) {
		throw new Error(
			`"${request.destination}" is a name template, and ${target.family} ` +
				`has no template rule - give a plain name or a directory`,
		);
	}

	// Match each source spec. A source names things to act on, so a spec
	// naming a directory means that directory, not its contents.
	const matched: DirEntry[] = [];
	for (const spec of request.sources) {
		const found = [...source.entries(spec, { listContents: false })];
		if (found.length === 0) {
			throw new Error(`no files match "${spec}"`);
		}
		for (const entry of found) {
			if (!matched.some((seen) => seen.path === entry.path)) {
				matched.push(entry);
			}
		}
	}

	if (template !== undefined && matched.length > 1 && !/[*?]/.test(template)) {
		throw new Error(
			`"${request.destination}" names one file but ${matched.length} ` +
				`match - use a template like '*.txt' or a directory`,
		);
	}

	// Expand directories into the files below them, keeping the tree shape
	// relative to whatever the spec picked out.
	interface Planned {
		from: DirEntry;
		to: string;
	}
	const plannedDirectories: { path: string; timestamp?: Date }[] = [];
	const planned: Planned[] = [];
	const nameFor = (entry: DirEntry): string => {
		const rule = target.applyNameTemplate;
		const named =
			template === undefined
				? entry.name
				: rule === undefined
					? template
					: rule(entry.name, template);
		// Only ever a guard against a name that would be dangerous where it
		// is going - a damaged directory decodes to whatever bytes are in it,
		// and a "/" in there would write outside the destination entirely.
		return target.safeName?.(named) ?? named;
	};
	const under = (...parts: string[]): string =>
		parts.filter((part) => part !== "").join("/");
	// Every component, not just the leaf: a damaged directory decodes to
	// whatever bytes are in it, and a "/" in the name of a directory two
	// levels down would escape the destination just as surely as one in a
	// file name.
	const safeUnder = (root: string, relative: string): string =>
		under(
			root,
			relative
				.split("/")
				.map((part) => target.safeName?.(part) ?? part)
				.join("/"),
		);

	for (const entry of matched) {
		if (entry.kind === "dir") {
			if (!request.recursive) {
				throw new Error(`${entry.path} is a directory (use --recursive)`);
			}
			const root = under(destinationPath, nameFor(entry));
			plannedDirectories.push({ path: root, timestamp: entry.timestamp });
			// The path alone, with no pattern after it, is what lists a whole
			// subtree: a family pattern filters by its own rules, and the
			// Atari ones would drop every name whose extension it did not
			// spell out.
			for (const below of source.entries(entry.path, { recursive: true })) {
				// entries() reports paths from the store root; re-root them
				// under the destination.
				const relative = below.path.slice(entry.path.length + 1);
				if (below.kind === "dir") {
					plannedDirectories.push({
						path: safeUnder(root, relative),
						timestamp: below.timestamp,
					});
				} else {
					planned.push({ from: below, to: safeUnder(root, relative) });
				}
			}
			continue;
		}
		planned.push({ from: entry, to: under(destinationPath, nameFor(entry)) });
	}

	// Everything is checked before anything is written: two sources landing on
	// one name, or an existing file without --force, stops the whole batch.
	const taken = new Set<string>();
	for (const { from, to } of planned) {
		if (taken.has(to)) {
			throw new Error(`two sources would both become ${to}`);
		}
		taken.add(to);
		if (!request.force && targetHas(target, to)) {
			throw new Error(`${to} already exists on the target (use --force)`);
		}
		if (source === target && from.path === to) {
			throw new Error(`${from.path} and ${to} are the same file`);
		}
	}

	for (const { path, timestamp } of plannedDirectories) {
		target.makeDirectory(path, {
			parents: true,
			...(request.preserveTimestamps === true && timestamp !== undefined
				? { timestamp }
				: {}),
		});
	}

	const files: CopiedFile[] = [];
	for (const { from, to } of planned) {
		const contents = source.readFile(from.path);
		if (contents === null) {
			throw new Error(`${from.path} could not be read`);
		}
		// Between reading and writing, since it is the one thing that depends
		// on both ends. Same encoding at both is a no-op, so image-to-image
		// passes through untouched.
		let payload = contents.bytes;
		const recoded: string[] = [];
		if (request.text === true && (request.textMatch?.(from) ?? true)) {
			const result = recodeText(
				payload,
				source.textEncoding ?? "unicode",
				target.textEncoding ?? "unicode",
				{ strict: request.strict, eol: request.eol },
			);
			payload = result.bytes;
			recoded.push(...result.diagnostics);
		}
		const targetAttributes = [
			...portableAttributes(target, from.attributes, request.noAttributes),
			// After the drop, so "--to-fs atari/dos10 --no-attributes" still
			// means a plain DOS 1.0 file rather than cancelling out.
			...portableAttributes(target, request.attributes ?? [], false),
		];
		// A symlink's readFile note ("this is a symbolic link ...") is
		// informational, not damage. When the target can carry a link the copy
		// is faithful, so stay quiet; when it cannot - a host directory, or an
		// older SpartaDOS revision - the link degrades to a plain file holding
		// its target path, which is worth one warning (the FIXLINK case). Either
		// way the driver's own note is dropped rather than flagged as damage.
		const symlink = from.attributes.includes("Symlink");
		const symlinkNotes =
			symlink && !targetAttributes.includes("Symlink")
				? [
						`${from.path} was a symbolic link; ${target.family} cannot ` +
							`carry one, so it becomes a plain file holding the link's ` +
							`target path`,
					]
				: [];
		const diagnostics = [
			...(symlink ? [] : contents.diagnostics),
			...recoded,
			...symlinkNotes,
			...target.writeFile(to, payload, {
				overwrite: request.force,
				...(request.preserveTimestamps === true && from.timestamp !== undefined
					? { timestamp: from.timestamp }
					: {}),
				attributes: targetAttributes,
			}),
		];
		files.push({ from: from.path, to, diagnostics });
	}

	if (request.move) {
		// Source removal comes last so a failure anywhere above leaves the
		// original in place. Deepest first, so a directory is empty by the
		// time its turn comes.
		for (const { from } of planned) {
			source.removeFile(from.path, { force: request.force });
		}
		const directories = matched
			.filter((entry) => entry.kind === "dir")
			.flatMap((entry) => [
				...[...source.entries(entry.path, { recursive: true })]
					.filter((below) => below.kind === "dir")
					.map((below) => below.path),
				entry.path,
			])
			.sort((a, b) => b.split("/").length - a.split("/").length);
		for (const path of directories) {
			source.removeDirectory(path);
		}
	}

	return { files, directories: plannedDirectories.map((made) => made.path) };
}

function targetHas(target: FileStore, path: string): boolean {
	try {
		const found = [...target.entries(path, { listContents: false })];
		return found.length > 0;
	} catch {
		return false;
	}
}
