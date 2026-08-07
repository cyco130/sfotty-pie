// Generic filesystem layer. Family drivers implement Filesystem over a
// SectorMedium; family-specific meaning lives in the attribute vocabulary,
// not in extra DirEntry fields.

export type DirEntryKind = "file" | "dir";

export type DirEntryAttribute =
	/** The file cannot be modified or deleted (Atari DOS "locked"). */
	| "ReadOnly"
	/**
	 * The file was left open for output and may be incomplete. The DOSes
	 * skip these in a directory listing, so entries() does too unless asked
	 * for everything.
	 */
	| "OpenForOutput"
	/** The entry was deleted; its name and chain are still readable. */
	| "Deleted"
	/**
	 * The file the boot record loads - what makes the disk bootable. Derived
	 * from the boot record rather than the directory entry, so it is a
	 * property of the image as a whole, not a flag someone set on the file.
	 */
	| "BootFile"
	/** Atari: DOS 1.0 format sector chain (different data-length encoding). */
	| "AtariDos10"
	/** Atari: DOS 2.5 extended file, hidden from DOS 2.0 (sectors past 719). */
	| "AtariDos25"
	/** Atari: MyDOS format sector links (no file number, full link bytes). */
	| "AtariMyDos";

export type DirEntryAttributes = readonly DirEntryAttribute[];

export interface DirEntry {
	/** Decoded via the family text conventions and lowercased, "name.ext". */
	name: string;
	/**
	 * Where it lives, from the store root, "/"-separated - the same string
	 * the read and write calls accept back. Equal to the name for entries in
	 * the root.
	 */
	path: string;
	kind: DirEntryKind;
	/**
	 * Size in sectors as the directory entry states it, where the store has
	 * sectors at all - absent on a host directory, which has no allocation
	 * for us to report.
	 */
	sectors?: number;
	startSector?: number;
	attributes: DirEntryAttributes;
}

export interface VolumeInfo {
	/** Data sectors the filesystem accounts for, per its own metadata. */
	totalSectors: number;
	/** Free sectors across every region the filesystem tracks. */
	freeSectors: number;
	/** Where the family has one (SpartaDOS); absent otherwise. */
	label?: string;
	/** Family-specific facts worth showing beside the numbers. */
	details: readonly string[];
}

export interface FileContents {
	bytes: Uint8Array;
	/**
	 * Problems met while walking the file, human-readable. Non-empty means
	 * bytes holds whatever was recoverable, possibly truncated.
	 */
	diagnostics: string[];
}

/**
 * What copying needs from either end: a tree of named entries that can be
 * read, written, and removed. A disk image satisfies it through a family
 * driver (see Filesystem below); so does a host directory, which is how one
 * copy operation serves add, extract, and image-to-image alike.
 */
export interface FileStore {
	readonly family: string;
	/**
	 * The characters this store accepts between path components. Used to
	 * recognize a destination that names a directory by trailing separator;
	 * "/" always works, whatever else the family allows.
	 */
	readonly pathSeparators: string;
	/**
	 * Attributes this store can put on a file it writes. Copying intersects
	 * the source entry's attributes with this, so what a target cannot
	 * represent is dropped rather than faked. Allocation-specific markings
	 * (AtariDos25, AtariMyDos) are never in here - they describe where a file
	 * landed, not anything anyone asked for - and neither is BootFile, which
	 * lives in the boot record.
	 */
	readonly writableAttributes: DirEntryAttributes;
	/** Splits a path into components, applying family separator rules. */
	splitPath(path: string): string[];
	/**
	 * Makes a name from elsewhere safe to write here. This is for safety, not
	 * convenience: nothing mangles a name to fit a family's shape - a name
	 * that does not fit is refused, since truncating one throws away the part
	 * that tells related files apart. What this is for is a name that would
	 * be actively dangerous, which on the host means a decoded name from a
	 * damaged directory holding a path separator or control characters.
	 * Absent when the family has nothing to guard against, and a no-op on any
	 * well-formed name where it exists.
	 */
	safeName?(name: string): string;
	/**
	 * Applies the family's own rename-template rule (Atari DOS RENAME's "*"
	 * and "?" over the 8.3 fields). Absent when the family has no such rule,
	 * which makes a template destination an error rather than a literal name.
	 */
	applyNameTemplate?(name: string, template: string): string;
	/**
	 * Iterates a directory in directory order. The spec is a path whose last
	 * component is a name pattern in the family's native wildcard semantics
	 * ("games/*.com"); the path part picks the directory to list, defaulting
	 * to the root. `recursive` descends into subdirectories, applying the
	 * pattern at every level. By default this yields what a directory
	 * listing shows; `includeUnlisted` adds the entries the DOSes pass over -
	 * deleted files and ones left open for output - each marked with the
	 * matching attribute. Either way the scan stops at the first never-used
	 * slot, as the DOSes do. Throws when the path names something that is
	 * not a directory.
	 */
	entries(
		spec?: string,
		options?: {
			includeUnlisted?: boolean;
			recursive?: boolean;
			/** Off makes a spec naming a directory match it, not its contents. */
			listContents?: boolean;
		},
	): IterableIterator<DirEntry>;
	/**
	 * Reads a file by path (as entries() reports it). Returns null when no
	 * such file exists; never throws on a damaged file - the recoverable
	 * bytes come back with diagnostics.
	 */
	readFile(path: string): FileContents | null;
	/**
	 * Writes a file, making no directories along the way. `attributes` asks
	 * for what the entry should carry; anything outside writableAttributes is
	 * ignored, so a caller can hand over a source entry's set as-is. Throws on
	 * a full store or an existing name unless overwrite is set. Returns the
	 * diagnostics from freeing an overwritten file - non-empty means that file
	 * was damaged and only its reachable parts were reclaimed.
	 */
	writeFile(
		path: string,
		bytes: Uint8Array,
		options?: { overwrite?: boolean; attributes?: DirEntryAttributes },
	): string[];
	/**
	 * Removes a file. Throws when the path is missing, names a directory, or
	 * is read-only (unless force). Returns traversal diagnostics as writeFile
	 * does.
	 */
	removeFile(path: string, options?: { force?: boolean }): string[];
	/**
	 * Renames or moves an entry. Staying in one directory keeps its slot,
	 * so nothing but the name changes; moving elsewhere may have to rewrite
	 * per-sector bookkeeping, and returns any diagnostics from walking the
	 * file to do so. Throws when the source is missing or locked (unless
	 * force), or the destination name is taken.
	 */
	moveFile(from: string, to: string, options?: { force?: boolean }): string[];
	/**
	 * Creates a directory. `parents` makes the missing ones along the way
	 * and turns an existing target into a no-op, as `mkdir -p` does.
	 * Mutations stay in the medium's memory.
	 */
	makeDirectory(path: string, options?: { parents?: boolean }): void;
	/**
	 * Removes an empty directory and frees what it occupied. Throws when the
	 * path is missing, is not a directory, or still holds anything - the
	 * same rule the DOSes enforce.
	 */
	removeDirectory(path: string): void;
}

/**
 * A store backed by a volume - a disk image with a family filesystem on it,
 * as opposed to a host directory.
 */
export interface Filesystem extends FileStore {
	readonly variant: string;
	/** Capacity, free space, and whatever else the family volume carries. */
	volume(): VolumeInfo;
}
