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
	 * Writes a file into the root directory, always in DOS 2 chain format.
	 * The name is a decoded display name ("game.com") whose fields must fit
	 * 8.3 in [A-Z0-9_@] (see toAtariName). Throws on unsupported variants
	 * (DOS 1.0, large MyDOS), a full directory or disk, or an existing name
	 * unless overwrite is set. Mutations stay in the medium's memory.
	 * Returns the traversal diagnostics from freeing an overwritten file's
	 * chain - non-empty means that chain was damaged (loop, bad link) and
	 * only its reachable sectors were freed.
	 */
	writeFile(
		name: string,
		bytes: Uint8Array,
		options?: { overwrite?: boolean },
	): string[];
	/**
	 * Deletes a file: frees its chain in the bitmap and sets the deleted
	 * flag (the rest of the entry stays, like the DOSes leave it). Throws
	 * when the name is missing, a directory, or locked (unless force), and
	 * on large MyDOS disks. Mutations stay in the medium's memory. Returns
	 * the traversal diagnostics from freeing the chain - non-empty means it
	 * was damaged and only its reachable sectors were freed.
	 */
	deleteFile(name: string, options?: { force?: boolean }): string[];
}

const VTOC_SECTOR = 360;
const DIRECTORY_FIRST = 361;
const DIRECTORY_LAST = 368;
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
	// MyDOS encodes the VTOC sector count in the code byte; check it against
	// what MyDOS would use for this geometry (2, plus one per extra VTOC page
	// managing 2048 sectors past the first 943).
	if (code >= 2 && total <= medium.sectorCount) {
		const extraPages = Math.max(
			0,
			Math.ceil((medium.sectorCount - 943) / 2048),
		);
		if (code === 2 + extraPages) {
			return "mydos";
		}
	}
	return undefined;
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

	// Yields every present entry (in use, MyDOS subdirectory, or a DOS 2.5
	// extended file hidden behind the output bit with in-use clear), stopping
	// at the first never-used slot.
	function* scanDirectory(): IterableIterator<RawEntry> {
		let index = -1;
		for (
			let sectorNumber = DIRECTORY_FIRST;
			sectorNumber <= DIRECTORY_LAST;
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
				if ((flags & FLAG_DELETED) !== 0) {
					continue;
				}
				const isDir = (flags & FLAG_DIRECTORY) !== 0;
				const inUse = (flags & FLAG_IN_USE) !== 0;
				const dos25Extended = !inUse && !isDir && (flags & FLAG_OUTPUT) !== 0;
				if (!inUse && !isDir && !dos25Extended) {
					continue;
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
					isDir,
					displayName: ext === "" ? name : `${name}.${ext}`,
				};
			}
		}
	}

	return {
		family: "atari",
		variant: resolved,
		*entries(spec?: string): IterableIterator<DirEntry> {
			const matches = spec === undefined ? undefined : compileSpec(spec);
			for (const raw of scanDirectory()) {
				if (matches !== undefined && !matches(raw.name, raw.ext)) {
					continue;
				}
				const inUse = (raw.flags & FLAG_IN_USE) !== 0;
				const attributes: DirEntryAttribute[] = [];
				if ((raw.flags & FLAG_LOCKED) !== 0) {
					attributes.push("ReadOnly");
				}
				if (inUse && (raw.flags & FLAG_OUTPUT) !== 0) {
					attributes.push("OpenForOutput");
				}
				if (inUse && (raw.flags & FLAG_DOS2) === 0) {
					attributes.push("AtariDos10");
				}
				if (!inUse && !raw.isDir) {
					attributes.push("AtariDos25");
				}
				if ((raw.flags & FLAG_NO_LINK) !== 0) {
					attributes.push("AtariMyDos");
				}
				yield {
					name: raw.displayName,
					kind: raw.isDir ? "dir" : "file",
					sectors: raw.sectors,
					startSector: raw.startSector,
					attributes,
				};
			}
		},
		readFile(name: string): FileContents | null {
			// First match wins; duplicate names only occur on damaged disks.
			for (const raw of scanDirectory()) {
				if (!raw.isDir && raw.displayName === name.toLowerCase()) {
					return walkChain(medium, raw).contents;
				}
			}
			return null;
		},
		writeFile(
			name: string,
			bytes: Uint8Array,
			options?: { overwrite?: boolean },
		): string[] {
			return writeAtariFile(
				medium,
				resolved,
				name,
				bytes,
				options?.overwrite === true,
			);
		},
		deleteFile(name: string, options?: { force?: boolean }): string[] {
			return deleteAtariFile(medium, resolved, name, options?.force === true);
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

function loadDirectory(medium: SectorMedium): LoadedDirectory {
	const dirSectors: Uint8Array[] = [];
	for (let s = DIRECTORY_FIRST; s <= DIRECTORY_LAST; s++) {
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
			if (
				sector === undefined ||
				!writeSector(DIRECTORY_FIRST + (slot >> 3), sector)
			) {
				throw new Error("directory write failed");
			}
		},
	};
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
	readonly hasVtoc2: boolean;
	isFree(sector: number): boolean;
	mark(sector: number, free: boolean): void;
	flush(writeSector: NonNullable<SectorMedium["writeSector"]>): void;
}

/**
 * The usage bitmap plus free counters, held in memory until flush. On DOS
 * 2.5 the main VTOC is authoritative for the shared region (sectors
 * 48..719) - DOS 2.0 writes to ED disks without updating VTOC2, so its
 * shared copy can be stale; flush repairs it silently. The main free count
 * covers sectors below 720 only; VTOC2's own count (bytes 122-123) covers
 * 720..1023 (verified against wild ED disks).
 */
function vtocAccounting(
	medium: SectorMedium,
	variant: AtariDosVariant,
): VtocAccounting {
	const vtoc = medium.readSector(VTOC_SECTOR);
	if (vtoc === null) {
		throw new Error("the VTOC is outside the image");
	}
	const vtoc2 = variant === "dos25" ? medium.readSector(1024) : null;
	let lowDelta = 0;
	let highDelta = 0;
	const bitPlace = (
		sector: number,
	): [buffer: Uint8Array, at: number, mask: number] | null => {
		if (sector < 720 || vtoc2 === null) {
			if (sector > 943 || 10 + (sector >> 3) >= vtoc.length) {
				return null;
			}
			return [vtoc, 10 + (sector >> 3), 0x80 >> (sector & 7)];
		}
		if (sector > 1023) {
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
		hasVtoc2: vtoc2 !== null,
		isFree,
		mark(sector: number, free: boolean): void {
			const place = bitPlace(sector);
			if (place === null || isFree(sector) === free) {
				return;
			}
			const [buffer, at, mask] = place;
			buffer[at] = (buffer[at] ?? 0) ^ mask;
			const delta = free ? 1 : -1;
			if (sector < 720) {
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
				if (!writeSector(1024, vtoc2)) {
					throw new Error("VTOC2 write failed");
				}
			}
		},
	};
}

function writeAtariFile(
	medium: SectorMedium,
	variant: AtariDosVariant,
	name: string,
	fileBytes: Uint8Array,
	overwrite: boolean,
): string[] {
	const writeSector = medium.writeSector?.bind(medium);
	if (writeSector === undefined) {
		throw new Error("the medium is read-only");
	}
	if (variant === "dos10") {
		// OneDOS precedent: DOS 1.0 files are read, never created - a DOS 2
		// format chain would corrupt the disk for DOS 1.0 itself.
		throw new Error("adding files to DOS 1.0 disks is not supported");
	}
	if (variant === "mydos") {
		// Detected mydos implies a >943-sector disk (smaller MyDOS disks
		// detect as DOS 2.0), which needs extra VTOC pages and full links.
		throw new Error("adding files to large MyDOS disks is not yet supported");
	}
	const native = encodeAtariName(name);

	// Find both a slot to use and any existing file of the same name.
	const directory = loadDirectory(medium);
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
	if (existing !== -1) {
		const raw = rawEntryFromSlot(slotIn(existing), existing);
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
	const maxSector = Math.min(
		medium.sectorCount,
		accounting.hasVtoc2 ? 1023 : 943,
	);
	const allocated: number[] = [];
	for (let s = 4; s <= maxSector && allocated.length < needed; s++) {
		if (s >= VTOC_SECTOR && s <= DIRECTORY_LAST) {
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

	// The chain, always in DOS 2 format (never DOS 1).
	for (let i = 0; i < allocated.length; i++) {
		const sector = allocated[i] ?? 0;
		const next = allocated[i + 1] ?? 0;
		const chunk = fileBytes.subarray(
			i * capacity,
			Math.min((i + 1) * capacity, fileBytes.length),
		);
		const buffer = new Uint8Array(medium.sectorSize);
		buffer.set(chunk);
		buffer[capacity] = (slot << 2) | ((next >> 8) & 0x03);
		buffer[capacity + 1] = next & 0xff;
		buffer[capacity + 2] = chunk.length;
		if (!writeSector(sector, buffer)) {
			throw new Error(`sector ${sector}: write failed`);
		}
	}

	// The directory entry. A file reaching past sector 719 on DOS 2.5 gets
	// the extended marking (output bit, in-use clear) that hides it from
	// DOS 2.0.
	const extended = accounting.hasVtoc2 && allocated.some((s) => s > 719);
	const entry = slotIn(slot);
	entry[0] = extended ? FLAG_OUTPUT | FLAG_DOS2 : FLAG_IN_USE | FLAG_DOS2;
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
	return diagnostics;
}

function deleteAtariFile(
	medium: SectorMedium,
	variant: AtariDosVariant,
	name: string,
	force: boolean,
): string[] {
	const writeSector = medium.writeSector?.bind(medium);
	if (writeSector === undefined) {
		throw new Error("the medium is read-only");
	}
	if (variant === "mydos") {
		// Freeing sectors past 943 needs the extra VTOC pages this driver
		// doesn't handle yet; refuse rather than leak them. (DOS 1.0 is fine:
		// deletion only touches the directory flag and the shared bitmap
		// format, and we can walk DOS 1 chains.)
		throw new Error("deleting files on large MyDOS disks is not yet supported");
	}
	const native = encodeAtariName(name);

	const directory = loadDirectory(medium);
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
	return walk.contents.diagnostics;
}

function encodeAtariName(display: string): { name: string; ext: string } {
	const dot = display.indexOf(".");
	const name = (dot === -1 ? display : display.slice(0, dot)).toUpperCase();
	const ext = (dot === -1 ? "" : display.slice(dot + 1)).toUpperCase();
	if (!/^[A-Z0-9_@]{1,8}$/.test(name) || !/^[A-Z0-9_@]{0,3}$/.test(ext)) {
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
