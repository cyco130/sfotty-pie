// ATR container support.
//
// Header (16 bytes): $0296 magic word, image data size in 16-byte paragraphs
// (low word at offset 2, high word at offset 6 per the SIO2PC rev. 3.0
// extension), sector size word at offset 4, rest zero. All little-endian.
// With 256-byte sectors the first three (boot) sectors are stored as 128
// bytes each; that rule is a double-density convention only - 512-byte and
// larger sectors are stored full-size from sector 1.

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
