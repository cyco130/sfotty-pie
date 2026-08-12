// ATR container support.
//
// Header (16 bytes): $0296 magic word, image data size in 16-byte paragraphs
// (low word at offset 2, high word at offset 6 per the SIO2PC rev. 3.0
// extension), sector size word at offset 4, rest zero. All little-endian.
// With 256-byte sectors the first three (boot) sectors are stored as 128
// bytes each; that rule is a double-density convention only - 512-byte and
// larger sectors are stored full-size from sector 1.

import type { SectorMedium } from "./sector-medium.ts";

export const ATR_HEADER_SIZE = 16;
export const ATR_MAGIC = 0x0296;

export const ATR_SECTOR_SIZES = [128, 256, 512, 8192] as const;
export type AtrSectorSize = (typeof ATR_SECTOR_SIZES)[number];

// Sector numbers are 16-bit on the SIO side, so this is the practical cap.
export const ATR_MAX_SECTOR_COUNT = 65535;

export interface CreateBlankAtrOptions {
	/** Defaults to 128. */
	sectorSize?: AtrSectorSize;
	/** Defaults to 720 (a standard single-density disk). */
	sectorCount?: number;
}

/** Image data size in bytes (header excluded) for a given geometry. */
export function atrDataSize(
	sectorSize: AtrSectorSize,
	sectorCount: number,
): number {
	if (sectorSize === 256) {
		const bootSectors = Math.min(sectorCount, 3);
		return bootSectors * 128 + (sectorCount - bootSectors) * 256;
	}
	return sectorCount * sectorSize;
}

/**
 * Builds a blank ATR image: a valid header followed by all-zero sector data,
 * with no filesystem installed.
 */
export function createBlankAtr(
	options: CreateBlankAtrOptions = {},
): Uint8Array {
	const { sectorSize = 128, sectorCount = 720 } = options;
	if (!ATR_SECTOR_SIZES.includes(sectorSize)) {
		throw new RangeError(`invalid sector size ${sectorSize}`);
	}
	if (
		!Number.isInteger(sectorCount) ||
		sectorCount < 1 ||
		sectorCount > ATR_MAX_SECTOR_COUNT
	) {
		throw new RangeError(
			`invalid sector count ${sectorCount} ` +
				`(must be an integer in 1..${ATR_MAX_SECTOR_COUNT})`,
		);
	}

	const dataSize = atrDataSize(sectorSize, sectorCount);
	const paragraphs = dataSize / 16;
	const bytes = new Uint8Array(ATR_HEADER_SIZE + dataSize);
	const view = new DataView(bytes.buffer);
	view.setUint16(0, ATR_MAGIC, true);
	view.setUint16(2, paragraphs & 0xffff, true);
	view.setUint16(4, sectorSize, true);
	view.setUint16(6, paragraphs >>> 16, true);
	return bytes;
}

export interface AtrImage extends SectorMedium {
	/**
	 * The image bytes, header included. Sparse images (file shorter than the
	 * header-claimed size) are materialized to full capacity on open, so this
	 * is not always the same array that was passed in.
	 */
	readonly bytes: Uint8Array;
	writeSector(sector: number, data: ArrayLike<number>): boolean;
}

/**
 * Opens an in-memory ATR image for sector access. Throws on a bad magic or
 * an unknown sector size; everything else is read leniently. Writes mutate
 * the returned bytes in memory - flushing them anywhere is the caller's
 * business.
 */
export function openAtr(inputBytes: Uint8Array): AtrImage {
	if (inputBytes.length < ATR_HEADER_SIZE) {
		throw new Error("not an ATR image (shorter than the 16-byte header)");
	}
	const view = new DataView(
		inputBytes.buffer,
		inputBytes.byteOffset,
		inputBytes.byteLength,
	);
	if (view.getUint16(0, true) !== ATR_MAGIC) {
		throw new Error("not an ATR image (bad magic)");
	}
	const sectorSize = view.getUint16(4, true);
	if (!(ATR_SECTOR_SIZES as readonly number[]).includes(sectorSize)) {
		throw new Error(`unsupported ATR sector size ${sectorSize}`);
	}
	// The header is authoritative for capacity: sparse images (trailing empty
	// sectors omitted, a common wild convention) read as zeroes past EOF, and
	// content beyond the claimed size is ignored. Materializing sparse images
	// up front keeps the write path trivial.
	const paragraphs =
		view.getUint16(2, true) + view.getUint16(6, true) * 0x10000;
	const dataSize = paragraphs * 16;
	let bytes = inputBytes;
	if (bytes.length < ATR_HEADER_SIZE + dataSize) {
		bytes = new Uint8Array(ATR_HEADER_SIZE + dataSize);
		bytes.set(inputBytes);
	}
	const data = bytes.subarray(ATR_HEADER_SIZE);

	// For 256-byte sectors the standard layout stores the three boot sectors
	// as 128 bytes (data size % 256 == 128). A full-multiple size means one
	// of the buggy-tool layouts; we assume pad-after-boot (packed 128-byte
	// boots, sector 4 at offset 768), which is the corpus majority and reads
	// identically to full-size-boot for every sector past the boot area.
	let sectorCount: number;
	let sector4Offset = 0;
	if (sectorSize === 256) {
		sector4Offset = dataSize % 256 === 0 ? 768 : 384;
		sectorCount =
			dataSize <= sector4Offset
				? Math.min(3, Math.floor(dataSize / 128))
				: 3 + Math.floor((dataSize - sector4Offset) / 256);
	} else {
		sectorCount = Math.floor(dataSize / sectorSize);
	}

	const locateSector = (sector: number): [offset: number, size: number] => {
		if (sectorSize === 256 && sector <= 3) {
			return [(sector - 1) * 128, 128];
		}
		if (sectorSize === 256) {
			return [sector4Offset + (sector - 4) * 256, 256];
		}
		return [(sector - 1) * sectorSize, sectorSize];
	};

	const readSector = (sector: number): Uint8Array | null => {
		if (!Number.isInteger(sector) || sector < 1 || sector > sectorCount) {
			return null;
		}
		const [offset, size] = locateSector(sector);
		const out = new Uint8Array(size);
		out.set(
			data.subarray(
				Math.min(offset, data.length),
				Math.min(offset + size, data.length),
			),
		);
		return out;
	};

	const writeSector = (sector: number, input: ArrayLike<number>): boolean => {
		if (!Number.isInteger(sector) || sector < 1 || sector > sectorCount) {
			return false;
		}
		const [offset, size] = locateSector(sector);
		if (input.length !== size || offset + size > data.length) {
			return false;
		}
		data.set(input, offset);
		return true;
	};

	return { bytes, sectorSize, sectorCount, readSector, writeSector };
}
