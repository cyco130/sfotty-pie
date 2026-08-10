// Boot records for the Atari DOS family: how big one is, how to tell the
// odd one out, and how to move one between densities.
//
// Bytes 9-19 of a record are a parameter block sitting below the entry
// point (the vector at 6-8 jumps clear of it), so they are data the boot
// code reads rather than instructions. Two of them describe the disk, and
// patching just those two moves a record between densities - measured on
// DOS 2.0S and MyDOS 4.53, each of which then boots, lists and writes at
// the other density.

import type { AtariDosVariant } from "./atari-dos.ts";
import { NOT_BOOTABLE } from "./notboot-bytes.ts";

/** Sector size / 128: 1 for single and enhanced density, 2 for double. */
const SECTOR_SIZE_CODE = 0x0e;
/** Sector size - 3: where the three-byte link trailer starts. */
const LINK_OFFSET = 0x11;
/** DOS 1.0 puts $ff here instead, and its DOS.SYS pointer one byte later. */
const DOS10_MARKER = 0xff;

/**
 * How many sectors a variant's boot area holds. DOS 1.0 reserves one; every
 * later Atari DOS reserves three.
 */
export function bootSectorCount(variant: AtariDosVariant): number {
	return variant === "dos10" ? 1 : 3;
}

/**
 * Whether a record is DOS 1.0's. It is the one layout that does not carry
 * the density fields at all - a single sector, with $ff where the others
 * put the sector size code - so it can neither be adapted nor land on a
 * double-density disk.
 */
export function isDos10BootRecord(bytes: Uint8Array): boolean {
	return bytes[1] === 1 && bytes[SECTOR_SIZE_CODE] === DOS10_MARKER;
}

/** Whether a record says the disk boots. Zero is the "not bootable" mark. */
export function isBootable(bytes: Uint8Array): boolean {
	return isDos10BootRecord(bytes)
		? bytes[0x10] !== 0 || bytes[0x11] !== 0
		: bytes[SECTOR_SIZE_CODE] !== 0;
}

/**
 * Rewrites a record's density fields for the disk it is going onto, in
 * place. Leaves everything else alone, including byte 9 (maximum open
 * files), which differs between DOS builds rather than densities and would
 * be a build setting to clobber.
 *
 * DOS 1.0 is refused rather than adapted: its parameter block has no
 * density fields, and its filesystem is single density only.
 */
export function adaptBootRecord(
	bytes: Uint8Array,
	sectorSize: number,
): { adapted: boolean } {
	if (isDos10BootRecord(bytes)) {
		if (sectorSize !== 128) {
			throw new Error(
				"this is a DOS 1.0 boot record, which has no density fields and " +
					"only works on 128-byte sectors",
			);
		}
		return { adapted: false };
	}
	const code = sectorSize / 128;
	const link = sectorSize - 3;
	const already =
		bytes[SECTOR_SIZE_CODE] === code && bytes[LINK_OFFSET] === link;
	// A record marked not bootable has a zero sector-size code; leave that
	// alone, since writing a real code would claim the disk boots.
	if (bytes[SECTOR_SIZE_CODE] !== 0) {
		bytes[SECTOR_SIZE_CODE] = code;
	}
	bytes[LINK_OFFSET] = link;
	return { adapted: !already };
}

/**
 * Marks a record bootable (or not) by writing the density code that byte 14
 * carries. Zero is what a DOS's own FORMAT leaves behind, and what its boot
 * code checks before anything else.
 */
export function setBootable(
	bytes: Uint8Array,
	bootable: boolean,
	sectorSize: number,
): void {
	if (!isDos10BootRecord(bytes)) {
		bytes[SECTOR_SIZE_CODE] = bootable ? sectorSize / 128 : 0;
	}
}

/**
 * The record spift writes for a disk that gets a filesystem but no DOS: it
 * says so on screen and waits for RESET. Sized to the variant's boot area,
 * with the density fields filled in so the record describes its disk even
 * though nothing reads them while byte 14 is zero.
 */
export function notBootableRecord(
	variant: AtariDosVariant,
	sectorSize: number,
): Uint8Array {
	const sectors = bootSectorCount(variant);
	// Boot sectors are 128 bytes even on a double-density disk.
	const record = new Uint8Array(sectors * 128);
	record.set(NOT_BOOTABLE);
	record[1] = sectors;
	record[SECTOR_SIZE_CODE] = 0;
	record[LINK_OFFSET] = sectorSize - 3;
	return record;
}
