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
	 * Iterates the root directory in directory order. The spec filters with
	 * the family's native wildcard semantics. By default this yields what a
	 * directory listing shows; `includeUnlisted` adds the entries the DOSes
	 * pass over - deleted files and ones left open for output - each marked
	 * with the matching attribute. Either way the scan stops at the first
	 * never-used slot, as the DOSes do.
	 */
	entries(
		spec?: string,
		options?: { includeUnlisted?: boolean },
	): IterableIterator<DirEntry>;
	/**
	 * Reads a file by its decoded name (as entries() reports it). Returns
	 * null when no such file exists; never throws on a damaged file - the
	 * recoverable bytes come back with diagnostics.
	 */
	readFile(name: string): FileContents | null;
}
