// Atari DOS family filesystem driver, read-only, root directory only.
// Covers DOS 1.0, DOS 2.0S/2.0D, DOS 2.5 (ED), and MyDOS formats. Layout and
// detection follow the OneDOS notes: VTOC at sector 360 (code byte, then
// total and free sector counts), root directory at sectors 361-368.

import type { SectorMedium } from "./sector-medium.ts";
import type { DirEntry, DirEntryAttribute, Filesystem } from "./filesystem.ts";

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
	return {
		family: "atari",
		variant: resolved,
		*entries(spec?: string): IterableIterator<DirEntry> {
			const matches = spec === undefined ? undefined : compileSpec(spec);
			for (
				let sectorNumber = DIRECTORY_FIRST;
				sectorNumber <= DIRECTORY_LAST;
				sectorNumber++
			) {
				const sector = medium.readSector(sectorNumber);
				if (sector === null) {
					return;
				}
				for (let index = 0; index < ENTRIES_PER_SECTOR; index++) {
					const at = index * ENTRY_SIZE;
					const flags = sector[at] ?? 0;
					if (flags === 0) {
						return; // a never-used entry ends the directory
					}
					if ((flags & FLAG_DELETED) !== 0) {
						continue;
					}
					const isDir = (flags & FLAG_DIRECTORY) !== 0;
					const inUse = (flags & FLAG_IN_USE) !== 0;
					// DOS 2.5 hides files unreachable by DOS 2.0 (sectors
					// past 719) behind the output bit with in-use clear.
					const dos25Extended = !inUse && !isDir && (flags & FLAG_OUTPUT) !== 0;
					if (!inUse && !isDir && !dos25Extended) {
						continue;
					}
					const name = decodeField(sector.subarray(at + 5, at + 13));
					const ext = decodeField(sector.subarray(at + 13, at + 16));
					if (matches !== undefined && !matches(name, ext)) {
						continue;
					}
					const attributes: DirEntryAttribute[] = [];
					if ((flags & FLAG_LOCKED) !== 0) {
						attributes.push("ReadOnly");
					}
					if (inUse && (flags & FLAG_OUTPUT) !== 0) {
						attributes.push("OpenForOutput");
					}
					if (inUse && (flags & FLAG_DOS2) === 0) {
						attributes.push("AtariDos10");
					}
					if (dos25Extended) {
						attributes.push("AtariDos25");
					}
					if ((flags & FLAG_NO_LINK) !== 0) {
						attributes.push("AtariMyDos");
					}
					yield {
						name: ext === "" ? name : `${name}.${ext}`,
						kind: isDir ? "dir" : "file",
						sectors: (sector[at + 1] ?? 0) | ((sector[at + 2] ?? 0) << 8),
						startSector: (sector[at + 3] ?? 0) | ((sector[at + 4] ?? 0) << 8),
						attributes,
					};
				}
			}
		},
	};
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
