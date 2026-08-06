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
	 * Where it lives, from the volume root, "/"-separated - the same string
	 * the read and write calls accept back. Equal to the name for entries in
	 * the root.
	 */
	path: string;
	kind: DirEntryKind;
	/** Size in sectors as the directory entry states it. */
	sectors: number;
	startSector: number;
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

export interface Filesystem {
	readonly family: string;
	readonly variant: string;
	/** Capacity, free space, and whatever else the family volume carries. */
	volume(): VolumeInfo;
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
