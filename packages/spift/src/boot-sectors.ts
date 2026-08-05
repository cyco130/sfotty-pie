// Boot-sector writing: a container-level operation (no filesystem
// involved) - raw bytes laid over sectors 1..N, sized by each sector's
// actual length, which is how the 128-byte boot sectors of 256-bps images
// fall out naturally.

import type { SectorMedium } from "./sector-medium.ts";

export interface WriteBootSectorsOptions {
	/** Zero-pad the tail to a whole sector instead of erroring. */
	pad?: boolean;
	/** Write even when the file's boot-sector-count byte disagrees. */
	force?: boolean;
}

export interface WriteBootSectorsResult {
	sectorsWritten: number;
	/** The count the file's second byte claims. */
	claimedSectors: number;
	padded: number;
}

/**
 * Writes a boot file over sectors 1..N. The file must span a whole number
 * of sectors (per the medium's actual sector sizes) and its second byte -
 * the boot record's sector count - must match N; the options relax those
 * rules. Mutations stay in the medium's memory.
 */
export function writeBootSectors(
	medium: SectorMedium,
	boot: Uint8Array,
	options?: WriteBootSectorsOptions,
): WriteBootSectorsResult {
	const writeSector = medium.writeSector?.bind(medium);
	if (writeSector === undefined) {
		throw new Error("the medium is read-only");
	}
	if (boot.length < 2) {
		throw new Error(
			"the boot file is too short to be a boot record (needs at least " +
				"the 2-byte header start)",
		);
	}

	// Lay the file over sectors 1.. by each sector's actual size.
	const spans: { sector: number; offset: number; size: number }[] = [];
	let offset = 0;
	for (let sector = 1; offset < boot.length; sector++) {
		const size = medium.readSector(sector)?.length;
		if (size === undefined) {
			throw new Error(
				`the boot file does not fit the image ` +
					`(${boot.length} bytes, image has ${medium.sectorCount} sectors)`,
			);
		}
		spans.push({ sector, offset, size });
		offset += size;
	}
	const lastSpan = spans[spans.length - 1];
	const padded = offset - boot.length;
	if (padded > 0 && options?.pad !== true) {
		throw new Error(
			`the boot file is ${boot.length} bytes, not a whole number of ` +
				`sectors (sector ${lastSpan?.sector ?? 1} ends at byte ` +
				`${offset}); use --pad to zero-fill the tail`,
		);
	}

	const claimedSectors = boot[1] ?? 0;
	if (claimedSectors !== spans.length && options?.force !== true) {
		throw new Error(
			`the boot file's second byte claims ${claimedSectors} boot ` +
				`sector(s) but the file spans ${spans.length}; use --force ` +
				`to write it anyway`,
		);
	}

	for (const span of spans) {
		const buffer = new Uint8Array(span.size);
		buffer.set(
			boot.subarray(
				span.offset,
				Math.min(span.offset + span.size, boot.length),
			),
		);
		if (!writeSector(span.sector, buffer)) {
			throw new Error(`sector ${span.sector}: write failed`);
		}
	}
	return { sectorsWritten: spans.length, claimedSectors, padded };
}

export interface ExtractBootSectorsResult {
	bytes: Uint8Array;
	sectorCount: number;
	/** The count the boot record's second byte claims. */
	claimedSectors: number;
}

/**
 * Extracts sectors 1..N at their actual sizes, concatenated. N defaults to
 * the boot record's own count (sector 1, byte 1); a claim of zero or more
 * sectors than the image holds is an error unless an explicit sectorCount
 * overrides it.
 */
export function extractBootSectors(
	medium: SectorMedium,
	options?: { sectorCount?: number },
): ExtractBootSectorsResult {
	const first = medium.readSector(1);
	if (first === null) {
		throw new Error("the image has no sectors");
	}
	const claimedSectors = first[1] ?? 0;
	let sectorCount = options?.sectorCount;
	if (sectorCount === undefined) {
		if (claimedSectors === 0 || claimedSectors > medium.sectorCount) {
			throw new Error(
				`the boot record claims ${claimedSectors} boot sector(s)` +
					`${claimedSectors === 0 ? "" : ` but the image has ${medium.sectorCount}`}; ` +
					`specify --sector-count`,
			);
		}
		sectorCount = claimedSectors;
	} else if (
		!Number.isInteger(sectorCount) ||
		sectorCount < 1 ||
		sectorCount > medium.sectorCount
	) {
		throw new Error(
			`invalid sector count ${sectorCount} ` +
				`(the image has ${medium.sectorCount} sectors)`,
		);
	}

	const chunks: Uint8Array[] = [];
	let total = 0;
	for (let sector = 1; sector <= sectorCount; sector++) {
		const data = medium.readSector(sector);
		if (data === null) {
			throw new Error(`sector ${sector}: read failed`);
		}
		chunks.push(data);
		total += data.length;
	}
	const bytes = new Uint8Array(total);
	let at = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, at);
		at += chunk.length;
	}
	return { bytes, sectorCount, claimedSectors };
}
