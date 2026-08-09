// DCM, the compressed disk image format of Bob Puff's Disk Communicator.
//
// A file is a sequence of passes, each a header plus a run of blocks that
// build sectors into a buffer carried from block to block (and across pass
// boundaries). Sectors no block ever mentions stay zero - that is how empty
// space is compressed.
//
// Two points where the public descriptions of the format disagree were
// settled by decoding a 203-file corpus both ways; each is noted where it
// arises.

import { openAtr, type AtrImage } from "./atr.ts";
import { createBlankAtr } from "./atr.ts";

/** Both mark a pass header; nothing in the wild seems to write $F9. */
const PASS_F9 = 0xf9;
const PASS_FA = 0xfa;

const BLOCK_CHANGE_BEGIN = 0x41;
const BLOCK_DOS_SECTOR = 0x42;
const BLOCK_COMPRESSED = 0x43;
const BLOCK_CHANGE_END = 0x44;
const BLOCK_PASS_END = 0x45;
const BLOCK_SAME = 0x46;
const BLOCK_UNCOMPRESSED = 0x47;

/** Density code in bits 5-6 of the pass header flags. */
const DENSITIES: Record<
	number,
	{ sectorSize: 128 | 256; sectorCount: number }
> = {
	0: { sectorSize: 128, sectorCount: 720 },
	1: { sectorSize: 256, sectorCount: 720 },
	2: { sectorSize: 128, sectorCount: 1040 },
};

export interface DcmDecodeOptions {
	/**
	 * How a change-begin (0x41) block treats the bytes past the ones it
	 * carries. "keep" is acvt's reading - they stay as the previous sector
	 * left them - and "fill" is dcmtoatr's, which replicates a byte from the
	 * stream across the whole sector first. They differ only when the
	 * unchanged tail is not uniform, which across a 203-file corpus happens
	 * in exactly one file - and there "fill" resurrects stale directory
	 * entries whose recorded file numbers prove they belong to slots they no
	 * longer occupy. "keep" is also the only reading that squares with the
	 * reference encoder, which emits this block when a sector shares a tail
	 * with its predecessor.
	 */
	changeBeginTail?: "keep" | "fill";
	/**
	 * Whether a block for sectors 1-3 of a double-density image carries 128
	 * bytes, as an ATR stores them, or a full 256 like every other sector.
	 * Only ever matters for DD, where every double-density file in a
	 * 203-file corpus carries the full 256 and fails to parse at all when
	 * read as 128.
	 */
	shortBootSectors?: boolean;
}

export interface DcmDecodeResult {
	/** The image, in the same shape an ATR holds it. */
	bytes: Uint8Array;
	sectorSize: 128 | 256;
	sectorCount: number;
	passes: number;
	/** Block types met, for surveying what real files use. */
	blockCounts: Record<number, number>;
}

/** True when these bytes open like a DCM pass header. */
export function isDcm(bytes: Uint8Array): boolean {
	if (bytes.length < 4) {
		return false;
	}
	const type = bytes[0] as number;
	if (type !== PASS_F9 && type !== PASS_FA) {
		return false;
	}
	// Density has to be one of the three, and a first pass is pass 1.
	const flags = bytes[1] as number;
	return DENSITIES[(flags >> 5) & 3] !== undefined && (flags & 0x1f) === 1;
}

/**
 * Decodes a DCM stream - one file, or several parts concatenated - into the
 * flat sector image an ATR carries. Throws on a corrupt or truncated file.
 */
export function decodeDcm(
	bytes: Uint8Array,
	options?: DcmDecodeOptions,
): DcmDecodeResult {
	const keepTail = (options?.changeBeginTail ?? "keep") === "keep";
	const shortBoot = options?.shortBootSectors ?? false;

	let at = 0;
	const need = (count: number, what: string): void => {
		if (at + count > bytes.length) {
			throw new Error(`truncated ${what} at byte ${at}`);
		}
	};
	const byte = (): number => bytes[at++] as number;

	// The first pass header settles the geometry for the whole image.
	need(4, "pass header");
	const first = bytes[1] as number;
	const geometry = DENSITIES[(first >> 5) & 3];
	if (geometry === undefined) {
		throw new Error(`unknown density code ${(first >> 5) & 3}`);
	}
	const { sectorSize, sectorCount } = geometry;
	const image = createBlankAtr({ sectorSize, sectorCount });
	const header = 16;

	// Two different notions of a sector's size, and conflating them is the
	// trap here. An ATR stores sectors 1-3 of a double-density disk in 128
	// bytes; what a DCM block carries for them is a separate question, and
	// the answer is the full sector.
	const storedSize = (sector: number): number =>
		sectorSize === 256 && sector <= 3 ? 128 : sectorSize;
	const carriedSize = (sector: number): number =>
		shortBoot ? storedSize(sector) : sectorSize;
	const offsetOf = (sector: number): number =>
		sectorSize === 256 && sector > 3
			? header + 384 + (sector - 4) * 256
			: header + (sector - 1) * 128;

	const buffer = new Uint8Array(sectorSize);
	const blockCounts: Record<number, number> = {};
	let passes = 0;
	let done = false;

	while (!done) {
		need(4, "pass header");
		const type = byte();
		if (type !== PASS_F9 && type !== PASS_FA) {
			throw new Error(
				`expected a pass header at byte ${at - 1}, found $${type
					.toString(16)
					.padStart(2, "0")}`,
			);
		}
		const flags = byte();
		if (DENSITIES[(flags >> 5) & 3] !== geometry) {
			throw new Error(
				`pass ${passes + 1} changes density part way through the image`,
			);
		}
		const lastPass = (flags & 0x80) !== 0;
		let sector = byte() | (byte() << 8);
		passes++;

		for (;;) {
			need(1, "block");
			const code = byte();
			const kind = code & 0x7f;
			const sequential = (code & 0x80) !== 0;
			blockCounts[kind] = (blockCounts[kind] ?? 0) + 1;

			if (kind === BLOCK_PASS_END) {
				break;
			}
			if (sector < 1 || sector > sectorCount) {
				throw new Error(`block for sector ${sector}, outside the image`);
			}
			const size = carriedSize(sector);

			switch (kind) {
				case BLOCK_CHANGE_BEGIN: {
					// Reversed literals landing at buf[n]..buf[0]; what follows
					// them is either kept or painted over, which is the one
					// place the two reference decoders part company.
					need(1, "change-begin length");
					const n = byte();
					if (keepTail) {
						need(n + 1, "change-begin literals");
						for (let i = n; i >= 0; i--) {
							buffer[i] = byte();
						}
					} else {
						need(n + 1, "change-begin literals");
						const fill = byte();
						buffer.fill(fill);
						for (let i = n - 1; i >= 0; i--) {
							buffer[i] = byte();
						}
					}
					break;
				}
				case BLOCK_DOS_SECTOR: {
					// Rare enough that acvt left it untested; cheap to accept.
					need(5, "DOS sector");
					const head = bytes[at] as number;
					buffer.fill(head, 0, 123);
					for (let i = 123; i < 128; i++) {
						buffer[i] = byte();
					}
					break;
				}
				case BLOCK_COMPRESSED: {
					// Literal and run segments in turn, each given by the
					// offset it ends at.
					let position = 0;
					let literal = true;
					let firstOffset = true;
					while (position < size) {
						need(1, "segment offset");
						const raw = byte();
						const end = firstOffset ? raw : raw === 0 ? 256 : raw;
						firstOffset = false;
						if (end < position || end > size) {
							throw new Error(
								`segment ends at ${end}, out of order in a ${size}-byte sector`,
							);
						}
						if (literal) {
							need(end - position, "segment literals");
							for (let i = position; i < end; i++) {
								buffer[i] = byte();
							}
						} else {
							need(1, "run value");
							buffer.fill(byte(), position, end);
						}
						position = end;
						literal = !literal;
					}
					break;
				}
				case BLOCK_CHANGE_END: {
					need(1, "change-end offset");
					const raw = byte();
					const from = raw === 0 ? 256 : raw;
					if (from > size) {
						throw new Error(`change-end offset ${from} past the sector`);
					}
					need(size - from, "change-end literals");
					for (let i = from; i < size; i++) {
						buffer[i] = byte();
					}
					break;
				}
				case BLOCK_SAME:
					break; // the buffer already holds it
				case BLOCK_UNCOMPRESSED: {
					need(size, "uncompressed sector");
					for (let i = 0; i < size; i++) {
						buffer[i] = byte();
					}
					break;
				}
				default:
					throw new Error(
						`unknown block type $${kind.toString(16).padStart(2, "0")} ` +
							`at byte ${at - 1}`,
					);
			}

			// Only what an ATR has room for: a double-density boot sector
			// carries 256 bytes but is stored in 128.
			image.set(buffer.subarray(0, storedSize(sector)), offsetOf(sector));

			if (sequential) {
				sector++;
			} else {
				need(2, "next sector number");
				sector = byte() | (byte() << 8);
			}
		}

		if (lastPass) {
			done = true;
		} else if (at >= bytes.length) {
			throw new Error(
				"the stream ends after a pass that is not the last - if this is " +
					"one part of a multi-file archive, join the parts first",
			);
		}
	}

	return { bytes: image, sectorSize, sectorCount, passes, blockCounts };
}

/** Decodes a DCM stream and opens the result for sector access. */
export function openDcm(
	bytes: Uint8Array,
	options?: DcmDecodeOptions,
): AtrImage {
	return openAtr(decodeDcm(bytes, options).bytes);
}
