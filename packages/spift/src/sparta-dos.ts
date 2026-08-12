// SpartaDOS filesystem driver, read and write. Covers the on-disk format
// shared by SpartaDOS 1.1 (revision $11), SpartaDOS 2.x-4.x and BW-DOS
// (revision $20), and SDX's SDFS 2.1 (revision $21). Layout follows the
// OneDOS notes (dos/sparta-dos-fs.md): a boot-sector parameter block, a
// free-space bitmap, and per-file sector maps chaining lists of data
// sectors; directories are files of 23-byte entries behind a 23-byte
// header.
//
// Corpus-verified facts baked in below (150 wild images, 2026-08-10):
// timestamps are binary, not BCD, with both year-minus-1900 and
// year-mod-100 conventions in the wild; subdirectories can carry an
// extension; the boot JMP signature alone over-matches badly (38 of 150
// hits were boot-only game disks), so detection validates the parameter
// block; no symbolic link has ever been sighted, so links are surfaced but
// not resolved.

import type { SectorMedium } from "./sector-medium.ts";
import type {
	DirEntry,
	DirEntryAttribute,
	DirEntryAttributes,
	FileContents,
	Filesystem,
	VolumeInfo,
} from "./filesystem.ts";
import {
	applyAtariNameTemplate,
	compileSpec,
	encodeAtariName,
	splitAtariPath,
} from "./atari-dos.ts";
import {
	SPARTA_NOT_BOOTABLE,
	SPARTA_NOT_BOOTABLE_512,
} from "./notboot-sparta-bytes.ts";

export const SPARTA_DOS_VARIANTS = ["sdfs11", "sdfs20", "sdfs21"] as const;
export type SpartaDosVariant = (typeof SPARTA_DOS_VARIANTS)[number];

export interface SpartaDosFilesystem extends Filesystem {
	readonly family: "sparta";
	readonly variant: SpartaDosVariant;
}

// Boot sector offsets, per the OneDOS notes.
const BOOT_JMP = 6;
const BOOT_MAIN_DIR = 0x09;
const BOOT_TOTAL = 0x0b;
const BOOT_FREE = 0x0d;
const BOOT_BITMAP_COUNT = 0x0f;
const BOOT_BITMAP_START = 0x10;
const BOOT_FILE_ALLOC = 0x12;
const BOOT_DIR_ALLOC = 0x14;
const BOOT_VOLUME_NAME = 0x16;
const BOOT_TRACKS = 0x1e;
const BOOT_SECTOR_SIZE = 0x1f;
const BOOT_REVISION = 0x20;
const BOOT_SEQUENCE = 0x26;
const BOOT_RANDOM = 0x27;
const BOOT_DOS_MAP = 0x28;
const BOOT_LOCK = 0x2a;

const FLAG_PROTECTED = 0x01;
const FLAG_HIDDEN = 0x02;
const FLAG_ARCHIVED = 0x04;
const FLAG_IN_USE = 0x08;
const FLAG_DELETED = 0x10;
const FLAG_DIRECTORY = 0x20;
const FLAG_SYMLINK = 0x40;
const FLAG_OPEN = 0x80;

const ENTRY_SIZE = 23;
// Sector maps: next pointer, previous pointer, then two-byte data sector
// numbers to the end of the sector.
const MAP_HEADER = 4;

const REVISION_OF: Record<number, SpartaDosVariant> = {
	// A no-DOS SpartaDOS 1.1 format writes a zero revision byte over an
	// otherwise modern front-bitmap layout (measured: SD 1.1 FORMAT with
	// "Write SpartaDOS? N"), so it reads exactly as a 2.0 disk. Safe to
	// accept: across 19,589 corpus images the only other rev-$00 boot
	// signature fails the parameter-block validation below.
	0x00: "sdfs20",
	0x11: "sdfs11",
	0x20: "sdfs20",
	0x21: "sdfs21",
};

const VARIANT_LABELS: Record<SpartaDosVariant, string> = {
	sdfs11: "SpartaDOS 1.1",
	sdfs20: "SpartaDOS 2.0",
	sdfs21: "SDFS 2.1",
};

/** How a variant is named to a reader. */
export function spartaDosLabel(variant: SpartaDosVariant): string {
	return VARIANT_LABELS[variant];
}

/** The $1F sector size code: $80 is 128, $00 is 256, $01 is 512. */
function sectorSizeOfCode(code: number): number | undefined {
	if (code === 0x80) {
		return 128;
	}
	return code === 0x00 ? 256 : code === 0x01 ? 512 : undefined;
}

interface SpartaParams {
	variant: SpartaDosVariant;
	mainDirMap: number;
	totalSectors: number;
	freeSectors: number;
	bitmapCount: number;
	bitmapStart: number;
	fileAlloc: number;
	dirAlloc: number;
	volumeName: Uint8Array;
	sequence: number;
	random: number;
	/** First map of the boot-loaded DOS file, 0 when none is set. */
	dosMap: number;
	locked: boolean;
}

function readParams(medium: SectorMedium): SpartaParams | undefined {
	const boot = medium.readSector(1);
	if (boot === null || boot.length < 0x2b) {
		return undefined;
	}
	// JMP $xx80 at offset 6 ($30xx for SpartaDOS, $08xx for BW-DOS; only the
	// low byte is stable across builds), or JMP $0440 for 512-byte-sector
	// images.
	const signature =
		boot[BOOT_JMP] === 0x4c &&
		(boot[BOOT_JMP + 1] === 0x80 ||
			(boot[BOOT_JMP + 1] === 0x40 && boot[BOOT_JMP + 2] === 0x04));
	if (!signature) {
		return undefined;
	}
	const variant = REVISION_OF[boot[BOOT_REVISION] ?? 0];
	if (variant === undefined) {
		return undefined;
	}
	// Boot-only game disks reuse the Sparta boot loader over garbage
	// parameter bytes; requiring the declared sector size to match the
	// medium and the layout fields to make basic sense filters them out
	// while keeping truncated but genuine images readable.
	if (sectorSizeOfCode(boot[BOOT_SECTOR_SIZE] ?? -1) !== medium.sectorSize) {
		return undefined;
	}
	const word = (at: number): number =>
		(boot[at] ?? 0) | ((boot[at + 1] ?? 0) << 8);
	const params: SpartaParams = {
		variant,
		mainDirMap: word(BOOT_MAIN_DIR),
		totalSectors: word(BOOT_TOTAL),
		freeSectors: word(BOOT_FREE),
		bitmapCount: boot[BOOT_BITMAP_COUNT] ?? 0,
		bitmapStart: word(BOOT_BITMAP_START),
		fileAlloc: word(BOOT_FILE_ALLOC),
		dirAlloc: word(BOOT_DIR_ALLOC),
		volumeName: boot.slice(BOOT_VOLUME_NAME, BOOT_VOLUME_NAME + 8),
		sequence: boot[BOOT_SEQUENCE] ?? 0,
		random: boot[BOOT_RANDOM] ?? 0,
		dosMap: word(BOOT_DOS_MAP),
		locked: variant === "sdfs20" && boot[BOOT_LOCK] === 0xff,
	};
	if (
		params.totalSectors < 8 ||
		params.mainDirMap < 2 ||
		params.mainDirMap > params.totalSectors ||
		params.bitmapCount < 1 ||
		params.bitmapStart < 2 ||
		params.bitmapStart > params.totalSectors
	) {
		return undefined;
	}
	return params;
}

/**
 * Detects a SpartaDOS filesystem and its revision, or undefined when the
 * boot sector does not carry a consistent one.
 */
export function detectSpartaDos(
	medium: SectorMedium,
): SpartaDosVariant | undefined {
	return readParams(medium)?.variant;
}

/**
 * The first sector map of the file the disk boots - the "DOS file" - or 0
 * when none is set. SpartaDOS 1.1 has no such pointer: its boot code loads
 * a CONTIGUOUS run of sectors starting at sector 4, counted by boot byte
 * $25, and uses $28-$29 for its own data (measured: 6433 there on the
 * distribution disks) - so 1.1 always reads as 0 here.
 */
export function readSpartaDosFilePointer(medium: SectorMedium): number {
	const params = readParams(medium);
	if (params === undefined || params.variant === "sdfs11") {
		return 0;
	}
	return params.dosMap <= params.totalSectors ? params.dosMap : 0;
}

/**
 * Points the boot record at a file's first sector map, which is what the
 * BOOT command and XINIT set. Sector 0 clears it.
 */
export function writeSpartaDosFilePointer(
	medium: SectorMedium,
	sector: number,
): void {
	const writeSector = medium.writeSector?.bind(medium);
	if (writeSector === undefined) {
		throw new Error("the medium is read-only");
	}
	// On SpartaDOS 1.1 the bytes at $28-$29 belong to the boot code, and
	// writing them bricks the disk (measured - the boot hangs two sector
	// reads in). Its DOS lives as contiguous sectors from sector 4 instead,
	// which only XINIT rewrites.
	if (readParams(medium)?.variant === "sdfs11") {
		throw new Error(
			"SpartaDOS 1.1 has no DOS-file pointer: its boot code loads " +
				"sectors 4 onward directly (boot byte $25 counts them), and " +
				"$28-$29 hold boot-code data that must not be overwritten",
		);
	}
	const boot = medium.readSector(1);
	if (boot === null || boot.length < 0x2b) {
		throw new Error("the boot sector is outside the image");
	}
	boot[BOOT_DOS_MAP] = sector & 0xff;
	boot[BOOT_DOS_MAP + 1] = (sector >> 8) & 0xff;
	if (!writeSector(1, boot)) {
		throw new Error("boot sector write failed");
	}
}

interface RawEntry {
	/** Byte offset of the entry within the directory's contents. */
	offset: number;
	flags: number;
	name: string;
	ext: string;
	length: number;
	firstMap: number;
	isDir: boolean;
	isLink: boolean;
	displayName: string;
	timestamp: Date | undefined;
}

/**
 * A file's sector geography: its map chain and the data sectors those maps
 * list, in file order. A zero data sector is a sparse stretch (POINT can
 * make them) and reads as zeros.
 */
interface MappedFile {
	maps: number[];
	data: number[];
	diagnostics: string[];
}

/**
 * Decodes an on-disk timestamp. Binary throughout (corpus-verified; BCD
 * would never produce the $5F-style year bytes the wild is full of). Years
 * appear both as year-1900 (101 for 2001) and year-mod-100 (8 for 2008);
 * anything below 80 reads as 20xx, the rest as 1900+y, which decodes both
 * conventions. A field out of range means no usable timestamp.
 */
function decodeTimestamp(bytes: Uint8Array, at: number): Date | undefined {
	const day = bytes[at] ?? 0;
	const month = bytes[at + 1] ?? 0;
	const year = bytes[at + 2] ?? 0;
	const hour = bytes[at + 3] ?? 0;
	const minute = bytes[at + 4] ?? 0;
	const second = bytes[at + 5] ?? 0;
	if (
		day < 1 ||
		day > 31 ||
		month < 1 ||
		month > 12 ||
		hour > 23 ||
		minute > 59 ||
		second > 59
	) {
		return undefined;
	}
	const fullYear = year < 80 ? 2000 + year : 1900 + year;
	const date = new Date(fullYear, month - 1, day, hour, minute, second);
	// The Date constructor rolls an impossible-but-in-range date over
	// (February 30th becomes March), which would present a plausible wrong
	// date; a date that does not survive the round trip is as invalid as an
	// out-of-range field.
	if (date.getDate() !== day) {
		return undefined;
	}
	return date;
}

/** Encodes a timestamp the way modern SDX does: two-digit years. */
function encodeTimestamp(entry: Uint8Array, at: number, when?: Date): void {
	if (when === undefined) {
		entry.fill(0, at, at + 6);
		return;
	}
	entry[at] = when.getDate();
	entry[at + 1] = when.getMonth() + 1;
	entry[at + 2] = when.getFullYear() % 100;
	entry[at + 3] = when.getHours();
	entry[at + 4] = when.getMinutes();
	entry[at + 5] = when.getSeconds();
}

export interface OpenSpartaDosOptions {
	/**
	 * Where writeFile and friends get their timestamps. Defaults to the
	 * wall clock; tests inject a fixed one.
	 */
	clock?: () => Date;
}

/**
 * Opens a SpartaDOS filesystem on a medium. The variant is detected when
 * not given; forcing one reads a disk whose boot sector is damaged too
 * badly to detect.
 */
export function openSpartaDos(
	medium: SectorMedium,
	variant?: SpartaDosVariant,
	options?: OpenSpartaDosOptions,
): SpartaDosFilesystem {
	const params = readParams(medium);
	const resolved = variant ?? params?.variant ?? "sdfs20";
	const clock = options?.clock ?? ((): Date => new Date());
	// The sequence number identifies "the disk changed"; one bump per opened
	// driver marks the whole session as one change, which is all the guests'
	// cache invalidation needs.
	let sequenceBumped = false;

	function requireParams(): SpartaParams {
		if (params === undefined) {
			throw new Error("the boot sector holds no SpartaDOS parameter block");
		}
		return params;
	}

	/** Highest sector number the filesystem may touch. */
	function highestSector(): number {
		return Math.min(requireParams().totalSectors, medium.sectorCount);
	}

	function walkMap(firstMap: number): MappedFile {
		const diagnostics: string[] = [];
		const maps: number[] = [];
		const data: number[] = [];
		const seen = new Set<number>();
		let map = firstMap;
		let previous = 0;
		while (map !== 0) {
			if (seen.has(map)) {
				diagnostics.push(`sector map ${map}: map chain loops`);
				break;
			}
			seen.add(map);
			const sector = medium.readSector(map);
			if (sector === null) {
				diagnostics.push(`sector map ${map}: outside the image`);
				break;
			}
			maps.push(map);
			const prev = (sector[2] ?? 0) | ((sector[3] ?? 0) << 8);
			if (prev !== previous) {
				diagnostics.push(
					`sector map ${map}: points back at ${prev}, ` +
						`expected ${previous}`,
				);
			}
			for (let at = MAP_HEADER; at + 1 < sector.length; at += 2) {
				data.push((sector[at] ?? 0) | ((sector[at + 1] ?? 0) << 8));
			}
			previous = map;
			map = (sector[0] ?? 0) | ((sector[1] ?? 0) << 8);
		}
		return { maps, data, diagnostics };
	}

	/** Reads `length` bytes of a mapped file; sparse stretches are zeros. */
	function readMapped(mapped: MappedFile, length: number): FileContents {
		const diagnostics = [...mapped.diagnostics];
		const bytes = new Uint8Array(length);
		const capacity = mapped.data.length * medium.sectorSize;
		let end = length;
		if (capacity < length) {
			diagnostics.push(
				`the sector maps cover ${capacity} bytes of a ` +
					`${length}-byte file; the rest is missing`,
			);
			end = capacity;
		}
		for (let at = 0; at < end; at += medium.sectorSize) {
			const index = Math.floor(at / medium.sectorSize);
			const number = mapped.data[index] ?? 0;
			if (number === 0) {
				continue; // sparse - reads as zeros
			}
			const sector = medium.readSector(number);
			if (sector === null) {
				diagnostics.push(`data sector ${number}: outside the image`);
				continue;
			}
			bytes.set(sector.subarray(0, Math.min(sector.length, end - at)), at);
		}
		return { bytes: bytes.subarray(0, end), diagnostics };
	}

	/**
	 * A directory, loaded whole for scanning and editing. Entries are a
	 * plain byte stream - 23 does not divide any sector size, so entries
	 * straddle sector boundaries and edits write back every touched sector.
	 */
	interface LoadedDirectory {
		firstMap: number;
		mapped: MappedFile;
		bytes: Uint8Array;
		length: number;
		diagnostics: string[];
	}

	function loadDirectory(firstMap: number): LoadedDirectory {
		const mapped = walkMap(firstMap);
		const head = readMapped(mapped, ENTRY_SIZE);
		const length =
			(head.bytes[3] ?? 0) |
			((head.bytes[4] ?? 0) << 8) |
			((head.bytes[5] ?? 0) << 16);
		const capacity = mapped.data.length * medium.sectorSize;
		const diagnostics = [...head.diagnostics];
		let usable = length;
		if (length < ENTRY_SIZE) {
			diagnostics.push(
				`the directory claims ${length} bytes, too short for its ` +
					`own header`,
			);
			usable = ENTRY_SIZE;
		}
		if (length > capacity) {
			diagnostics.push(
				`the directory claims ${length} bytes but its maps cover ` +
					`${capacity}`,
			);
			usable = capacity;
		}
		const contents = readMapped(mapped, usable);
		// A map sector lists every slot to its end, zeros after the last
		// allocated sector. Those tail zeros are not the directory's - the
		// growth arithmetic (where the next data sector goes, when a new map
		// is needed) counts allocated sectors, so trim to what the length
		// actually occupies.
		mapped.data.length = Math.ceil(usable / medium.sectorSize);
		return {
			firstMap,
			mapped,
			bytes: contents.bytes,
			length: usable,
			diagnostics: [...diagnostics, ...contents.diagnostics],
		};
	}

	function rawEntryAt(directory: LoadedDirectory, offset: number): RawEntry {
		const bytes = directory.bytes;
		const flags = bytes[offset] ?? 0;
		const name = decodeField(bytes.subarray(offset + 6, offset + 14));
		const ext = decodeField(bytes.subarray(offset + 14, offset + 17));
		return {
			offset,
			flags,
			name,
			ext,
			length:
				(bytes[offset + 3] ?? 0) |
				((bytes[offset + 4] ?? 0) << 8) |
				((bytes[offset + 5] ?? 0) << 16),
			firstMap: (bytes[offset + 1] ?? 0) | ((bytes[offset + 2] ?? 0) << 8),
			isDir: (flags & FLAG_DIRECTORY) !== 0,
			isLink: (flags & FLAG_SYMLINK) !== 0,
			displayName: ext === "" ? name : `${name}.${ext}`,
			timestamp: decodeTimestamp(bytes, offset + 17),
		};
	}

	// Yields every slot of a directory holding anything, deleted ones
	// included, stopping at the first never-used slot (flags byte zero) the
	// way the DOS's own scan does. Callers decide what to show.
	function* scanDirectory(
		directory: LoadedDirectory,
	): IterableIterator<RawEntry> {
		for (
			let offset = ENTRY_SIZE;
			offset + ENTRY_SIZE <= directory.length;
			offset += ENTRY_SIZE
		) {
			if ((directory.bytes[offset] ?? 0) === 0) {
				return;
			}
			yield rawEntryAt(directory, offset);
		}
	}

	// What a directory listing shows. Hidden files are deliberately NOT
	// passed over (see the attribute's note in filesystem.ts); files left
	// open for write and deleted ones are, as everywhere else.
	function listable(raw: RawEntry): boolean {
		if ((raw.flags & (FLAG_DELETED | FLAG_OPEN)) !== 0) {
			return false;
		}
		return (raw.flags & FLAG_IN_USE) !== 0;
	}

	function lookup(
		directory: LoadedDirectory,
		name: string,
	): RawEntry | undefined {
		for (const raw of scanDirectory(directory)) {
			if (listable(raw) && raw.displayName === name) {
				return raw;
			}
		}
		return undefined;
	}

	/**
	 * Resolves a path to its directory, loaded. Throws when a component is
	 * missing or not a directory; a visited set catches a corrupt disk
	 * whose subdirectory points back up its own path.
	 */
	function resolveDirectory(components: readonly string[]): LoadedDirectory {
		let directory = loadDirectory(requireParams().mainDirMap);
		const visited = new Set<number>([directory.firstMap]);
		const walked: string[] = [];
		for (const component of components) {
			const wanted = component.toLowerCase();
			const found = lookup(directory, wanted);
			const where = walked.length === 0 ? "the root" : walked.join("/");
			if (found === undefined) {
				throw new Error(`${wanted} does not exist in ${where}`);
			}
			if (!found.isDir) {
				throw new Error(`${wanted} in ${where} is a file, not a directory`);
			}
			if (visited.has(found.firstMap)) {
				throw new Error(
					`${wanted} points back at a directory already on the path ` +
						`(sector map ${found.firstMap}); the disk is damaged`,
				);
			}
			visited.add(found.firstMap);
			directory = loadDirectory(found.firstMap);
			walked.push(wanted);
		}
		return directory;
	}

	/**
	 * A directory's true byte length, from its own header. The parent
	 * entry's length field is dead weight - no DOS maintains it (the corpus
	 * shows creation-time values and zeros) - so a listing reads the header.
	 */
	function directoryLength(raw: RawEntry): number {
		const head = readMapped(walkMap(raw.firstMap), ENTRY_SIZE).bytes;
		if (head.length < ENTRY_SIZE) {
			return raw.length;
		}
		return (head[3] ?? 0) | ((head[4] ?? 0) << 8) | ((head[5] ?? 0) << 16);
	}

	function attributesOf(raw: RawEntry, dosMap: number): DirEntryAttribute[] {
		const attributes: DirEntryAttribute[] = [];
		if ((raw.flags & FLAG_DELETED) !== 0) {
			attributes.push("Deleted");
		}
		if ((raw.flags & FLAG_PROTECTED) !== 0) {
			attributes.push("ReadOnly");
		}
		if ((raw.flags & FLAG_HIDDEN) !== 0) {
			attributes.push("Hidden");
		}
		if ((raw.flags & FLAG_ARCHIVED) !== 0) {
			attributes.push("Archived");
		}
		if (raw.isLink) {
			attributes.push("Symlink");
		}
		if ((raw.flags & FLAG_OPEN) !== 0) {
			attributes.push("OpenForOutput");
		}
		if (
			!raw.isDir &&
			dosMap !== 0 &&
			dosMap <= medium.sectorCount &&
			raw.firstMap === dosMap
		) {
			attributes.push("BootFile");
		}
		return attributes;
	}

	return {
		family: "sparta",
		variant: resolved,
		// Same separators as the Atari DOS family: ">" and ":" are the
		// DOSes' own, "<" (SpartaDOS's step-up) desugars inside
		// splitAtariPath and is not a plain separator.
		pathSeparators: "/>:",
		// The directory entry's flag byte is the same at every revision, so
		// every flag bit rides along the way one does on Atari DOS: an older
		// DOS ignores what it does not know, exactly as plain DOS 2.0 passes
		// over a MyDOS subdirectory, and a newer reader honours it. So hidden,
		// archived, and the symlink bit all carry to any SpartaDOS disk - a
		// link keeps its bit across a copy (only SDFS 2.1 follows one, but the
		// bit is harmless elsewhere and lossless where it is meant to work,
		// which is also how chattr stands in for SDX's FIXLINK).
		writableAttributes: ["ReadOnly", "Hidden", "Archived", "Symlink"],
		textEncoding: "atascii",
		splitPath: splitAtariPath,
		applyNameTemplate: applyAtariNameTemplate,
		volume(): VolumeInfo {
			const p = requireParams();
			const details: string[] = [];
			if (p.locked) {
				details.push("write-protected");
			}
			const label = decodeField(p.volumeName);
			return {
				totalSectors: p.totalSectors,
				freeSectors: p.freeSectors,
				...(label === "" ? {} : { label }),
				details,
			};
		},
		*entries(
			spec?: string,
			options?: {
				includeUnlisted?: boolean;
				recursive?: boolean;
				listContents?: boolean;
			},
		): IterableIterator<DirEntry> {
			const parts = spec === undefined ? [] : splitAtariPath(spec);
			let pattern =
				spec === undefined || parts.length === 0
					? undefined
					: (parts.pop() as string);
			// A spec that names a directory outright lists that directory;
			// callers that mean the directory itself turn this off.
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
			const dosMap = params?.dosMap ?? 0;

			function* walk(
				directory: LoadedDirectory,
				prefix: string,
				visited: ReadonlySet<number>,
			): IterableIterator<DirEntry> {
				for (const raw of scanDirectory(directory)) {
					const shown = listable(raw);
					if (!shown && options?.includeUnlisted !== true) {
						continue;
					}
					const path =
						prefix === "" ? raw.displayName : `${prefix}/${raw.displayName}`;
					if (matches === undefined || matches(raw.name, raw.ext)) {
						yield {
							name: raw.displayName,
							path,
							kind: raw.isDir ? "dir" : "file",
							size: raw.isDir ? directoryLength(raw) : raw.length,
							startSector: raw.firstMap,
							...(raw.timestamp === undefined
								? {}
								: { timestamp: raw.timestamp }),
							attributes: attributesOf(raw, dosMap),
						};
					}
					if (
						options?.recursive === true &&
						raw.isDir &&
						shown &&
						!visited.has(raw.firstMap)
					) {
						yield* walk(
							loadDirectory(raw.firstMap),
							path,
							new Set(visited).add(raw.firstMap),
						);
					}
				}
			}

			yield* walk(start, parts.join("/"), new Set([start.firstMap]));
		},
		readFile(path: string): FileContents | null {
			const parts = splitAtariPath(path);
			const leaf = parts.pop();
			if (leaf === undefined) {
				return null;
			}
			const directory = resolveDirectory(parts);
			for (const raw of scanDirectory(directory)) {
				if (listable(raw) && !raw.isDir && raw.displayName === leaf) {
					const contents = readMapped(walkMap(raw.firstMap), raw.length);
					if (raw.isLink) {
						// The payload is the target path in ATASCII, EOL-ended,
						// 64 bytes at most (SDX Toolkit, SYMLINK.MAN). Handed
						// back raw, with the target named for a human reader.
						contents.diagnostics.push(
							`${leaf} is a symbolic link to ` +
								`${decodeLinkTarget(contents.bytes)}; this is its ` +
								`raw payload`,
						);
					}
					return contents;
				}
			}
			return null;
		},
		writeFile(
			path: string,
			bytes: Uint8Array,
			options?: {
				overwrite?: boolean;
				attributes?: DirEntryAttributes;
				timestamp?: Date;
			},
		): string[] {
			return mutate((session) =>
				writeSpartaFile(session, path, bytes, options),
			);
		},
		removeFile(path: string, options?: { force?: boolean }): string[] {
			return mutate((session) =>
				removeSpartaFile(session, path, options?.force === true),
			);
		},
		setAttributes(path: string, attributes: DirEntryAttributes): string[] {
			return mutate((session) =>
				setSpartaAttributes(session, path, attributes),
			);
		},
		moveFile(
			from: string,
			to: string,
			options?: { force?: boolean },
		): string[] {
			return mutate((session) =>
				moveSpartaFile(session, from, to, options?.force === true),
			);
		},
		makeDirectory(
			path: string,
			options?: { parents?: boolean; timestamp?: Date },
		): void {
			mutate((session) => {
				const parts = splitAtariPath(path);
				const leaf = parts.pop();
				if (leaf === undefined) {
					throw new Error("no directory name given");
				}
				if (options?.parents !== true) {
					makeSpartaDirectory(
						session,
						resolveDirectory(parts),
						leaf,
						options?.timestamp,
					);
					return [];
				}
				let directory = resolveDirectory([]);
				for (const component of [...parts, leaf]) {
					const existing = lookup(directory, component);
					if (existing?.isDir === true) {
						directory = loadDirectory(existing.firstMap);
						continue;
					}
					if (existing !== undefined) {
						throw new Error(`${component} is a file, not a directory`);
					}
					makeSpartaDirectory(
						session,
						directory,
						component,
						options?.timestamp,
					);
					const made = lookup(loadDirectory(directory.firstMap), component);
					directory = loadDirectory(made?.firstMap ?? directory.firstMap);
				}
				return [];
			});
		},
		removeDirectory(path: string): void {
			mutate((session) => {
				const parts = splitAtariPath(path);
				const leaf = parts.pop();
				if (leaf === undefined) {
					throw new Error("the main directory cannot be removed");
				}
				const parent = resolveDirectory(parts);
				const found = lookup(parent, leaf);
				if (found === undefined) {
					throw new Error(`${leaf} does not exist`);
				}
				if (!found.isDir) {
					throw new Error(`${leaf} is a file, not a directory`);
				}
				const inside = loadDirectory(found.firstMap);
				for (const raw of scanDirectory(inside)) {
					if (listable(raw)) {
						throw new Error(`${leaf} is not empty`);
					}
				}
				const mapped = walkMap(found.firstMap);
				for (const sector of [...mapped.maps, ...mapped.data]) {
					session.free(sector, "dir");
				}
				session.patchEntry(parent, found.offset, (entry) => {
					entry[0] = ((entry[0] ?? 0) & ~FLAG_IN_USE) | FLAG_DELETED;
				});
				return mapped.diagnostics;
			});
		},
	};

	// ------------------------------------------------------------------
	// Write side. Every mutating call runs inside mutate(), which loads the
	// bitmap, applies the operation, and flushes the bitmap and the boot
	// accounting (free count, allocation hints, sequence bump) in one go.
	// Allocation policy per the primary-source rule: the two start words in
	// the boot sector drive everything - scan the bitmap from the word,
	// wrap at the top, and leave the word pointing at the last sector taken
	// (observed to advance on wild disks; exact advancement is provisional
	// until the differential tests against real DOSes pin it down).
	// ------------------------------------------------------------------

	interface Session {
		allocateFile(): number;
		allocateDir(): number;
		/**
		 * Frees a sector and lowers the matching allocation hint down to it,
		 * as SDX does - a freed sector is the next best place to look.
		 * `kind` says which hint; file data is the default, directory
		 * sectors say so.
		 */
		free(sector: number, kind?: "file" | "dir"): void;
		writeSector(sector: number, data: Uint8Array): void;
		patchEntry(
			directory: LoadedDirectory,
			offset: number,
			change: (entry: Uint8Array) => void,
		): void;
		/**
		 * Appends a fresh entry to a directory, growing its data (and map)
		 * when the last sector is full, and returns its offset. The caller
		 * fills it via patchEntry.
		 */
		appendEntry(directory: LoadedDirectory): number;
		/**
		 * Sets a directory's byte length in its header, the one place it is
		 * authoritative. The parent directory's entry also has a length
		 * field, but no DOS maintains it for subdirectories - measured
		 * across the corpus, SDX leaves it at the creation-time 23 and
		 * SpartaDOS 3.x/BW-DOS leave it 0 - so neither does this.
		 */
		setDirectoryLength(directory: LoadedDirectory, length: number): void;
		now(): Date;
	}

	function mutate<T>(operation: (session: Session) => T): T {
		const write = medium.writeSector?.bind(medium);
		if (write === undefined) {
			throw new Error("the medium is read-only");
		}
		const p = requireParams();
		if (p.locked) {
			throw new Error("the volume is write-protected (its lock flag is set)");
		}
		const top = highestSector();
		const bitsPerPage = medium.sectorSize * 8;
		const pages: (Uint8Array | null)[] = [];
		for (let page = 0; page < p.bitmapCount; page++) {
			pages.push(medium.readSector(p.bitmapStart + page));
		}
		const touched = new Set<number>();
		let freeDelta = 0;
		let fileAlloc = p.fileAlloc;
		let dirAlloc = p.dirAlloc;

		const place = (
			sector: number,
		): [page: Uint8Array, at: number, mask: number] | null => {
			const page = pages[Math.floor(sector / bitsPerPage)];
			if (page === undefined || page === null) {
				return null;
			}
			const bit = sector % bitsPerPage;
			return [page, bit >> 3, 0x80 >> (bit & 7)];
		};
		const isFree = (sector: number): boolean => {
			if (sector < 1 || sector > top) {
				return false;
			}
			const at = place(sector);
			return at !== null && ((at[0][at[1]] ?? 0) & at[2]) !== 0;
		};
		const mark = (sector: number, free: boolean): void => {
			const at = place(sector);
			if (at === null || isFree(sector) === free) {
				return;
			}
			at[0][at[1]] = (at[0][at[1]] ?? 0) ^ at[2];
			touched.add(Math.floor(sector / bitsPerPage));
			freeDelta += free ? 1 : -1;
		};
		const allocateFrom = (start: number): number => {
			for (let step = 0; step <= top; step++) {
				const sector = ((start - 1 + step) % top) + 1;
				if (isFree(sector)) {
					mark(sector, false);
					return sector;
				}
			}
			throw new Error("the disk is full");
		};

		const session: Session = {
			allocateFile(): number {
				fileAlloc = allocateFrom(Math.max(1, Math.min(fileAlloc, top)));
				return fileAlloc;
			},
			allocateDir(): number {
				dirAlloc = allocateFrom(Math.max(1, Math.min(dirAlloc, top)));
				return dirAlloc;
			},
			free(sector: number, kind: "file" | "dir" = "file"): void {
				// Zero entries in a sector map are sparse stretches, not
				// sectors, and a corrupt map can name sectors off the disk;
				// neither is anything to free.
				if (sector < 1 || sector > top) {
					return;
				}
				mark(sector, true);
				// Measured on SDX 4.50: DEL and DELDIR lower their hint to
				// the freed sector, so the space is found again promptly.
				if (kind === "dir") {
					dirAlloc = Math.min(dirAlloc, sector);
				} else {
					fileAlloc = Math.min(fileAlloc, sector);
				}
			},
			writeSector(sector: number, data: Uint8Array): void {
				const full = new Uint8Array(
					medium.readSector(sector)?.length ?? medium.sectorSize,
				);
				full.set(data.subarray(0, full.length));
				if (!write(sector, full)) {
					throw new Error(`sector ${sector}: write failed`);
				}
			},
			patchEntry(directory, offset, change): void {
				const entry = directory.bytes.subarray(offset, offset + ENTRY_SIZE);
				change(entry);
				flushRange(directory, offset, offset + ENTRY_SIZE);
			},
			appendEntry(directory): number {
				const offset = directory.length;
				const needed = offset + ENTRY_SIZE;
				let capacity = directory.mapped.data.length * medium.sectorSize;
				if (needed > capacity) {
					const sector = session.allocateDir();
					session.writeSector(sector, new Uint8Array(medium.sectorSize));
					appendToMap(directory.mapped, sector);
					capacity += medium.sectorSize;
					const grown = new Uint8Array(capacity);
					grown.set(directory.bytes);
					directory.bytes = grown;
				} else if (directory.bytes.length < needed) {
					const grown = new Uint8Array(capacity);
					grown.set(directory.bytes);
					directory.bytes = grown;
				}
				session.setDirectoryLength(directory, needed);
				return offset;
			},
			setDirectoryLength(directory, length): void {
				directory.length = length;
				directory.bytes[3] = length & 0xff;
				directory.bytes[4] = (length >> 8) & 0xff;
				directory.bytes[5] = (length >> 16) & 0xff;
				flushRange(directory, 3, 6);
			},
			now: clock,
		};

		/** Writes the data sectors covering [from, to) back to the medium. */
		function flushRange(
			directory: LoadedDirectory,
			from: number,
			to: number,
		): void {
			const size = medium.sectorSize;
			for (let index = Math.floor(from / size); index * size < to; index++) {
				const sector = directory.mapped.data[index] ?? 0;
				if (sector === 0) {
					throw new Error(
						"the directory has a sparse stretch; the disk is damaged",
					);
				}
				session.writeSector(
					sector,
					directory.bytes.subarray(index * size, (index + 1) * size),
				);
			}
		}

		/** Grows a file's map chain by one data sector number. */
		function appendToMap(mapped: MappedFile, sector: number): void {
			const perMap = Math.floor((medium.sectorSize - MAP_HEADER) / 2);
			const used = mapped.data.length;
			const last = mapped.maps[mapped.maps.length - 1];
			if (last === undefined) {
				throw new Error("the file has no sector map to grow");
			}
			if (used % perMap === 0 && used > 0) {
				// The last map is full; chain a new one.
				const grown = session.allocateDir();
				const fresh = new Uint8Array(medium.sectorSize);
				fresh[2] = last & 0xff;
				fresh[3] = (last >> 8) & 0xff;
				fresh[MAP_HEADER] = sector & 0xff;
				fresh[MAP_HEADER + 1] = (sector >> 8) & 0xff;
				session.writeSector(grown, fresh);
				const previous = medium.readSector(last);
				if (previous === null) {
					throw new Error(`sector map ${last}: outside the image`);
				}
				previous[0] = grown & 0xff;
				previous[1] = (grown >> 8) & 0xff;
				session.writeSector(last, previous);
				mapped.maps.push(grown);
			} else {
				const data = medium.readSector(last);
				if (data === null) {
					throw new Error(`sector map ${last}: outside the image`);
				}
				const at = MAP_HEADER + (used % perMap) * 2;
				data[at] = sector & 0xff;
				data[at + 1] = (sector >> 8) & 0xff;
				session.writeSector(last, data);
			}
			mapped.data.push(sector);
		}

		const result = operation(session);

		// Flush the accounting: touched bitmap pages, then the boot sector's
		// free count, allocation hints, and sequence number. The volume
		// random number identifies the format and never changes here.
		for (const index of touched) {
			const page = pages[index];
			if (page === null || page === undefined) {
				throw new Error(
					`bitmap sector ${p.bitmapStart + index}: outside the image`,
				);
			}
			if (!write(p.bitmapStart + index, page)) {
				throw new Error(`bitmap sector ${p.bitmapStart + index}: write failed`);
			}
		}
		const boot = medium.readSector(1);
		if (boot === null) {
			throw new Error("the boot sector vanished mid-write");
		}
		const putWord = (at: number, value: number): void => {
			boot[at] = value & 0xff;
			boot[at + 1] = (value >> 8) & 0xff;
		};
		p.freeSectors += freeDelta;
		putWord(BOOT_FREE, p.freeSectors);
		putWord(BOOT_FILE_ALLOC, fileAlloc);
		putWord(BOOT_DIR_ALLOC, dirAlloc);
		p.fileAlloc = fileAlloc;
		p.dirAlloc = dirAlloc;
		// One bump per opened driver, on the first mutation: enough to tell
		// the guests' disk-change detection that this session changed the
		// volume. (SDX itself bumps per open-for-write; replicating that
		// buys nothing host-side.) SpartaDOS 1.1 predates the volume
		// identity bytes - it has no sequence or random number and
		// identifies volumes by name alone - so on its disks the two
		// locations are left exactly as found.
		if (resolved !== "sdfs11" && !sequenceBumped) {
			sequenceBumped = true;
			p.sequence = (p.sequence + 1) & 0xff;
			boot[BOOT_SEQUENCE] = p.sequence;
		}
		if (!write(1, boot)) {
			throw new Error("boot sector write failed");
		}
		return result;
	}

	function findSlot(directory: LoadedDirectory, session: Session): number {
		// Deleted slots are reused first, as the DOS itself does; a directory
		// only grows when none is free.
		for (
			let offset = ENTRY_SIZE;
			offset + ENTRY_SIZE <= directory.length;
			offset += ENTRY_SIZE
		) {
			const flags = directory.bytes[offset] ?? 0;
			if (flags === 0 || (flags & FLAG_DELETED) !== 0) {
				return offset;
			}
		}
		return session.appendEntry(directory);
	}

	function writeSpartaFile(
		session: Session,
		path: string,
		bytes: Uint8Array,
		options?: {
			overwrite?: boolean;
			attributes?: DirEntryAttributes;
			timestamp?: Date;
		},
	): string[] {
		const parts = splitAtariPath(path);
		const leaf = parts.pop();
		if (leaf === undefined) {
			throw new Error("no file name given");
		}
		const native = encodeAtariName(leaf);
		const directory = resolveDirectory(parts);
		const diagnostics: string[] = [];

		const existing = lookup(directory, leaf);
		if (existing !== undefined) {
			if (existing.isDir) {
				throw new Error(`${leaf} is a directory`);
			}
			if (options?.overwrite !== true) {
				throw new Error(`${leaf} already exists`);
			}
			if ((existing.flags & FLAG_PROTECTED) !== 0) {
				throw new Error(`${leaf} is protected`);
			}
			const mapped = walkMap(existing.firstMap);
			diagnostics.push(...mapped.diagnostics);
			for (const sector of [...mapped.maps, ...mapped.data]) {
				session.free(sector);
			}
			session.patchEntry(directory, existing.offset, (entry) => {
				entry[0] = ((entry[0] ?? 0) & ~FLAG_IN_USE) | FLAG_DELETED;
			});
		}

		// First the map, then the data, appending further maps as they fill -
		// the order an incremental writer produces, and why a freshly
		// installed DOS file's map lands at the allocation start.
		const perMap = Math.floor((medium.sectorSize - MAP_HEADER) / 2);
		const dataCount = Math.ceil(bytes.length / medium.sectorSize);
		const maps: number[] = [session.allocateFile()];
		const data: number[] = [];
		for (let index = 0; index < dataCount; index++) {
			if (index > 0 && index % perMap === 0) {
				maps.push(session.allocateFile());
			}
			data.push(session.allocateFile());
		}
		for (let index = 0; index < data.length; index++) {
			const chunk = new Uint8Array(medium.sectorSize);
			chunk.set(
				bytes.subarray(
					index * medium.sectorSize,
					Math.min((index + 1) * medium.sectorSize, bytes.length),
				),
			);
			session.writeSector(data[index] as number, chunk);
		}
		maps.forEach((map, index) => {
			const sector = new Uint8Array(medium.sectorSize);
			const next = maps[index + 1] ?? 0;
			const prev = index === 0 ? 0 : (maps[index - 1] as number);
			sector[0] = next & 0xff;
			sector[1] = (next >> 8) & 0xff;
			sector[2] = prev & 0xff;
			sector[3] = (prev >> 8) & 0xff;
			for (
				let entry = 0;
				entry < perMap && index * perMap + entry < data.length;
				entry++
			) {
				const number = data[index * perMap + entry] as number;
				sector[MAP_HEADER + entry * 2] = number & 0xff;
				sector[MAP_HEADER + entry * 2 + 1] = (number >> 8) & 0xff;
			}
			session.writeSector(map, sector);
		});

		const attributes = options?.attributes ?? [];
		const slot = findSlot(directory, session);
		const when = options?.timestamp ?? session.now();
		session.patchEntry(directory, slot, (entry) => {
			entry.fill(0);
			entry[0] =
				FLAG_IN_USE |
				(attributes.includes("ReadOnly") ? FLAG_PROTECTED : 0) |
				(attributes.includes("Hidden") ? FLAG_HIDDEN : 0) |
				(attributes.includes("Archived") ? FLAG_ARCHIVED : 0) |
				(attributes.includes("Symlink") ? FLAG_SYMLINK : 0);
			entry[1] = (maps[0] as number) & 0xff;
			entry[2] = ((maps[0] as number) >> 8) & 0xff;
			entry[3] = bytes.length & 0xff;
			entry[4] = (bytes.length >> 8) & 0xff;
			entry[5] = (bytes.length >> 16) & 0xff;
			for (let i = 0; i < 8; i++) {
				entry[6 + i] = native.name.charCodeAt(i) || 0x20;
			}
			for (let i = 0; i < 3; i++) {
				entry[14 + i] = native.ext.charCodeAt(i) || 0x20;
			}
			encodeTimestamp(entry, 17, when);
		});
		return diagnostics;
	}

	function removeSpartaFile(
		session: Session,
		path: string,
		force: boolean,
	): string[] {
		const parts = splitAtariPath(path);
		const leaf = parts.pop();
		if (leaf === undefined) {
			throw new Error("no file name given");
		}
		const directory = resolveDirectory(parts);
		const found = lookup(directory, leaf);
		if (found === undefined) {
			throw new Error(`${leaf} does not exist`);
		}
		if (found.isDir) {
			throw new Error(`${leaf} is a directory`);
		}
		if ((found.flags & FLAG_PROTECTED) !== 0 && !force) {
			throw new Error(`${leaf} is protected`);
		}
		const mapped = walkMap(found.firstMap);
		for (const sector of [...mapped.maps, ...mapped.data]) {
			session.free(sector);
		}
		session.patchEntry(directory, found.offset, (entry) => {
			entry[0] = ((entry[0] ?? 0) & ~FLAG_IN_USE) | FLAG_DELETED;
		});
		return mapped.diagnostics;
	}

	function setSpartaAttributes(
		session: Session,
		path: string,
		attributes: DirEntryAttributes,
	): string[] {
		const parts = splitAtariPath(path);
		const leaf = parts.pop();
		if (leaf === undefined) {
			throw new Error("no file name given");
		}
		const directory = resolveDirectory(parts);
		const found = lookup(directory, leaf);
		if (found === undefined) {
			throw new Error(`${leaf} does not exist`);
		}
		session.patchEntry(directory, found.offset, (entry) => {
			let flags = entry[0] ?? 0;
			const set = (mask: number, on: boolean): void => {
				flags = on ? flags | mask : flags & ~mask;
			};
			set(FLAG_PROTECTED, attributes.includes("ReadOnly"));
			// Every bit rides at any revision - an older DOS ignores what it
			// does not know, the way a MyDOS subdirectory is invisible to
			// plain DOS 2.0. Setting the link flag is also how chattr does
			// FIXLINK's job: restoring the bit a symlink-blind copy stripped.
			set(FLAG_HIDDEN, attributes.includes("Hidden"));
			set(FLAG_ARCHIVED, attributes.includes("Archived"));
			set(FLAG_SYMLINK, attributes.includes("Symlink"));
			entry[0] = flags;
		});
		return [];
	}

	function moveSpartaFile(
		session: Session,
		from: string,
		to: string,
		force: boolean,
	): string[] {
		const fromParts = splitAtariPath(from);
		const fromLeaf = fromParts.pop();
		const toParts = splitAtariPath(to);
		const toLeaf = toParts.pop();
		if (fromLeaf === undefined || toLeaf === undefined) {
			throw new Error("both a source and a destination name are needed");
		}
		const native = encodeAtariName(toLeaf);
		const source = resolveDirectory(fromParts);
		const found = lookup(source, fromLeaf);
		if (found === undefined) {
			throw new Error(`${fromLeaf} does not exist`);
		}
		if ((found.flags & FLAG_PROTECTED) !== 0 && !force) {
			throw new Error(`${fromLeaf} is protected`);
		}
		const target = resolveDirectory(toParts);
		const sameDirectory = target.firstMap === source.firstMap;
		if (found.isDir && !sameDirectory) {
			// Moving a directory re-parents it; forbid moving one into its
			// own subtree, which resolveDirectory's loop check cannot see.
			// The target's parent links walk up to the main directory, so the
			// moved one must not be on that path.
			let cursor = target.firstMap;
			const climbed = new Set<number>();
			while (cursor !== 0 && !climbed.has(cursor)) {
				if (cursor === found.firstMap) {
					throw new Error(`${fromLeaf} cannot move into its own subtree`);
				}
				climbed.add(cursor);
				const header = readMapped(walkMap(cursor), ENTRY_SIZE).bytes;
				cursor = (header[1] ?? 0) | ((header[2] ?? 0) << 8);
			}
		}
		const existing = lookup(target, toLeaf);
		if (existing !== undefined && existing.offset !== found.offset) {
			throw new Error(`${toLeaf} already exists`);
		}

		// A directory's own header repeats its name and extension, and every
		// wild disk keeps the two identical, so a directory rename touches
		// both.
		const renameHeader = (): void => {
			if (!found.isDir) {
				return;
			}
			const moved = loadDirectory(found.firstMap);
			session.patchEntry(moved, 0, (header) => {
				for (let i = 0; i < 8; i++) {
					header[6 + i] = native.name.charCodeAt(i) || 0x20;
				}
				for (let i = 0; i < 3; i++) {
					header[14 + i] = native.ext.charCodeAt(i) || 0x20;
				}
			});
		};

		if (sameDirectory) {
			// A rename keeps its slot; nothing but the name changes.
			session.patchEntry(source, found.offset, (entry) => {
				for (let i = 0; i < 8; i++) {
					entry[6 + i] = native.name.charCodeAt(i) || 0x20;
				}
				for (let i = 0; i < 3; i++) {
					entry[14 + i] = native.ext.charCodeAt(i) || 0x20;
				}
			});
			renameHeader();
			return [];
		}

		// Across directories: a fresh entry pointing at the same map, the old
		// one marked deleted, and a moved directory's header re-parented.
		const bytes = new Uint8Array(ENTRY_SIZE);
		bytes.set(source.bytes.subarray(found.offset, found.offset + ENTRY_SIZE));
		const slot = findSlot(target, session);
		session.patchEntry(target, slot, (entry) => {
			entry.set(bytes);
			for (let i = 0; i < 8; i++) {
				entry[6 + i] = native.name.charCodeAt(i) || 0x20;
			}
			for (let i = 0; i < 3; i++) {
				entry[14 + i] = native.ext.charCodeAt(i) || 0x20;
			}
		});
		session.patchEntry(source, found.offset, (entry) => {
			entry[0] = ((entry[0] ?? 0) & ~FLAG_IN_USE) | FLAG_DELETED;
		});
		if (found.isDir) {
			const moved = loadDirectory(found.firstMap);
			session.patchEntry(moved, 0, (header) => {
				header[1] = target.firstMap & 0xff;
				header[2] = (target.firstMap >> 8) & 0xff;
			});
			renameHeader();
		}
		return [];
	}

	function makeSpartaDirectory(
		session: Session,
		parent: LoadedDirectory,
		name: string,
		timestamp?: Date,
	): void {
		const native = encodeAtariName(name);
		if (lookup(parent, name) !== undefined) {
			throw new Error(`${name} already exists`);
		}
		// A directory is a mapped file like any other: one map, one data
		// sector, a 23-byte header naming it and linking to its parent. The
		// header's name field is the same 11 bytes as a normal entry's -
		// extension included, which a directory can carry - and gets the
		// creation timestamp, both mirroring the parent entry (measured:
		// every wild subdirectory keeps header and entry identical there).
		const map = session.allocateDir();
		const data = session.allocateDir();
		const when = timestamp ?? session.now();
		const mapSector = new Uint8Array(medium.sectorSize);
		mapSector[MAP_HEADER] = data & 0xff;
		mapSector[MAP_HEADER + 1] = (data >> 8) & 0xff;
		session.writeSector(map, mapSector);
		const header = new Uint8Array(medium.sectorSize);
		header[0] = FLAG_IN_USE | FLAG_DIRECTORY;
		header[1] = parent.firstMap & 0xff;
		header[2] = (parent.firstMap >> 8) & 0xff;
		header[3] = ENTRY_SIZE;
		for (let i = 0; i < 8; i++) {
			header[6 + i] = native.name.charCodeAt(i) || 0x20;
		}
		for (let i = 0; i < 3; i++) {
			header[14 + i] = native.ext.charCodeAt(i) || 0x20;
		}
		encodeTimestamp(header, 17, when);
		session.writeSector(data, header);

		const slot = findSlot(parent, session);
		session.patchEntry(parent, slot, (entry) => {
			entry.fill(0);
			entry[0] = FLAG_IN_USE | FLAG_DIRECTORY;
			entry[1] = map & 0xff;
			entry[2] = (map >> 8) & 0xff;
			entry[3] = ENTRY_SIZE;
			for (let i = 0; i < 8; i++) {
				entry[6 + i] = native.name.charCodeAt(i) || 0x20;
			}
			for (let i = 0; i < 3; i++) {
				entry[14 + i] = native.ext.charCodeAt(i) || 0x20;
			}
			encodeTimestamp(entry, 17, when);
		});
	}
}

/** The EOL-terminated ATASCII target path a symlink's payload holds. */
function decodeLinkTarget(payload: Uint8Array): string {
	let out = "";
	for (const byte of payload) {
		if (byte === 0x9b) {
			break;
		}
		out += byte >= 32 && byte < 127 ? String.fromCharCode(byte) : "?";
	}
	return out;
}

function decodeField(bytes: Uint8Array): string {
	let end = bytes.length;
	while (end > 0 && (bytes[end - 1] === 0x20 || bytes[end - 1] === 0)) {
		end--;
	}
	let out = "";
	for (let i = 0; i < end; i++) {
		out += String.fromCharCode(bytes[i] ?? 0);
	}
	return out.toLowerCase();
}

// ---------------------------------------------------------------------
// Formatting. The layout matches SDX 4.50's FORMAT byte for byte (golden
// templates, six geometries, 2026-08-10): boot sectors, then the bitmap,
// then the main directory's map and single data sector; the directory
// allocation hint points right past the directory, the file allocation
// hint 32 sectors past its map - SDX reserves exactly 30 sectors for
// directory growth - and every geometry gets revision $21.
// ---------------------------------------------------------------------

interface SpartaLayout {
	total: number;
	bootCount: number;
	bitmapStart: number;
	bitmapCount: number;
	dirMap: number;
	dirData: number;
}

function spartaLayout(sectorSize: number, sectorCount: number): SpartaLayout {
	const total = Math.min(sectorCount, 0xffff);
	// 512-byte media reserve a single full-size boot sector; everything
	// else the customary three.
	const bootCount = sectorSize === 512 ? 1 : 3;
	const bitmapStart = bootCount + 1;
	// One bit per sector, the phantom sector 0 included.
	const bitmapCount = Math.ceil((total + 1) / (sectorSize * 8));
	const dirMap = bitmapStart + bitmapCount;
	return {
		total,
		bootCount,
		bitmapStart,
		bitmapCount,
		dirMap,
		dirData: dirMap + 1,
	};
}

/**
 * The $1E geometry byte: 40 tracks for the classic floppy layouts, bit 7
 * on top for double-sided, and 1 for anything without a physical shape
 * (hard disk partitions, odd sizes) - all as SDX writes them.
 */
function tracksByte(sectorSize: number, sectorCount: number): number {
	if (sectorSize === 128 && (sectorCount === 720 || sectorCount === 1040)) {
		return 40;
	}
	if (sectorSize === 256 && sectorCount === 720) {
		return 40;
	}
	if (sectorSize === 256 && sectorCount === 1440) {
		return 40 | 0x80;
	}
	return 1;
}

/** The boot record formatSpartaDos writes when the caller brings none. */
export function spartaNotBootableRecord(sectorSize: number): Uint8Array {
	return Uint8Array.from(
		sectorSize === 512 ? SPARTA_NOT_BOOTABLE_512 : SPARTA_NOT_BOOTABLE,
	);
}

/**
 * Why the variant cannot be put on this geometry, or undefined when it
 * can.
 */
export function checkSpartaDosGeometry(
	variant: SpartaDosVariant,
	sectorSize: number,
	sectorCount: number,
): string | undefined {
	if (variant === "sdfs11") {
		return (
			"SpartaDOS 1.1 lays its disks out differently (bitmap mid-disk, " +
			"other boot fields) and no formatter template exists for it; " +
			"format sdfs20 or sdfs21 instead - 1.1 reads those fine"
		);
	}
	if (sectorSize !== 128 && sectorSize !== 256 && sectorSize !== 512) {
		return `SpartaDOS needs 128-, 256- or 512-byte sectors, not ${sectorSize}`;
	}
	const layout = spartaLayout(sectorSize, sectorCount);
	if (sectorCount < layout.dirData + 1) {
		return (
			`${sectorCount} sectors cannot hold the filesystem structures ` +
			`(boot, bitmap, and directory need ${layout.dirData})`
		);
	}
	return undefined;
}

export interface FormatSpartaDosOptions {
	/**
	 * Boot record contents: exactly the boot area (three 128-byte sectors,
	 * or one 512-byte sector on 512-byte media). The parameter block at
	 * $09-$2A is overwritten - it belongs to the filesystem being made -
	 * so a record lifted from any SpartaDOS disk carries just its code.
	 * Defaults to spift's own not-bootable record.
	 */
	bootSectors?: Uint8Array;
	/** Up to eight characters, space-padded on disk. Defaults to blank. */
	volumeName?: string;
	/** The volume random number; defaults to an actual random byte. */
	random?: number;
	/** Stamps the main directory's creation time, as SDX does. */
	clock?: () => Date;
	/**
	 * Whether the last sector on the disk is handed to the data area. The
	 * pre-2.1 formatters mark it used and leave it unused; SDX 4.50 reclaims
	 * it (its "Optimize" option). This is a formatter choice, not strictly a
	 * revision property - RealDOS writes SDFS 2.1 but does not reclaim - so it
	 * has its own switch. Defaults to reclaiming on SDFS 2.1 and reserving
	 * below it, matching the goldens.
	 */
	reclaimLastSector?: boolean;
}

export interface FormatSpartaDosResult {
	variant: SpartaDosVariant;
	totalSectors: number;
	freeSectors: number;
	/** Sectors past the 65535 ceiling, which no SpartaDOS can address. */
	unusableSectors: number;
}

/**
 * Writes an empty SpartaDOS filesystem onto a medium. Existing contents
 * are overwritten. Throws when the variant does not fit the geometry (see
 * checkSpartaDosGeometry) or the boot record is the wrong shape.
 * Mutations stay in the medium's memory.
 */
export function formatSpartaDos(
	medium: SectorMedium,
	variant: SpartaDosVariant,
	options?: FormatSpartaDosOptions,
): FormatSpartaDosResult {
	const writeSector = medium.writeSector?.bind(medium);
	if (writeSector === undefined) {
		throw new Error("the medium is read-only");
	}
	const problem = checkSpartaDosGeometry(
		variant,
		medium.sectorSize,
		medium.sectorCount,
	);
	if (problem !== undefined) {
		throw new Error(problem);
	}
	const layout = spartaLayout(medium.sectorSize, medium.sectorCount);
	const record =
		options?.bootSectors ?? spartaNotBootableRecord(medium.sectorSize);
	const chunk = medium.sectorSize === 512 ? 512 : 128;
	if (record.length !== layout.bootCount * chunk) {
		throw new Error(
			`a ${medium.sectorSize}-byte-sector SpartaDOS disk reserves ` +
				`${layout.bootCount} boot sector(s) (${layout.bootCount * chunk} ` +
				`bytes), the record has ${record.length}`,
		);
	}
	const name = (options?.volumeName ?? "").toUpperCase();
	if (name.length > 8) {
		throw new Error(
			`"${options?.volumeName}" does not fit the 8-character volume name`,
		);
	}

	// The last sector on the disk: the pre-2.1 formatters (XINIT, BW-DOS)
	// mark it used and leave it unused - a historical quirk - while SDX
	// 4.50's FORMAT reclaims it (its "Optimize" option), giving one more
	// free sector. The default follows the revision, since every rev-$20
	// formatter reserves it and SDX's rev $21 reclaims it, but it is a
	// formatter choice rather than a property of the format (RealDOS writes
	// rev $21 without reclaiming), so it has its own switch. `highestData`
	// is the top sector the bitmap hands out.
	const reclaimLastSector = options?.reclaimLastSector ?? variant === "sdfs21";
	const highestData = reclaimLastSector ? layout.total : layout.total - 1;
	const freeSectors = highestData - layout.dirData;

	// Boot sectors first, the parameter block patched into the first.
	const boot = Uint8Array.from(record.subarray(0, chunk));
	const putWord = (at: number, value: number): void => {
		boot[at] = value & 0xff;
		boot[at + 1] = (value >> 8) & 0xff;
	};
	putWord(BOOT_MAIN_DIR, layout.dirMap);
	putWord(BOOT_TOTAL, layout.total);
	putWord(BOOT_FREE, freeSectors);
	boot[BOOT_BITMAP_COUNT] = layout.bitmapCount;
	putWord(BOOT_BITMAP_START, layout.bitmapStart);
	putWord(BOOT_FILE_ALLOC, Math.min(layout.dirMap + 32, layout.total));
	putWord(BOOT_DIR_ALLOC, layout.dirMap + 2);
	for (let i = 0; i < 8; i++) {
		boot[BOOT_VOLUME_NAME + i] = name.charCodeAt(i) || 0x20;
	}
	boot[BOOT_TRACKS] = tracksByte(medium.sectorSize, medium.sectorCount);
	boot[BOOT_SECTOR_SIZE] =
		medium.sectorSize === 128 ? 0x80 : medium.sectorSize === 256 ? 0x00 : 0x01;
	boot[BOOT_REVISION] = variant === "sdfs21" ? 0x21 : 0x20;
	if (variant === "sdfs21") {
		// The 2.1 self-description: sector size, map entries per sector,
		// and the one supported physical-per-logical ratio.
		putWord(0x21, medium.sectorSize);
		putWord(0x23, Math.floor((medium.sectorSize - MAP_HEADER) / 2));
		boot[0x25] = 1;
	} else {
		// The 2.0 spec calls $21-$25 reserved, but every rev-$20 formatter
		// measured (XINIT 3.2g, BW-DOS 1.30, SpartaDOS 2.3b) writes this
		// exact constant, so matching it keeps the output byte-identical.
		boot.set([0x06, 0x01, 0xff, 0xff, 0x00], 0x21);
	}
	boot[BOOT_SEQUENCE] = 0;
	boot[BOOT_RANDOM] = options?.random ?? Math.floor(Math.random() * 256);
	putWord(BOOT_DOS_MAP, 0);
	boot[BOOT_LOCK] = 0;
	if (!writeSector(1, boot)) {
		throw new Error("boot sector write failed");
	}
	for (let sector = 2; sector <= layout.bootCount; sector++) {
		const rest = record.subarray((sector - 1) * chunk, sector * chunk);
		if (!writeSector(sector, rest)) {
			throw new Error(`sector ${sector}: write failed`);
		}
	}

	// The bitmap: everything free except the phantom sector 0, the
	// structures just written, and the bits past the last real sector.
	const bitsPerPage = medium.sectorSize * 8;
	for (let page = 0; page < layout.bitmapCount; page++) {
		const bits = new Uint8Array(medium.sectorSize);
		for (let bit = 0; bit < bitsPerPage; bit++) {
			const sector = page * bitsPerPage + bit;
			if (sector > layout.dirData && sector <= highestData) {
				bits[bit >> 3] = (bits[bit >> 3] ?? 0) | (0x80 >> (bit & 7));
			}
		}
		if (!writeSector(layout.bitmapStart + page, bits)) {
			throw new Error(
				`bitmap sector ${layout.bitmapStart + page}: write failed`,
			);
		}
	}

	// The main directory: one map sector listing one data sector, whose
	// header names the root MAIN and stamps the format time, as SDX does.
	const map = new Uint8Array(medium.sectorSize);
	map[MAP_HEADER] = layout.dirData & 0xff;
	map[MAP_HEADER + 1] = (layout.dirData >> 8) & 0xff;
	if (!writeSector(layout.dirMap, map)) {
		throw new Error(`directory map sector ${layout.dirMap}: write failed`);
	}
	const header = new Uint8Array(medium.sectorSize);
	header[0] = FLAG_IN_USE | FLAG_DIRECTORY;
	header[3] = ENTRY_SIZE;
	const root = "MAIN";
	for (let i = 0; i < 11; i++) {
		header[6 + i] = root.charCodeAt(i) || 0x20;
	}
	encodeTimestamp(header, 17, options?.clock?.() ?? new Date());
	if (!writeSector(layout.dirData, header)) {
		throw new Error(`directory sector ${layout.dirData}: write failed`);
	}

	return {
		variant,
		totalSectors: layout.total,
		freeSectors,
		unusableSectors: Math.max(0, medium.sectorCount - layout.total),
	};
}
