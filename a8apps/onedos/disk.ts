// Building Atari DOS 2.0 disk images: the sector geometry, the VTOC, the
// directory and file chains, and the ATR wrapper. Kept apart from build.ts so
// the layout rules are testable on their own.

/** Single density: 720 sectors of 128 bytes. */
export const SECTOR_SIZE = 128;
export const SECTOR_COUNT = 720;

/** The VTOC always lands on sector 360 for a single-VTOC disk. */
export const VTOC_SECTOR = 360;
/** The root directory: eight sectors, 361-368. */
export const DIRECTORY_FIRST = 361;
export const DIRECTORY_SECTORS = 8;
/** Boot sectors 1-3, always 128 bytes whatever the density. */
export const BOOT_SECTORS = 3;

/**
 * Offset of the sector-link field in a data sector: 125 for 128-byte sectors,
 * 253 for 256-byte ones. The loader reads it back to learn the sector size,
 * so the two can never disagree.
 */
export const SECTOR_LINK_OFFSET = SECTOR_SIZE === 128 ? 125 : 253;

/** VTOC version 2: DOS 2.0, one VTOC sector, up to 943 sectors. */
const VTOC_VERSION = 2;

/** Data bytes per sector: the 3-byte trailer holds the link and length. */
export const DATA_BYTES = SECTOR_LINK_OFFSET;

/** A file to store on the disk, DOS 2.0 style. */
export interface DiskFile {
	/** An 8.3 name, uppercase letters and digits ("ONEDOS.DOS"). */
	name: string;
	data: Uint8Array;
}

export interface PlannedFile extends DiskFile {
	/** The sectors the file's chain occupies, in order. */
	sectors: number[];
}

/**
 * Allocate sectors for each file, first-fit from the free list (so the first
 * file starts in the first data sector). Split from rendering so callers can
 * learn placement - the boot loader gets the first file's start patched in -
 * before the image exists.
 */
export function planFiles(files: DiskFile[]): PlannedFile[] {
	const free = freeSectors();
	let next = 0;
	return files.map((file) => {
		const count = Math.max(1, Math.ceil(file.data.length / DATA_BYTES));
		if (next + count > free.length) {
			throw new Error(`Disk full: "${file.name}" needs ${count} sectors`);
		}
		const sectors = free.slice(next, next + count);
		next += count;
		return { ...file, sectors };
	});
}

/** "ONEDOS.DOS" -> the 11-byte space-padded directory name field. */
function encodeFileName(name: string): Uint8Array {
	const match = /^([A-Z0-9]{1,8})(?:\.([A-Z0-9]{0,3}))?$/.exec(name);
	if (!match) {
		throw new Error(`Not a DOS 2.0 file name: "${name}"`);
	}
	const padded = match[1]!.padEnd(8) + (match[2] ?? "").padEnd(3);
	return new TextEncoder().encode(padded);
}

/**
 * Which sectors a freshly formatted disk has available: everything past the
 * boot sectors except the VTOC and the directory.
 *
 * Sector 720 is included, which is the one deliberate difference from a DOS
 * 2.0S format. DOS 2.0S leaves the last sector out of its bitmap - a quirk of
 * that formatter rather than a geometry limit - and so reports 707 free.
 * MyDOS uses it, and so does this, hence 708. Every DOS in the family reads
 * the result; DOS 2.0S simply never allocates the extra sector itself.
 */
function freeSectors(): number[] {
	const free: number[] = [];
	for (let sector = BOOT_SECTORS + 1; sector <= SECTOR_COUNT; sector++) {
		if (sector === VTOC_SECTOR) continue;
		if (
			sector >= DIRECTORY_FIRST &&
			sector < DIRECTORY_FIRST + DIRECTORY_SECTORS
		) {
			continue;
		}
		free.push(sector);
	}
	return free;
}

/**
 * The VTOC sector: version, capacity, free count, and the usage bitmap (a set
 * bit is a free sector, sector 0 first). Both counts come from the same list
 * the bitmap is built from, so they can't drift apart. `allocated` sectors
 * (file chains) count against the free number and clear their bits; the
 * capacity stays what a fresh disk offers.
 */
export function buildVtoc(
	allocated: ReadonlySet<number> = new Set(),
): Uint8Array {
	const vtoc = new Uint8Array(SECTOR_SIZE);
	const free = freeSectors().filter((sector) => !allocated.has(sector));
	const capacity = freeSectors().length;

	vtoc[0] = VTOC_VERSION;
	vtoc[1] = capacity & 0xff; // capacity: what a fresh disk offers
	vtoc[2] = (capacity >> 8) & 0xff;
	vtoc[3] = free.length & 0xff; // free right now
	vtoc[4] = (free.length >> 8) & 0xff;
	// Bytes 5-9 are unused and stay zero.

	for (const sector of free) {
		vtoc[10 + (sector >> 3)]! |= 0x80 >> (sector & 7);
	}
	return vtoc;
}

/**
 * A single-density ATR holding `boot` in its boot sectors, a VTOC, a
 * directory listing the planned files, and their sector chains. With no
 * files that leaves an empty directory: a zero flag byte ends the directory
 * scan, so zeroed sectors are exactly "empty".
 */
export function buildDiskImage(
	boot: Uint8Array,
	files: PlannedFile[] = [],
): Uint8Array {
	if (boot.length > BOOT_SECTORS * SECTOR_SIZE) {
		throw new Error(
			`Boot image is ${boot.length} bytes, more than the ${BOOT_SECTORS} boot sectors hold`,
		);
	}

	const data = new Uint8Array(SECTOR_COUNT * SECTOR_SIZE);
	data.set(boot, 0);

	const sectorAt = (sector: number) =>
		data.subarray((sector - 1) * SECTOR_SIZE, sector * SECTOR_SIZE);

	const allocated = new Set<number>();
	files.forEach((file, index) => {
		// The file chain: DATA_BYTES per sector, then the trailer - the 6-bit
		// file number (the directory index; DOSes cross-check it) sharing a
		// byte with the link's high bits, the link's low byte, and how many
		// data bytes this sector holds. A zero link ends the file.
		file.sectors.forEach((sector, i) => {
			allocated.add(sector);
			const target = sectorAt(sector);
			const chunk = file.data.subarray(i * DATA_BYTES, (i + 1) * DATA_BYTES);
			target.set(chunk, 0);
			const next = file.sectors[i + 1] ?? 0;
			target[DATA_BYTES] = (index << 2) | ((next >> 8) & 0x03);
			target[DATA_BYTES + 1] = next & 0xff;
			target[DATA_BYTES + 2] = chunk.length;
		});

		// The directory entry: 16 bytes, 8 per single-density sector. $42 =
		// in use + created by DOS 2 (the length byte counts data bytes).
		const entry = sectorAt(DIRECTORY_FIRST + (index >> 3)).subarray(
			(index & 7) * 16,
			(index & 7) * 16 + 16,
		);
		entry[0] = 0x42;
		entry[1] = file.sectors.length & 0xff;
		entry[2] = (file.sectors.length >> 8) & 0xff;
		entry[3] = file.sectors[0]! & 0xff;
		entry[4] = (file.sectors[0]! >> 8) & 0xff;
		entry.set(encodeFileName(file.name), 5);
	});

	data.set(buildVtoc(allocated), (VTOC_SECTOR - 1) * SECTOR_SIZE);

	// The ATR header: magic, size in 16-byte paragraphs (24 bits, the high
	// byte in the rev 3.0 field), and the sector size.
	const image = new Uint8Array(16 + data.length);
	const paragraphs = data.length / 16;
	image[0] = 0x96;
	image[1] = 0x02;
	image[2] = paragraphs & 0xff;
	image[3] = (paragraphs >> 8) & 0xff;
	image[4] = SECTOR_SIZE & 0xff;
	image[5] = (SECTOR_SIZE >> 8) & 0xff;
	image[6] = (paragraphs >> 16) & 0xff;
	image.set(data, 16);
	return image;
}
