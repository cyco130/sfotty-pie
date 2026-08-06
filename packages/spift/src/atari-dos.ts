// Atari DOS family filesystem driver, read-only, root directory only.
// Covers DOS 1.0, DOS 2.0S/2.0D, DOS 2.5 (ED), and MyDOS formats. Layout and
// detection follow the OneDOS notes: VTOC at sector 360 (code byte, then
// total and free sector counts), root directory at sectors 361-368.

import type { SectorMedium } from "./sector-medium.ts";
import type {
	DirEntry,
	DirEntryAttribute,
	FileContents,
	Filesystem,
	VolumeInfo,
} from "./filesystem.ts";

export const ATARI_DOS_VARIANTS = [
	"dos10",
	"dos20s",
	"dos20d",
	"dos25",
	"mydos",
] as const;
export type AtariDosVariant = (typeof ATARI_DOS_VARIANTS)[number];

export interface AtariDosFilesystem extends Filesystem {
	readonly family: "atari";
	readonly variant: AtariDosVariant;
	/**
	 * Writes a file into the root directory. The name is a decoded display
	 * name ("game.com") whose fields must fit 8.3 in [A-Z0-9_@] (see
	 * toAtariName). Throws on a full directory or disk, or an existing name
	 * unless overwrite is set. Mutations stay in the medium's memory.
	 * Returns the traversal diagnostics from freeing an overwritten file's
	 * chain - non-empty means that chain was damaged (loop, bad link) and
	 * only its reachable sectors were freed.
	 *
	 * `format` picks the data-sector encoding: "dos2" (the default, read by
	 * everything from DOS 2.0 on) or "dos1", which DOS 1.0 needs and no
	 * later DOS understands. Either can go on any disk - readers key off
	 * the directory entry's own flag, not the VTOC.
	 */
	writeFile(
		name: string,
		bytes: Uint8Array,
		options?: { overwrite?: boolean; format?: "dos1" | "dos2" },
	): string[];
	/**
	 * Deletes a file: frees its chain in the bitmap and sets the deleted
	 * flag (the rest of the entry stays, like the DOSes leave it). Throws
	 * when the name is missing, a directory, or locked (unless force).
	 * Mutations stay in the medium's memory. Returns
	 * the traversal diagnostics from freeing the chain - non-empty means it
	 * was damaged and only its reachable sectors were freed.
	 */
	deleteFile(name: string, options?: { force?: boolean }): string[];
}

const VTOC_SECTOR = 360;
const DIRECTORY_FIRST = 361;
const DIRECTORY_LAST = 368;
// Every directory - the root and each MyDOS subdirectory - is exactly eight
// sectors holding eight 16-byte entries each, so 64 entries, at either
// density (the second half of a 256-byte directory sector goes unused).
// Subdirectory blocks are contiguous extents, not chains.
const DIRECTORY_SECTORS = 8;
// The VTOC's bitmap (bytes 10..127) addresses sectors 0..943 at either
// density. MyDOS covers bigger disks with extra whole-sector bitmap pages
// allocated backwards from sector 359, each holding sectorSize * 8 bits and
// continuing where the main bitmap stops. Verified against a MyDOS 4.53
// enhanced-density format: code 3, one extra page at 359 covering
// 944..1967, sector 358 left free for data - so pages are single sectors at
// both densities, and the VTOC code is the VTOC sector count plus one.
const MAIN_VTOC_LIMIT = 943;
const EXTRA_VTOC_FIRST = 359;
const DOS25_VTOC2_SECTOR = 1024;
const DOS25_LIMIT = 1023;
const ENTRY_SIZE = 16;
// Double-density disks only use the first half of each 256-byte directory
// sector (BiboDOS and TopDOS excepted), so it's 8 entries at every density.
const ENTRIES_PER_SECTOR = 8;

const FLAG_OUTPUT = 0x01;
const FLAG_DOS2 = 0x02;
const FLAG_NO_LINK = 0x04;
const FLAG_DIRECTORY = 0x10;
const FLAG_LOCKED = 0x20;
const FLAG_IN_USE = 0x40;
const FLAG_DELETED = 0x80;

/**
 * Detects an Atari DOS family filesystem and its variant, or undefined when
 * the VTOC doesn't look like any of them.
 */
export function detectAtariDos(
	medium: SectorMedium,
): AtariDosVariant | undefined {
	if (medium.sectorCount < DIRECTORY_LAST) {
		return undefined;
	}
	const vtoc = medium.readSector(VTOC_SECTOR);
	if (vtoc === null) {
		return undefined;
	}
	const code = vtoc[0] ?? 0;
	const total = (vtoc[1] ?? 0) | ((vtoc[2] ?? 0) << 8);
	const free = (vtoc[3] ?? 0) | ((vtoc[4] ?? 0) << 8);
	// The OneDOS ladder says "free less than total", but a freshly formatted
	// disk with no files has free == total, so the sanity check here is <=.
	if (total === 0 || free > total) {
		return undefined;
	}
	const sd = medium.sectorSize === 128 && medium.sectorCount === 720;
	const ed = medium.sectorSize === 128 && medium.sectorCount === 1040;
	const dd = medium.sectorSize === 256 && medium.sectorCount === 720;
	if (code === 1) {
		return sd && total === 709 ? "dos10" : undefined;
	}
	if (code === 2) {
		if ((sd || dd) && total === 707) {
			return dd ? "dos20d" : "dos20s";
		}
		if (ed && total === 1010) {
			return "dos25";
		}
		// Extended DOS 2.0: nonstandard geometry, DOS 2 addressing.
		if (total < 945 && medium.sectorCount >= total) {
			return medium.sectorSize === 256 ? "dos20d" : "dos20s";
		}
	}
	// MyDOS encodes its VTOC sector count in the code byte; check it against
	// what MyDOS would use for this geometry.
	if (code >= 2 && total <= medium.sectorCount) {
		if (code === 2 + extraVtocPages(medium.sectorSize, medium.sectorCount)) {
			return "mydos";
		}
	}
	return undefined;
}

/** Extra MyDOS bitmap pages a geometry needs past the main VTOC. */
function extraVtocPages(sectorSize: number, sectorCount: number): number {
	if (sectorCount <= MAIN_VTOC_LIMIT) {
		return 0;
	}
	return Math.ceil((sectorCount - MAIN_VTOC_LIMIT) / (sectorSize * 8));
}

interface VtocLayout {
	/** Extra bitmap pages at 359, 358, ... (MyDOS only). */
	extraPages: number;
	/** Highest sector the bitmap can address. */
	limit: number;
	/** The VTOC code byte. */
	code: number;
	hasVtoc2: boolean;
}

function vtocLayout(
	variant: AtariDosVariant,
	sectorSize: number,
	sectorCount: number,
): VtocLayout {
	if (variant === "dos25") {
		return { extraPages: 0, limit: DOS25_LIMIT, code: 2, hasVtoc2: true };
	}
	if (variant !== "mydos") {
		return {
			extraPages: 0,
			limit: MAIN_VTOC_LIMIT,
			code: variant === "dos10" ? 1 : 2,
			hasVtoc2: false,
		};
	}
	const extraPages = extraVtocPages(sectorSize, sectorCount);
	return {
		extraPages,
		limit: MAIN_VTOC_LIMIT + extraPages * sectorSize * 8,
		code: 2 + extraPages,
		hasVtoc2: false,
	};
}

interface RawEntry {
	/** Directory slot 0..63 - also the file number stored in chain links. */
	index: number;
	flags: number;
	name: string;
	ext: string;
	sectors: number;
	startSector: number;
	isDir: boolean;
	displayName: string;
}

/**
 * Opens an Atari DOS filesystem on a medium. The variant is detected when
 * not given; an undetectable (or forced) filesystem falls back to the DOS
 * 2.0 variant matching the density and is still read leniently.
 */
export function openAtariDos(
	medium: SectorMedium,
	variant?: AtariDosVariant,
): AtariDosFilesystem {
	const resolved =
		variant ??
		detectAtariDos(medium) ??
		(medium.sectorSize === 256 ? "dos20d" : "dos20s");

	// Yields every used slot of one directory - the root, or a MyDOS
	// subdirectory's 8-sector block - deleted ones included, stopping at the
	// first never-used slot the way the DOSes' own scan does. Callers decide
	// what to show (see listable below). The index is the slot within THIS
	// directory, which is what a data sector's file number holds (measured
	// on MyDOS 4.53).
	function* scanDirectory(
		first: number = DIRECTORY_FIRST,
	): IterableIterator<RawEntry> {
		let index = -1;
		for (
			let sectorNumber = first;
			sectorNumber < first + DIRECTORY_SECTORS;
			sectorNumber++
		) {
			const sector = medium.readSector(sectorNumber);
			if (sector === null) {
				return;
			}
			for (let slot = 0; slot < ENTRIES_PER_SECTOR; slot++) {
				index++;
				const at = slot * ENTRY_SIZE;
				const flags = sector[at] ?? 0;
				if (flags === 0) {
					return; // a never-used entry ends the directory
				}
				const name = decodeField(sector.subarray(at + 5, at + 13));
				const ext = decodeField(sector.subarray(at + 13, at + 16));
				yield {
					index,
					flags,
					name,
					ext,
					sectors: (sector[at + 1] ?? 0) | ((sector[at + 2] ?? 0) << 8),
					startSector: (sector[at + 3] ?? 0) | ((sector[at + 4] ?? 0) << 8),
					isDir: (flags & FLAG_DIRECTORY) !== 0,
					displayName: ext === "" ? name : `${name}.${ext}`,
				};
			}
		}
	}

	/**
	 * Resolves a path to the first sector of the directory holding it.
	 * Throws when a component is missing or is not a directory. There are no
	 * "." or ".." entries on disk - MyDOS directories carry no parent
	 * pointer - so paths only ever resolve downward from the root, and the
	 * visited set catches a corrupt disk whose directory points at an
	 * ancestor.
	 */
	function lookup(first: number, name: string): RawEntry | undefined {
		for (const raw of scanDirectory(first)) {
			if (listable(raw) && raw.displayName === name) {
				return raw;
			}
		}
		return undefined;
	}

	function resolveDirectory(components: readonly string[]): number {
		let first = DIRECTORY_FIRST;
		const visited = new Set<number>([first]);
		const walked: string[] = [];
		for (const component of components) {
			const wanted = component.toLowerCase();
			const found = lookup(first, wanted);
			const where = walked.length === 0 ? "the root" : walked.join("/");
			if (found === undefined) {
				throw new Error(`${wanted} does not exist in ${where}`);
			}
			if (!found.isDir) {
				throw new Error(`${wanted} in ${where} is a file, not a directory`);
			}
			if (visited.has(found.startSector)) {
				throw new Error(
					`${wanted} points back at a directory already on the path ` +
						`(sector ${found.startSector}); the disk is damaged`,
				);
			}
			visited.add(found.startSector);
			first = found.startSector;
			walked.push(wanted);
		}
		return first;
	}

	// What a directory listing shows: entries in use, MyDOS subdirectories,
	// and DOS 2.5 extended files (output bit with in-use clear). Deleted
	// entries, files left open for output, and slots with none of those bits
	// are passed over, as the DOSes pass over them.
	function listable(raw: RawEntry): boolean {
		if ((raw.flags & FLAG_DELETED) !== 0) {
			return false;
		}
		const inUse = (raw.flags & FLAG_IN_USE) !== 0;
		const output = (raw.flags & FLAG_OUTPUT) !== 0;
		if (inUse) {
			return !output;
		}
		return raw.isDir || output;
	}

	return {
		family: "atari",
		variant: resolved,
		volume(): VolumeInfo {
			const vtoc = medium.readSector(VTOC_SECTOR);
			const total = (vtoc?.[1] ?? 0) | ((vtoc?.[2] ?? 0) << 8);
			const mainFree = (vtoc?.[3] ?? 0) | ((vtoc?.[4] ?? 0) << 8);
			const layout = vtocLayout(
				resolved,
				medium.sectorSize,
				medium.sectorCount,
			);
			const details: string[] = [];
			let free = mainFree;
			if (layout.hasVtoc2) {
				// DOS 2.5 keeps the sectors past 719 in the second VTOC, and
				// its own DIR only ever reports the main count.
				const vtoc2 = medium.readSector(DOS25_VTOC2_SECTOR);
				free += (vtoc2?.[122] ?? 0) | ((vtoc2?.[123] ?? 0) << 8);
				details.push(`${mainFree} below sector 720`);
			}
			return { totalSectors: total, freeSectors: free, details };
		},
		*entries(
			spec?: string,
			options?: {
				includeUnlisted?: boolean;
				recursive?: boolean;
				listContents?: boolean;
			},
		): IterableIterator<DirEntry> {
			// A spec is a path plus a leaf pattern: the path picks the
			// directory to start from, the pattern filters names there (and,
			// when recursing, at every level below).
			const parts = spec === undefined ? [] : splitAtariPath(spec);
			let pattern =
				spec === undefined || parts.length === 0
					? undefined
					: (parts.pop() as string);
			// A spec that names a directory outright lists that directory,
			// the way "ls games" does; only a pattern filters. Callers that
			// mean the directory itself - rm, which removes it rather than
			// looking inside - turn this off.
			if (
				options?.listContents !== false &&
				pattern !== undefined &&
				!/[*?]/.test(pattern)
			) {
				const parent = resolveDirectory(parts);
				if (lookup(parent, pattern)?.isDir === true) {
					parts.push(pattern);
					pattern = undefined;
				}
			}
			const start = resolveDirectory(parts);
			const matches = pattern === undefined ? undefined : compileSpec(pattern);
			const dosFileSector = readAtariDosFilePointer(medium, resolved);

			function* walk(
				first: number,
				prefix: string,
				visited: ReadonlySet<number>,
			): IterableIterator<DirEntry> {
				for (const raw of scanDirectory(first)) {
					const shown = listable(raw);
					if (!shown && options?.includeUnlisted !== true) {
						continue;
					}
					const path =
						prefix === "" ? raw.displayName : `${prefix}/${raw.displayName}`;
					if (matches === undefined || matches(raw.name, raw.ext)) {
						const deleted = (raw.flags & FLAG_DELETED) !== 0;
						const inUse = (raw.flags & FLAG_IN_USE) !== 0;
						const attributes: DirEntryAttribute[] = [];
						if (deleted) {
							attributes.push("Deleted");
						}
						if ((raw.flags & FLAG_LOCKED) !== 0) {
							attributes.push("ReadOnly");
						}
						if (inUse && (raw.flags & FLAG_OUTPUT) !== 0) {
							attributes.push("OpenForOutput");
						}
						if (inUse && (raw.flags & FLAG_DOS2) === 0) {
							attributes.push("AtariDos10");
						}
						if (!deleted && !inUse && !raw.isDir) {
							attributes.push("AtariDos25");
						}
						if ((raw.flags & FLAG_NO_LINK) !== 0) {
							attributes.push("AtariMyDos");
						}
						if (
							!raw.isDir &&
							dosFileSector !== 0 &&
							raw.startSector === dosFileSector
						) {
							attributes.push("BootFile");
						}
						yield {
							name: raw.displayName,
							path,
							kind: raw.isDir ? "dir" : "file",
							sectors: raw.sectors,
							startSector: raw.startSector,
							attributes,
						};
					}
					// Recursion stops at a directory already on the path: a
					// well-formed disk cannot nest one inside itself, so this
					// only ever fires on a damaged one.
					if (
						options?.recursive === true &&
						raw.isDir &&
						shown &&
						!visited.has(raw.startSector)
					) {
						yield* walk(
							raw.startSector,
							path,
							new Set(visited).add(raw.startSector),
						);
					}
				}
			}

			yield* walk(start, parts.join("/"), new Set([start]));
		},
		readFile(path: string): FileContents | null {
			const parts = splitAtariPath(path);
			const leaf = parts.pop();
			if (leaf === undefined) {
				return null;
			}
			const first = resolveDirectory(parts);
			// First match wins; duplicate names only occur on damaged disks.
			for (const raw of scanDirectory(first)) {
				if (listable(raw) && !raw.isDir && raw.displayName === leaf) {
					return walkChain(medium, raw).contents;
				}
			}
			return null;
		},
		writeFile(
			path: string,
			bytes: Uint8Array,
			options?: { overwrite?: boolean; format?: "dos1" | "dos2" },
		): string[] {
			const parts = splitAtariPath(path);
			const leaf = parts.pop();
			if (leaf === undefined) {
				throw new Error("no file name given");
			}
			return writeAtariFile(
				medium,
				resolved,
				resolveDirectory(parts),
				leaf,
				bytes,
				options?.overwrite === true,
				options?.format ?? "dos2",
			);
		},
		makeDirectory(path: string, options?: { parents?: boolean }): void {
			const parts = splitAtariPath(path);
			const leaf = parts.pop();
			if (leaf === undefined) {
				throw new Error("no directory name given");
			}
			if (options?.parents !== true) {
				makeAtariDirectory(medium, resolved, resolveDirectory(parts), leaf);
				return;
			}
			// -p: make each missing component in turn, and treat one that is
			// already there as done. Nothing is flushed to disk until the
			// whole command succeeds, so a failure part way leaves no trace.
			let first = DIRECTORY_FIRST;
			for (const component of [...parts, leaf]) {
				const existing = lookup(first, component);
				if (existing?.isDir === true) {
					first = existing.startSector;
					continue;
				}
				if (existing !== undefined) {
					throw new Error(`${component} is a file, not a directory`);
				}
				makeAtariDirectory(medium, resolved, first, component);
				first = lookup(first, component)?.startSector ?? first;
			}
		},
		moveFile(
			from: string,
			to: string,
			options?: { force?: boolean },
		): string[] {
			const fromParts = splitAtariPath(from);
			const fromLeaf = fromParts.pop();
			const toParts = splitAtariPath(to);
			const toLeaf = toParts.pop();
			if (fromLeaf === undefined || toLeaf === undefined) {
				throw new Error("both a source and a destination name are needed");
			}
			return moveAtariFile(
				medium,
				resolveDirectory(fromParts),
				fromLeaf,
				resolveDirectory(toParts),
				toLeaf,
				options?.force === true,
			);
		},
		removeDirectory(path: string): void {
			const parts = splitAtariPath(path);
			const leaf = parts.pop();
			if (leaf === undefined) {
				throw new Error("the root directory cannot be removed");
			}
			const parentFirst = resolveDirectory(parts);
			let index = -1;
			let found: RawEntry | undefined;
			for (const raw of scanDirectory(parentFirst)) {
				if (listable(raw) && raw.displayName === leaf) {
					found = raw;
					index = raw.index;
					break;
				}
			}
			if (found === undefined) {
				throw new Error(`${leaf} does not exist`);
			}
			if (!found.isDir) {
				throw new Error(`${leaf} is a file, not a directory`);
			}
			for (const raw of scanDirectory(found.startSector)) {
				if (listable(raw)) {
					throw new Error(`${leaf} is not empty`);
				}
			}
			removeAtariDirectory(
				medium,
				resolved,
				parentFirst,
				index,
				found.startSector,
			);
		},
		deleteFile(path: string, options?: { force?: boolean }): string[] {
			const parts = splitAtariPath(path);
			const leaf = parts.pop();
			if (leaf === undefined) {
				throw new Error("no file name given");
			}
			return deleteAtariFile(
				medium,
				resolved,
				resolveDirectory(parts),
				leaf,
				options?.force === true,
			);
		},
	};
}

interface LoadedDirectory {
	slotIn(index: number): Uint8Array;
	/** Writes the directory sector holding a slot back to the medium. */
	flushSlot(
		writeSector: NonNullable<SectorMedium["writeSector"]>,
		slot: number,
	): void;
}

function loadDirectory(
	medium: SectorMedium,
	first: number = DIRECTORY_FIRST,
): LoadedDirectory {
	const dirSectors: Uint8Array[] = [];
	for (let s = first; s < first + DIRECTORY_SECTORS; s++) {
		const sector = medium.readSector(s);
		if (sector === null) {
			throw new Error("the directory is outside the image");
		}
		dirSectors.push(sector);
	}
	return {
		slotIn(index: number): Uint8Array {
			const sector = dirSectors[index >> 3];
			return sector === undefined
				? new Uint8Array(0)
				: sector.subarray(
						(index & 7) * ENTRY_SIZE,
						(index & 7) * ENTRY_SIZE + ENTRY_SIZE,
					);
		},
		flushSlot(writeSector, slot): void {
			const sector = dirSectors[slot >> 3];
			if (sector === undefined || !writeSector(first + (slot >> 3), sector)) {
				throw new Error("directory write failed");
			}
		},
	};
}

/**
 * Splits a path into components. The core spells paths with "/", and the
 * Atari families' own separators - MyDOS's ">" and the ":" of drive specs -
 * are accepted alongside it. "." and ".." resolve textually, since no
 * directory on disk records its parent.
 *
 * SpartaDOS's "<" is a separator that also steps up a level, so
 * "foo>bar>qux<file.txt" means "foo>bar>file.txt" and each further "<"
 * climbs one more. It desugars to "/../", which the same pass then
 * resolves. (Quote it in a shell, which reads "<" as redirection.)
 */
export function splitAtariPath(path: string): string[] {
	const parts: string[] = [];
	for (const part of path.replaceAll("<", "/../").split(/[/>:]/)) {
		if (part === "" || part === ".") {
			continue;
		}
		if (part === "..") {
			parts.pop();
			continue;
		}
		parts.push(part.toLowerCase());
	}
	return parts;
}

function rawEntryFromSlot(entry: Uint8Array, index: number): RawEntry {
	const name = decodeField(entry.subarray(5, 13));
	const ext = decodeField(entry.subarray(13, 16));
	return {
		index,
		flags: entry[0] ?? 0,
		name,
		ext,
		sectors: (entry[1] ?? 0) | ((entry[2] ?? 0) << 8),
		startSector: (entry[3] ?? 0) | ((entry[4] ?? 0) << 8),
		isDir: ((entry[0] ?? 0) & FLAG_DIRECTORY) !== 0,
		displayName: ext === "" ? name : `${name}.${ext}`,
	};
}

interface VtocAccounting {
	readonly layout: VtocLayout;
	isFree(sector: number): boolean;
	mark(sector: number, free: boolean): void;
	flush(writeSector: NonNullable<SectorMedium["writeSector"]>): void;
}

/**
 * The usage bitmap plus free counters, held in memory until flush.
 *
 * On DOS 2.5 the main VTOC is authoritative for the shared region (sectors
 * 48..719) - DOS 2.0 writes to ED disks without updating VTOC2, so its
 * shared copy can be stale; flush repairs it silently. The main free count
 * covers sectors below 720 only; VTOC2's own count (bytes 122-123) covers
 * 720..1023 (verified against wild ED disks).
 *
 * MyDOS instead keeps one count for the whole disk in the main VTOC and
 * spills the bitmap into extra sectors below 360 (see MAIN_VTOC_LIMIT).
 */
function vtocAccounting(
	medium: SectorMedium,
	variant: AtariDosVariant,
): VtocAccounting {
	const vtoc = medium.readSector(VTOC_SECTOR);
	if (vtoc === null) {
		throw new Error("the VTOC is outside the image");
	}
	const layout = vtocLayout(variant, medium.sectorSize, medium.sectorCount);
	const vtoc2 = layout.hasVtoc2 ? medium.readSector(DOS25_VTOC2_SECTOR) : null;
	const extras: Uint8Array[] = [];
	for (let page = 0; page < layout.extraPages; page++) {
		const sector = medium.readSector(EXTRA_VTOC_FIRST - page);
		if (sector === null) {
			throw new Error(
				`VTOC page at sector ${EXTRA_VTOC_FIRST - page} is outside the image`,
			);
		}
		extras.push(sector);
	}
	const bitsPerPage = medium.sectorSize * 8;
	let lowDelta = 0;
	let highDelta = 0;
	const bitPlace = (
		sector: number,
	): [buffer: Uint8Array, at: number, mask: number] | null => {
		if (sector > MAIN_VTOC_LIMIT && extras.length > 0) {
			const offset = sector - MAIN_VTOC_LIMIT - 1;
			const page = extras[Math.floor(offset / bitsPerPage)];
			if (page === undefined) {
				return null;
			}
			const bit = offset % bitsPerPage;
			return [page, bit >> 3, 0x80 >> (bit & 7)];
		}
		if (sector < 720 || vtoc2 === null) {
			if (sector > MAIN_VTOC_LIMIT || 10 + (sector >> 3) >= vtoc.length) {
				return null;
			}
			return [vtoc, 10 + (sector >> 3), 0x80 >> (sector & 7)];
		}
		if (sector > DOS25_LIMIT) {
			return null;
		}
		const offset = sector - 720;
		return [vtoc2, 84 + (offset >> 3), 0x80 >> (offset & 7)];
	};
	const isFree = (sector: number): boolean => {
		const place = bitPlace(sector);
		return place !== null && ((place[0][place[1]] ?? 0) & place[2]) !== 0;
	};
	return {
		layout,
		isFree,
		mark(sector: number, free: boolean): void {
			const place = bitPlace(sector);
			if (place === null || isFree(sector) === free) {
				return;
			}
			const [buffer, at, mask] = place;
			buffer[at] = (buffer[at] ?? 0) ^ mask;
			const delta = free ? 1 : -1;
			// Only DOS 2.5 splits its accounting; everyone else counts the
			// whole disk in the main VTOC.
			if (sector < 720 || vtoc2 === null) {
				lowDelta += delta;
			} else {
				highDelta += delta;
			}
		},
		flush(writeSector): void {
			const lowFree = ((vtoc[3] ?? 0) | ((vtoc[4] ?? 0) << 8)) + lowDelta;
			vtoc[3] = lowFree & 0xff;
			vtoc[4] = (lowFree >> 8) & 0xff;
			if (!writeSector(VTOC_SECTOR, vtoc)) {
				throw new Error("VTOC write failed");
			}
			if (vtoc2 !== null) {
				vtoc2.set(vtoc.subarray(16, 100), 0);
				const highFree =
					((vtoc2[122] ?? 0) | ((vtoc2[123] ?? 0) << 8)) + highDelta;
				vtoc2[122] = highFree & 0xff;
				vtoc2[123] = (highFree >> 8) & 0xff;
				if (!writeSector(DOS25_VTOC2_SECTOR, vtoc2)) {
					throw new Error("VTOC2 write failed");
				}
			}
			extras.forEach((page, index) => {
				if (!writeSector(EXTRA_VTOC_FIRST - index, page)) {
					throw new Error(
						`VTOC page at sector ${EXTRA_VTOC_FIRST - index}: write failed`,
					);
				}
			});
		},
	};
}

/**
 * The first sector of a run of `count` free sectors, or 0 when the bitmap
 * has no such run. Directories need this rather than the scattered
 * first-free sectors a file can live in: MyDOS stores a directory as one
 * contiguous 8-sector extent, and refuses to create one otherwise (a disk
 * with 174 free but non-adjacent sectors gives it ERROR 162).
 */
function findContiguousRun(
	medium: SectorMedium,
	accounting: VtocAccounting,
	count: number,
): number {
	const layout = accounting.layout;
	const maxSector = Math.min(medium.sectorCount, layout.limit);
	const firstExtraVtoc = EXTRA_VTOC_FIRST - layout.extraPages + 1;
	let run = 0;
	for (let sector = 1; sector <= maxSector; sector++) {
		const reserved = sector >= firstExtraVtoc && sector <= DIRECTORY_LAST;
		if (reserved || !accounting.isFree(sector)) {
			run = 0;
			continue;
		}
		run++;
		if (run === count) {
			return sector - count + 1;
		}
	}
	return 0;
}

function makeAtariDirectory(
	medium: SectorMedium,
	variant: AtariDosVariant,
	parentFirst: number,
	name: string,
): void {
	const writeSector = medium.writeSector?.bind(medium);
	if (writeSector === undefined) {
		throw new Error("the medium is read-only");
	}
	const native = encodeAtariName(name);
	const directory = loadDirectory(medium, parentFirst);

	let freeSlot = -1;
	for (let index = 0; index < DIRECTORY_SECTORS * ENTRIES_PER_SECTOR; index++) {
		const entry = directory.slotIn(index);
		const flags = entry[0] ?? 0;
		if (flags === 0) {
			if (freeSlot === -1) {
				freeSlot = index;
			}
			break;
		}
		if ((flags & FLAG_DELETED) !== 0) {
			if (freeSlot === -1) {
				freeSlot = index;
			}
			continue;
		}
		const slotName = decodeField(entry.subarray(5, 13)).toUpperCase();
		const slotExt = decodeField(entry.subarray(13, 16)).toUpperCase();
		if (slotName === native.name && slotExt === native.ext) {
			throw new Error(`${name.toLowerCase()} already exists`);
		}
	}
	if (freeSlot === -1) {
		throw new Error("the directory is full");
	}

	const accounting = vtocAccounting(medium, variant);
	const start = findContiguousRun(medium, accounting, DIRECTORY_SECTORS);
	if (start === 0) {
		throw new Error(
			`no run of ${DIRECTORY_SECTORS} free sectors for a directory ` +
				`(a directory has to be contiguous, however much space is free)`,
		);
	}
	// A fresh directory is eight zeroed sectors: every slot never-used, so a
	// scan of it stops immediately.
	for (let i = 0; i < DIRECTORY_SECTORS; i++) {
		if (!writeSector(start + i, new Uint8Array(medium.sectorSize))) {
			throw new Error(`sector ${start + i}: write failed`);
		}
		accounting.mark(start + i, false);
	}

	// MyDOS writes exactly $10 here: the in-use bit stays clear, which is
	// what makes DOSes without subdirectories skip the entry.
	const entry = directory.slotIn(freeSlot);
	entry[0] = FLAG_DIRECTORY;
	entry[1] = DIRECTORY_SECTORS;
	entry[2] = 0;
	entry[3] = start & 0xff;
	entry[4] = (start >> 8) & 0xff;
	for (let i = 0; i < 8; i++) {
		entry[5 + i] = native.name.charCodeAt(i) || 0x20;
	}
	for (let i = 0; i < 3; i++) {
		entry[13 + i] = native.ext.charCodeAt(i) || 0x20;
	}
	directory.flushSlot(writeSector, freeSlot);
	accounting.flush(writeSector);
}

function removeAtariDirectory(
	medium: SectorMedium,
	variant: AtariDosVariant,
	parentFirst: number,
	entryIndex: number,
	block: number,
): void {
	const writeSector = medium.writeSector?.bind(medium);
	if (writeSector === undefined) {
		throw new Error("the medium is read-only");
	}
	const directory = loadDirectory(medium, parentFirst);
	const accounting = vtocAccounting(medium, variant);
	for (let i = 0; i < DIRECTORY_SECTORS; i++) {
		accounting.mark(block + i, true);
	}
	const entry = directory.slotIn(entryIndex);
	entry[0] = FLAG_DELETED;
	directory.flushSlot(writeSector, entryIndex);
	accounting.flush(writeSector);
}

/**
 * Builds a new name from a source name and a rename template, the way the
 * DOSes' own RENAME does with `*.LST,*.TXT`. Positional over the
 * space-padded 8 and 3 character fields, measured against DOS 2.0S:
 * "*" copies the source from that position to the end of the field
 * (AB.TXT with Q*.BAK gives QB.BAK), "?" copies the character at that
 * position, anything else replaces it, and once the template runs out the
 * rest of the field is blank (ABCDEFGH.TXT with ??Z.BAK gives ABZ.BAK).
 */
export function applyAtariNameTemplate(name: string, template: string): string {
	const split = (text: string): [string, string] => {
		const dot = text.indexOf(".");
		return dot === -1 ? [text, ""] : [text.slice(0, dot), text.slice(dot + 1)];
	};
	const [sourceName, sourceExt] = split(name.toUpperCase());
	const [templateName, templateExt] = split(template.toUpperCase());
	const field = (source: string, pattern: string, width: number): string => {
		const from = source.padEnd(width);
		let out = "";
		for (let i = 0; i < width; i++) {
			const char = pattern[i];
			if (char === "*") {
				out += from.slice(i, width);
				break;
			}
			out += char ?? " ";
			if (char === "?") {
				out = out.slice(0, -1) + (from[i] ?? " ");
			}
		}
		return out.padEnd(width).slice(0, width).trimEnd();
	};
	const newName = field(sourceName, templateName, 8);
	const newExt = field(sourceExt, templateExt, 3);
	return (newExt === "" ? newName : `${newName}.${newExt}`).toLowerCase();
}

function moveAtariFile(
	medium: SectorMedium,
	fromFirst: number,
	fromLeaf: string,
	toFirst: number,
	toLeaf: string,
	force: boolean,
): string[] {
	const writeSector = medium.writeSector?.bind(medium);
	if (writeSector === undefined) {
		throw new Error("the medium is read-only");
	}
	const target = encodeAtariName(toLeaf);
	const source = loadDirectory(medium, fromFirst);

	let index = -1;
	for (let slot = 0; slot < DIRECTORY_SECTORS * ENTRIES_PER_SECTOR; slot++) {
		const entry = source.slotIn(slot);
		const flags = entry[0] ?? 0;
		if (flags === 0) {
			break;
		}
		if ((flags & FLAG_DELETED) !== 0) {
			continue;
		}
		const name = decodeField(entry.subarray(5, 13));
		const ext = decodeField(entry.subarray(13, 16));
		if ((ext === "" ? name : `${name}.${ext}`) === fromLeaf) {
			index = slot;
			break;
		}
	}
	if (index === -1) {
		throw new Error(`${fromLeaf} does not exist`);
	}
	const raw = rawEntryFromSlot(source.slotIn(index), index);
	if ((raw.flags & FLAG_LOCKED) !== 0 && !force) {
		throw new Error(`${fromLeaf} is locked`);
	}

	// Renaming inside one directory keeps the slot, and the slot index is
	// what a data sector's file number holds - so the chain is untouched.
	if (fromFirst === toFirst) {
		if (fromLeaf !== toLeaf) {
			const clash = lookupSlot(source, target);
			if (clash !== -1) {
				throw new Error(`${toLeaf} already exists`);
			}
		}
		const entry = source.slotIn(index);
		for (let i = 0; i < 8; i++) {
			entry[5 + i] = target.name.charCodeAt(i) || 0x20;
		}
		for (let i = 0; i < 3; i++) {
			entry[13 + i] = target.ext.charCodeAt(i) || 0x20;
		}
		source.flushSlot(writeSector, index);
		return [];
	}

	const destination = loadDirectory(medium, toFirst);
	if (lookupSlot(destination, target) !== -1) {
		throw new Error(`${toLeaf} already exists in the destination`);
	}
	let free = -1;
	for (let slot = 0; slot < DIRECTORY_SECTORS * ENTRIES_PER_SECTOR; slot++) {
		const flags = destination.slotIn(slot)[0] ?? 0;
		if (flags === 0 || (flags & FLAG_DELETED) !== 0) {
			free = slot;
			break;
		}
	}
	if (free === -1) {
		throw new Error("the destination directory is full");
	}

	// Moving to a different slot invalidates the file number every data
	// sector carries - unless there is none to carry: directory blocks have
	// no link trailer, and MyDOS's full-link files store no file number.
	const diagnostics: string[] = [];
	const numbered =
		!raw.isDir && (raw.flags & FLAG_NO_LINK) === 0 && free !== index;
	if (numbered) {
		const walk = walkChain(medium, raw);
		diagnostics.push(...walk.contents.diagnostics);
		for (const sector of walk.visited) {
			const data = medium.readSector(sector);
			if (data === null || data.length < 3) {
				continue;
			}
			const at = data.length - 3;
			data[at] = ((free << 2) | ((data[at] ?? 0) & 0x03)) & 0xff;
			if (!writeSector(sector, data)) {
				throw new Error(`sector ${sector}: write failed`);
			}
		}
	}

	const entry = destination.slotIn(free);
	entry.set(source.slotIn(index));
	for (let i = 0; i < 8; i++) {
		entry[5 + i] = target.name.charCodeAt(i) || 0x20;
	}
	for (let i = 0; i < 3; i++) {
		entry[13 + i] = target.ext.charCodeAt(i) || 0x20;
	}
	destination.flushSlot(writeSector, free);
	source.slotIn(index)[0] = FLAG_DELETED;
	source.flushSlot(writeSector, index);
	return diagnostics;
}

function lookupSlot(
	directory: LoadedDirectory,
	wanted: { name: string; ext: string },
): number {
	for (let slot = 0; slot < DIRECTORY_SECTORS * ENTRIES_PER_SECTOR; slot++) {
		const entry = directory.slotIn(slot);
		const flags = entry[0] ?? 0;
		if (flags === 0) {
			return -1;
		}
		if ((flags & FLAG_DELETED) !== 0) {
			continue;
		}
		if (
			decodeField(entry.subarray(5, 13)).toUpperCase() === wanted.name &&
			decodeField(entry.subarray(13, 16)).toUpperCase() === wanted.ext
		) {
			return slot;
		}
	}
	return -1;
}

function writeAtariFile(
	medium: SectorMedium,
	variant: AtariDosVariant,
	directoryFirst: number,
	name: string,
	fileBytes: Uint8Array,
	overwrite: boolean,
	format: "dos1" | "dos2",
): string[] {
	const writeSector = medium.writeSector?.bind(medium);
	if (writeSector === undefined) {
		throw new Error("the medium is read-only");
	}
	const native = encodeAtariName(name);

	// Find both a slot to use and any existing file of the same name.
	const directory = loadDirectory(medium, directoryFirst);
	const { slotIn } = directory;
	let freeSlot = -1;
	let existing = -1;
	for (let index = 0; index < 8 * ENTRIES_PER_SECTOR; index++) {
		const entry = slotIn(index);
		const flags = entry[0] ?? 0;
		if (flags === 0) {
			if (freeSlot === -1) {
				freeSlot = index;
			}
			break;
		}
		if ((flags & FLAG_DELETED) !== 0) {
			if (freeSlot === -1) {
				freeSlot = index;
			}
			continue;
		}
		const slotName = decodeField(entry.subarray(5, 13)).toUpperCase();
		const slotExt = decodeField(entry.subarray(13, 16)).toUpperCase();
		if (slotName === native.name && slotExt === native.ext) {
			existing = index;
		}
	}
	if (existing !== -1 && !overwrite) {
		throw new Error(`${name.toLowerCase()} already exists on the image`);
	}
	const slot = existing !== -1 ? existing : freeSlot;
	if (slot === -1) {
		throw new Error("the directory is full");
	}

	const accounting = vtocAccounting(medium, variant);
	const { isFree, mark } = accounting;

	// Overwrite frees the old chain first so its sectors are reusable. A
	// damaged chain (loop, bad link) still frees its reachable sectors; the
	// walk's findings are reported to the caller.
	const diagnostics: string[] = [];
	let replacedStart = -1;
	if (existing !== -1) {
		const raw = rawEntryFromSlot(slotIn(existing), existing);
		replacedStart = raw.startSector;
		const walk = walkChain(medium, raw);
		diagnostics.push(...walk.contents.diagnostics);
		for (const sector of walk.visited) {
			mark(sector, true);
		}
	}

	// First-free ascending allocation; zero-length files still take a
	// sector. The system sectors are skipped as a belt-and-suspenders on top
	// of the bitmap.
	const capacity = medium.sectorSize - 3;
	const needed = Math.max(1, Math.ceil(fileBytes.length / capacity));
	const layout = accounting.layout;
	const maxSector = Math.min(medium.sectorCount, layout.limit);
	const firstExtraVtoc = EXTRA_VTOC_FIRST - layout.extraPages + 1;
	const allocated: number[] = [];
	// Sector 0 does not exist - the bitmap's bit 0 stands for it and every
	// format marks it used - so the scan starts at 1 and otherwise takes
	// the bitmap at its word. That includes the boot sectors: they are
	// marked used by every format, and when a bitmap does offer them the
	// DOSes hand them out too (measured on DOS 1.0, 2.0S, 2.5, and MyDOS
	// alike). The VTOC and directory are skipped regardless - scribbling
	// there would destroy the bitmap this loop is reading, a worse failure
	// than overwriting boot code.
	for (let s = 1; s <= maxSector && allocated.length < needed; s++) {
		if (s >= firstExtraVtoc && s <= DIRECTORY_LAST) {
			continue;
		}
		if (isFree(s)) {
			allocated.push(s);
		}
	}
	if (allocated.length < needed) {
		throw new Error(
			`not enough free space for ${name.toLowerCase()} ` +
				`(needs ${needed} sectors, ${allocated.length} free)`,
		);
	}
	for (const s of allocated) {
		mark(s, false);
	}

	// Sector numbers past 1023 do not fit the 10-bit link field, so those
	// files use the whole two bytes as MyDOS does and carry the
	// no-file-number flag that tells every reader (ours included) to skip
	// the cross-check. DOS 1.0's addressing never reaches that far.
	const fullLinks = allocated.some((sector) => sector > 1023);
	if (format === "dos1" && fullLinks) {
		throw new Error(
			`${name.toLowerCase()} would reach past sector 1023, which DOS 1.0 ` +
				`chains cannot address`,
		);
	}
	for (let i = 0; i < allocated.length; i++) {
		const sector = allocated[i] ?? 0;
		const next = allocated[i + 1] ?? 0;
		const chunk = fileBytes.subarray(
			i * capacity,
			Math.min((i + 1) * capacity, fileBytes.length),
		);
		const buffer = new Uint8Array(medium.sectorSize);
		buffer.set(chunk);
		buffer[capacity] = fullLinks
			? (next >> 8) & 0xff
			: (slot << 2) | ((next >> 8) & 0x03);
		buffer[capacity + 1] = next & 0xff;
		// DOS 2 stores the byte count outright. DOS 1.0 instead flags the
		// last sector with bit 7 and puts the count in the low 7 bits;
		// earlier sectors are always full and carry the file's own sector
		// sequence number there (0, 1, 2, ... mod 128) - measured from a
		// 21-sector file written by real DOS 1.0, which is NOT the "low 7
		// bits of the sector number" the OneDOS notes describe.
		buffer[capacity + 2] =
			format === "dos2"
				? chunk.length
				: i === allocated.length - 1
					? 0x80 | chunk.length
					: i & 0x7f;
		if (!writeSector(sector, buffer)) {
			throw new Error(`sector ${sector}: write failed`);
		}
	}

	// The directory entry. A file reaching past sector 719 on DOS 2.5 gets
	// the extended marking (output bit, in-use clear) that hides it from
	// DOS 2.0.
	const extended = layout.hasVtoc2 && allocated.some((s) => s > 719);
	const dos2Bit = format === "dos2" ? FLAG_DOS2 : 0;
	const entry = slotIn(slot);
	entry[0] =
		(extended ? FLAG_OUTPUT | dos2Bit : FLAG_IN_USE | dos2Bit) |
		(fullLinks ? FLAG_NO_LINK : 0);
	entry[1] = allocated.length & 0xff;
	entry[2] = allocated.length >> 8;
	entry[3] = (allocated[0] ?? 0) & 0xff;
	entry[4] = (allocated[0] ?? 0) >> 8;
	for (let i = 0; i < 8; i++) {
		entry[5 + i] = native.name.charCodeAt(i) || 0x20;
	}
	for (let i = 0; i < 3; i++) {
		entry[13 + i] = native.ext.charCodeAt(i) || 0x20;
	}
	directory.flushSlot(writeSector, slot);
	accounting.flush(writeSector);

	// Rewriting the file the boot record loads moves it, so the pointer has
	// to follow or the disk stops booting.
	if (
		replacedStart > 0 &&
		readAtariDosFilePointer(medium, variant) === replacedStart
	) {
		writeAtariDosFilePointer(medium, variant, allocated[0] ?? 0);
	}
	return diagnostics;
}

function deleteAtariFile(
	medium: SectorMedium,
	variant: AtariDosVariant,
	directoryFirst: number,
	name: string,
	force: boolean,
): string[] {
	const writeSector = medium.writeSector?.bind(medium);
	if (writeSector === undefined) {
		throw new Error("the medium is read-only");
	}
	const native = encodeAtariName(name);

	const directory = loadDirectory(medium, directoryFirst);
	let found = -1;
	for (let index = 0; index < 8 * ENTRIES_PER_SECTOR; index++) {
		const entry = directory.slotIn(index);
		const flags = entry[0] ?? 0;
		if (flags === 0) {
			break;
		}
		if ((flags & FLAG_DELETED) !== 0) {
			continue;
		}
		const slotName = decodeField(entry.subarray(5, 13)).toUpperCase();
		const slotExt = decodeField(entry.subarray(13, 16)).toUpperCase();
		if (slotName === native.name && slotExt === native.ext) {
			found = index;
			break;
		}
	}
	if (found === -1) {
		throw new Error(`${name.toLowerCase()} not found on the image`);
	}
	const raw = rawEntryFromSlot(directory.slotIn(found), found);
	if (raw.isDir) {
		throw new Error(`${name.toLowerCase()} is a directory`);
	}
	if ((raw.flags & FLAG_LOCKED) !== 0 && !force) {
		throw new Error(`${name.toLowerCase()} is locked`);
	}

	const accounting = vtocAccounting(medium, variant);
	// A damaged chain still frees its reachable sectors; the walk's findings
	// go back to the caller.
	const walk = walkChain(medium, raw);
	for (const sector of walk.visited) {
		accounting.mark(sector, true);
	}
	// The deleted flag alone, like the DOSes do - the rest of the entry
	// stays for undelete tools.
	const entry = directory.slotIn(found);
	entry[0] = FLAG_DELETED;
	directory.flushSlot(writeSector, found);
	accounting.flush(writeSector);

	// A disk whose boot record points at a file that is gone would fail at
	// boot time with no explanation; say so in the boot record instead.
	if (readAtariDosFilePointer(medium, variant) === raw.startSector) {
		writeAtariDosFilePointer(medium, variant, 0);
	}
	return walk.contents.diagnostics;
}

/**
 * Boot sectors each variant reserves - one for DOS 1.0, three for the rest
 * (verified against disks formatted by the real DOSes).
 */
export const ATARI_DOS_BOOT_SECTORS: Record<AtariDosVariant, number> = {
	dos10: 1,
	dos20s: 3,
	dos20d: 3,
	dos25: 3,
	mydos: 3,
};

// Where the boot record keeps the first sector of the file it loads. DOS 2
// and its derivatives put it at 15-16; DOS 1.0 puts it one byte later and
// additionally requires $ff at byte 14 (where DOS 2 keeps its sector size
// code) or it refuses to boot. Measured across the DOS 1.0, 2.0S, 2.0D,
// 2.5, MyDOS 4.53 and 4.55 masters.
const DOS_FILE_POINTER = 15;
const DOS10_FILE_POINTER = 16;
const DOS10_PRESENT_FLAG = 14;

function bootRecord(medium: SectorMedium): Uint8Array {
	const sector = medium.readSector(1);
	if (sector === null || sector.length < 18) {
		throw new Error("the boot record is outside the image");
	}
	return sector;
}

/**
 * The sector the boot record loads its DOS from - the "DOS file" - or 0
 * when the image has none set.
 */
export function readAtariDosFilePointer(
	medium: SectorMedium,
	variant: AtariDosVariant,
): number {
	const boot = medium.readSector(1);
	if (boot === null || boot.length < 18) {
		return 0;
	}
	if (variant === "dos10") {
		return boot[DOS10_PRESENT_FLAG] !== 0xff
			? 0
			: (boot[DOS10_FILE_POINTER] ?? 0) |
					((boot[DOS10_FILE_POINTER + 1] ?? 0) << 8);
	}
	return (
		(boot[DOS_FILE_POINTER] ?? 0) | ((boot[DOS_FILE_POINTER + 1] ?? 0) << 8)
	);
}

/**
 * Points the boot record at a sector, which is all that stands between a
 * disk holding a DOS and a disk that boots it. Sector 0 clears it. On DOS
 * 1.0 this also maintains the $ff flag its boot code checks.
 */
export function writeAtariDosFilePointer(
	medium: SectorMedium,
	variant: AtariDosVariant,
	sector: number,
): void {
	const writeSector = medium.writeSector?.bind(medium);
	if (writeSector === undefined) {
		throw new Error("the medium is read-only");
	}
	const boot = bootRecord(medium);
	const at = variant === "dos10" ? DOS10_FILE_POINTER : DOS_FILE_POINTER;
	boot[at] = sector & 0xff;
	boot[at + 1] = (sector >> 8) & 0xff;
	if (variant === "dos10") {
		boot[DOS10_PRESENT_FLAG] = sector === 0 ? 0 : 0xff;
	}
	if (!writeSector(1, boot)) {
		throw new Error("boot record write failed");
	}
}

const VARIANT_LABELS: Record<AtariDosVariant, string> = {
	dos10: "DOS 1.0",
	dos20s: "DOS 2.0S",
	dos20d: "DOS 2.0D",
	dos25: "DOS 2.5",
	mydos: "MyDOS",
};

/**
 * The variant to format a geometry with when the caller doesn't say:
 * DOS 2.0S for a standard single-density disk, MyDOS for anything else,
 * and undefined for enhanced density - DOS 2.5 and MyDOS are equally
 * plausible there, so the caller has to choose.
 */
export function defaultAtariDosVariant(
	sectorSize: number,
	sectorCount: number,
): AtariDosVariant | undefined {
	if (sectorSize === 128 && sectorCount === 720) {
		return "dos20s";
	}
	if (sectorSize === 128 && sectorCount === 1040) {
		return undefined;
	}
	return "mydos";
}

/**
 * Why the variant cannot be put on this geometry, or undefined when it
 * can.
 */
export function checkAtariDosGeometry(
	variant: AtariDosVariant,
	sectorSize: number,
	sectorCount: number,
): string | undefined {
	const label = VARIANT_LABELS[variant];
	if (sectorSize !== 128 && sectorSize !== 256) {
		return `the Atari DOS filesystems need 128- or 256-byte sectors, not ${sectorSize}`;
	}
	if (sectorSize === 256 && (variant === "dos10" || variant === "dos25")) {
		return `${label} only supports 128-byte sectors`;
	}
	if (variant === "dos25") {
		if (sectorCount < 1024) {
			return (
				`${label} needs at least 1024 sectors ` +
				`(its second VTOC lives at sector 1024), image has ${sectorCount}`
			);
		}
	} else if (sectorCount <= DIRECTORY_LAST) {
		return (
			`${label} needs more than ${DIRECTORY_LAST} sectors ` +
			`(VTOC at ${VTOC_SECTOR}, directory at ` +
			`${DIRECTORY_FIRST}-${DIRECTORY_LAST}), image has ${sectorCount}`
		);
	}
	// MyDOS's extra bitmap pages always fit: the largest ATR (65535 sectors)
	// needs 64 of them at 128 bytes per sector, ending at sector 296 - well
	// clear of the boot area.
	//
	// Sectors past a variant's reach are not an error either; the filesystem
	// leaves them unused, which is what the formatter reports.
	return undefined;
}

export interface FormatAtariDosOptions {
	/**
	 * Boot sector contents: exactly the variant's boot area (1 sector for
	 * DOS 1.0, 3 for the rest, 128 bytes each). Left zeroed when absent.
	 */
	bootSectors?: Uint8Array;
}

export interface FormatAtariDosResult {
	variant: AtariDosVariant;
	/** Data sectors the filesystem can hold, as the VTOC states it. */
	totalSectors: number;
	freeSectors: number;
	/** Sectors the variant cannot address, so the filesystem wastes them. */
	unusableSectors: number;
}

/**
 * Writes an empty filesystem onto a medium: the VTOC (plus DOS 2.5's
 * second VTOC), an empty directory, and optionally boot sectors. Existing
 * contents are overwritten. Throws when the variant does not fit the
 * geometry (see checkAtariDosGeometry) or the boot sectors are the wrong
 * shape. Mutations stay in the medium's memory.
 */
export function formatAtariDos(
	medium: SectorMedium,
	variant: AtariDosVariant,
	options?: FormatAtariDosOptions,
): FormatAtariDosResult {
	const writeSector = medium.writeSector?.bind(medium);
	if (writeSector === undefined) {
		throw new Error("the medium is read-only");
	}
	const problem = checkAtariDosGeometry(
		variant,
		medium.sectorSize,
		medium.sectorCount,
	);
	if (problem !== undefined) {
		throw new Error(problem);
	}

	const bootCount = ATARI_DOS_BOOT_SECTORS[variant];
	const boot = options?.bootSectors;
	if (boot !== undefined) {
		if (boot.length !== bootCount * 128) {
			throw new Error(
				`${VARIANT_LABELS[variant]} reserves ${bootCount} boot ` +
					`sector(s) (${bootCount * 128} bytes), the file has ` +
					`${boot.length}; write-boot-sectors handles other shapes`,
			);
		}
		if (boot[1] !== bootCount) {
			throw new Error(
				`the boot record claims ${boot[1] ?? 0} boot sector(s) but ` +
					`${VARIANT_LABELS[variant]} reserves ${bootCount}; ` +
					`write-boot-sectors handles other shapes`,
			);
		}
	}

	const layout = vtocLayout(variant, medium.sectorSize, medium.sectorCount);
	const limit = Math.min(medium.sectorCount, layout.limit);
	const hasVtoc2 = layout.hasVtoc2;
	// The extra MyDOS bitmap pages sit just below the VTOC and are not data.
	const firstExtraVtoc = EXTRA_VTOC_FIRST - layout.extraPages + 1;
	// Sector 720 is unusable to every DOS 2 family member - only MyDOS
	// reclaims it (both verified against real formats).
	const wastes720 = variant !== "mydos";
	const usable = (sector: number): boolean => {
		if (sector < 1 || sector > limit) {
			return false;
		}
		if (sector <= bootCount) {
			return false;
		}
		if (sector >= firstExtraVtoc && sector <= DIRECTORY_LAST) {
			return false;
		}
		if (sector === 720 && wastes720) {
			return false;
		}
		return true;
	};

	const vtoc = new Uint8Array(medium.sectorSize);
	// The main bitmap covers sectors 0..943 in bytes 10..127; on DOS 2.5
	// everything from 720 up is left "used" here and tracked in the VTOC2.
	let freeLow = 0;
	for (let sector = 0; sector <= MAIN_VTOC_LIMIT; sector++) {
		const free = usable(sector) && !(hasVtoc2 && sector >= 720);
		if (free) {
			vtoc[10 + (sector >> 3)] =
				(vtoc[10 + (sector >> 3)] ?? 0) | (0x80 >> (sector & 7));
			if (sector < 720) {
				freeLow++;
			}
		}
	}
	// MyDOS's freed sector 720 counts in the main VTOC's own tally.
	let freeHigh = 0;
	if (!hasVtoc2) {
		for (let sector = 720; sector <= MAIN_VTOC_LIMIT; sector++) {
			if (usable(sector)) {
				freeHigh++;
			}
		}
	}

	const vtoc2 = hasVtoc2 ? new Uint8Array(medium.sectorSize) : null;
	if (vtoc2 !== null) {
		// Bytes 0..83 mirror the main VTOC's sectors 48..719; 84..121 map
		// 720..1023; 122..123 count the free sectors above 719.
		vtoc2.set(vtoc.subarray(16, 100), 0);
		for (let sector = 720; sector <= DOS25_LIMIT; sector++) {
			if (usable(sector)) {
				const offset = sector - 720;
				vtoc2[84 + (offset >> 3)] =
					(vtoc2[84 + (offset >> 3)] ?? 0) | (0x80 >> (offset & 7));
				freeHigh++;
			}
		}
		vtoc2[122] = freeHigh & 0xff;
		vtoc2[123] = (freeHigh >> 8) & 0xff;
	}

	// MyDOS's extra bitmap pages carry on from where the main one stops,
	// one whole sector each, allocated backwards from 359.
	const bitsPerPage = medium.sectorSize * 8;
	const extras: Uint8Array[] = [];
	for (let page = 0; page < layout.extraPages; page++) {
		const buffer = new Uint8Array(medium.sectorSize);
		for (let bit = 0; bit < bitsPerPage; bit++) {
			const sector = MAIN_VTOC_LIMIT + 1 + page * bitsPerPage + bit;
			if (usable(sector)) {
				buffer[bit >> 3] = (buffer[bit >> 3] ?? 0) | (0x80 >> (bit & 7));
				freeHigh++;
			}
		}
		extras.push(buffer);
	}

	const total = freeLow + freeHigh;
	const mainFree = hasVtoc2 ? freeLow : total;
	vtoc[0] = layout.code;
	vtoc[1] = total & 0xff;
	vtoc[2] = (total >> 8) & 0xff;
	vtoc[3] = mainFree & 0xff;
	vtoc[4] = (mainFree >> 8) & 0xff;

	// Boot sectors, then the empty directory, then the accounting.
	for (let sector = 1; sector <= bootCount; sector++) {
		const buffer = new Uint8Array(medium.readSector(sector)?.length ?? 128);
		if (boot !== undefined) {
			buffer.set(boot.subarray((sector - 1) * 128, sector * 128));
		}
		if (!writeSector(sector, buffer)) {
			throw new Error(`sector ${sector}: write failed`);
		}
	}
	for (let sector = DIRECTORY_FIRST; sector <= DIRECTORY_LAST; sector++) {
		if (!writeSector(sector, new Uint8Array(medium.sectorSize))) {
			throw new Error(`sector ${sector}: write failed`);
		}
	}
	if (!writeSector(VTOC_SECTOR, vtoc)) {
		throw new Error("VTOC write failed");
	}
	if (vtoc2 !== null && !writeSector(DOS25_VTOC2_SECTOR, vtoc2)) {
		throw new Error("VTOC2 write failed");
	}
	extras.forEach((page, index) => {
		if (!writeSector(EXTRA_VTOC_FIRST - index, page)) {
			throw new Error(
				`VTOC page at sector ${EXTRA_VTOC_FIRST - index}: write failed`,
			);
		}
	});

	return {
		variant,
		totalSectors: total,
		freeSectors: total,
		unusableSectors: Math.max(0, medium.sectorCount - limit),
	};
}

function encodeAtariName(display: string): { name: string; ext: string } {
	const dot = display.indexOf(".");
	const name = (dot === -1 ? display : display.slice(0, dot)).toUpperCase();
	const ext = (dot === -1 ? "" : display.slice(dot + 1)).toUpperCase();
	// Spaces are allowed inside a name, just not to start one: the field is
	// space-padded, and the DOSes' own RENAME templates produce such names
	// (X.TXT with ??Z.BAK gives "X Z" on DOS 2.0S, measured). Host names
	// never arrive this way - toAtariName turns anything odd into "_".
	if (
		!/^[A-Z0-9_@][A-Z0-9_@ ]{0,7}$/.test(name) ||
		!/^[A-Z0-9_@ ]{0,3}$/.test(ext)
	) {
		throw new Error(`invalid Atari file name "${display}"`);
	}
	return { name, ext };
}

/**
 * Mangles a host file name into the native policy: uppercase 8.3 with
 * [A-Z0-9_@] (other characters become "_", overlong fields truncate).
 * Returns the decoded display form (lowercase) that ls/readFile/writeFile
 * speak.
 */
export function toAtariName(hostName: string): string {
	const stripped = hostName.replace(/^\.+/, "");
	const dot = stripped.lastIndexOf(".");
	const mangleField = (text: string, max: number): string =>
		text
			.toUpperCase()
			.replace(/[^A-Z0-9_@]/g, "_")
			.slice(0, max);
	const name = mangleField(dot <= 0 ? stripped : stripped.slice(0, dot), 8);
	const ext = mangleField(dot <= 0 ? "" : stripped.slice(dot + 1), 3);
	const safeName = name === "" ? "_" : name;
	return (ext === "" ? safeName : `${safeName}.${ext}`).toLowerCase();
}

function walkChain(
	medium: SectorMedium,
	entry: RawEntry,
): { contents: FileContents; visited: number[] } {
	const diagnostics: string[] = [];
	const chunks: Uint8Array[] = [];
	// Per-entry format flags, not the disk variant, drive the walk: a DOS 1
	// file on a DOS 2 disk still has its DOS 1 chain encoding.
	const dos1 =
		(entry.flags & FLAG_IN_USE) !== 0 && (entry.flags & FLAG_DOS2) === 0;
	const fullLinks = (entry.flags & FLAG_NO_LINK) !== 0;
	const visited = new Set<number>();
	let sector = entry.startSector;
	let clean = true;
	while (sector !== 0) {
		if (visited.has(sector)) {
			diagnostics.push(`sector ${sector}: sector chain loops`);
			clean = false;
			break;
		}
		visited.add(sector);
		const data = medium.readSector(sector);
		if (data === null || data.length < 3) {
			diagnostics.push(`sector ${sector}: outside the image`);
			clean = false;
			break;
		}
		const capacity = data.length - 3;
		const hi = data[capacity] ?? 0;
		const lo = data[capacity + 1] ?? 0;
		const lengthByte = data[capacity + 2] ?? 0;
		let next: number;
		if (fullLinks) {
			// MyDOS format: the whole byte is the link high byte, no file
			// number cross-check possible.
			next = (hi << 8) | lo;
		} else {
			const fileNumber = hi >> 2;
			if (fileNumber !== entry.index) {
				diagnostics.push(
					`sector ${sector}: file number ${fileNumber} does not ` +
						`match directory slot ${entry.index}`,
				);
				clean = false;
				break;
			}
			next = ((hi & 0x03) << 8) | lo;
		}
		let dataBytes: number;
		let last = false;
		if (dos1) {
			// DOS 1.0: bit 7 of the length byte marks the last sector and its
			// low bits hold that sector's data length; full sectors hold the
			// full capacity and use the byte as a sequence cross-check.
			last = (lengthByte & 0x80) !== 0;
			dataBytes = last ? lengthByte & 0x7f : capacity;
		} else {
			dataBytes = lengthByte;
		}
		if (dataBytes > capacity) {
			diagnostics.push(
				`sector ${sector}: data length ${dataBytes} exceeds ` +
					`sector capacity ${capacity}`,
			);
			clean = false;
			dataBytes = capacity;
		}
		chunks.push(data.subarray(0, dataBytes));
		if (last) {
			break;
		}
		sector = next;
	}
	if (clean && visited.size !== entry.sectors) {
		diagnostics.push(
			`sector chain has ${visited.size} sectors, the directory ` +
				`entry says ${entry.sectors}`,
		);
	}
	let total = 0;
	for (const chunk of chunks) {
		total += chunk.length;
	}
	const bytes = new Uint8Array(total);
	let at = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, at);
		at += chunk.length;
	}
	return { contents: { bytes, diagnostics }, visited: [...visited] };
}

function decodeField(bytes: Uint8Array): string {
	let end = bytes.length;
	while (end > 0 && bytes[end - 1] === 0x20) {
		end--;
	}
	let out = "";
	for (let i = 0; i < end; i++) {
		out += String.fromCharCode(bytes[i] ?? 0);
	}
	return out.toLowerCase();
}

/**
 * Compiles a spec with native Atari DOS wildcard semantics: name and
 * extension match separately against their space-padded fields, "*" matches
 * the rest of the field (anything after it is ignored), "?" matches any
 * single character including the padding, and a spec without a "." matches
 * only an empty extension.
 */
export function compileSpec(
	spec: string,
): (name: string, ext: string) => boolean {
	const dot = spec.indexOf(".");
	const namePattern = compileField(dot === -1 ? spec : spec.slice(0, dot));
	const extPattern = compileField(dot === -1 ? "" : spec.slice(dot + 1));
	return (name, ext) =>
		namePattern.test(name.padEnd(8)) && extPattern.test(ext.padEnd(3));
}

function compileField(pattern: string): RegExp {
	let source = "^";
	for (const char of pattern) {
		if (char === "*") {
			source += ".*";
			break;
		}
		source += char === "?" ? "." : escapeRegExp(char.toLowerCase());
	}
	return new RegExp(source + " *$");
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
