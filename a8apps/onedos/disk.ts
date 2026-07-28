// Building Atari DOS 2.0 disk images: the sector geometry, the VTOC, and the
// ATR wrapper. Kept apart from build.ts so the layout rules are testable on
// their own and readable next to notes.local/dos/atari-dos-fs.md.

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
 * the bitmap is built from, so they can't drift apart.
 */
export function buildVtoc(): Uint8Array {
	const vtoc = new Uint8Array(SECTOR_SIZE);
	const free = freeSectors();

	vtoc[0] = VTOC_VERSION;
	vtoc[1] = free.length & 0xff; // capacity: what a fresh disk offers
	vtoc[2] = (free.length >> 8) & 0xff;
	vtoc[3] = free.length & 0xff; // free right now: all of it
	vtoc[4] = (free.length >> 8) & 0xff;
	// Bytes 5-9 are unused and stay zero.

	for (const sector of free) {
		vtoc[10 + (sector >> 3)]! |= 0x80 >> (sector & 7);
	}
	return vtoc;
}

/**
 * A single-density ATR holding `boot` in its boot sectors, a VTOC, and an
 * empty directory. Everything else is zeroed, which is what an empty
 * directory is: a zero flag byte ends the directory scan.
 */
export function buildDiskImage(boot: Uint8Array): Uint8Array {
	if (boot.length > BOOT_SECTORS * SECTOR_SIZE) {
		throw new Error(
			`Boot image is ${boot.length} bytes, more than the ${BOOT_SECTORS} boot sectors hold`,
		);
	}

	const data = new Uint8Array(SECTOR_COUNT * SECTOR_SIZE);
	data.set(boot, 0);
	data.set(buildVtoc(), (VTOC_SECTOR - 1) * SECTOR_SIZE);

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
