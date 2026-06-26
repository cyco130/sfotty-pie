import {
	type AtariFileFormat,
	detectFileFormat,
} from "./detect-file-format.ts";

// Canonicalization: turn an arbitrary image file into one or more canonical
// images, deriving their content facts. The canonical form per kind:
//
//   cartridge  →  `.car` (16-byte CART header + ROM) — a raw `.rom`/`.bin`
//                 gets the header prepended; the mapper/type lives in the
//                 header, so it becomes part of the content identity.
//   OS / XEX   →  the raw bytes (no container).
//   combined   →  split: an XEGS 32K dump becomes a game cart, a BASIC cart,
//                 and the OS, each canonicalized independently.
//   disk       →  passthrough for now (ATR container-stripping is deferred).
//
// Every piece reports the SOURCE byte range `[from, to)` and the `header` it
// prepends, so a build can keep the bundled file untouched and reconstruct the
// canonical image at fetch time from a `header`/`from`/`to` recipe — while the
// `bytes` are the materialized canonical image for hashing or direct storage.

/** Content-derived facts: a coarse kind plus its one discriminating fact. */
export type ImageKind =
	| { type: "os"; sizeClass: 10 | 16 }
	| { type: "cart"; cartType: number } // the CART-table number = mapper/subtype
	| { type: "disk"; sectorSize: 128 | 256; sectors: number }
	| { type: "xex" };

/** One canonical image produced from a source file. */
export interface CanonicalPiece {
	/** For a split combined dump, which constituent this is. */
	role?: "game" | "basic" | "os";
	/** Byte range `[from, to)` within the source file this piece draws from. */
	from: number;
	to: number;
	/** Bytes prepended to `source[from:to]` to form the canonical image (a CART
	 *  header), or empty when the source slice is already canonical. */
	header: Uint8Array;
	/** The materialized canonical image: `header` ++ `source[from:to]`. */
	bytes: Uint8Array;
	kind: ImageKind;
}

const EMPTY = new Uint8Array(0);

// XEGS internal ROM layout: [8K built-in game][8K BASIC][16K XL/XE OS].
const XEGS_GAME_END = 0x2000;
const XEGS_BASIC_END = 0x4000;
const XEGS_OS_END = 0x8000;

/** The CART type number a raw cartridge format maps to (matches Cartridge). */
const RAW_CART_TYPE: Record<string, number> = {
	"raw-cart-8k-8000-9fff": 21,
	"raw-cart-8k-a000-bfff": 1,
	"raw-cart-16k": 2,
};

function concat(head: Uint8Array, tail: Uint8Array): Uint8Array {
	if (head.length === 0) return tail;
	const out = new Uint8Array(head.length + tail.length);
	out.set(head, 0);
	out.set(tail, head.length);
	return out;
}

/** Build the 16-byte CART header for `rom` under cartridge type `cartType`. */
function cartHeader(cartType: number, rom: Uint8Array): Uint8Array {
	const header = new Uint8Array(16);
	header[0] = 0x43; // 'C'
	header[1] = 0x41; // 'A'
	header[2] = 0x52; // 'R'
	header[3] = 0x54; // 'T'
	header[4] = (cartType >>> 24) & 0xff;
	header[5] = (cartType >>> 16) & 0xff;
	header[6] = (cartType >>> 8) & 0xff;
	header[7] = cartType & 0xff;
	let sum = 0;
	for (const byte of rom) sum = (sum + byte) >>> 0; // 32-bit data checksum (MSB)
	header[8] = (sum >>> 24) & 0xff;
	header[9] = (sum >>> 16) & 0xff;
	header[10] = (sum >>> 8) & 0xff;
	header[11] = sum & 0xff;
	// bytes 12-15 are reserved (zero)
	return header;
}

function cartPiece(
	source: Uint8Array,
	cartType: number,
	from: number,
	to: number,
	role?: CanonicalPiece["role"],
): CanonicalPiece {
	const rom = source.subarray(from, to);
	const header = cartHeader(cartType, rom);
	return {
		role,
		from,
		to,
		header,
		bytes: concat(header, rom),
		kind: { type: "cart", cartType },
	};
}

function osPiece(
	source: Uint8Array,
	sizeClass: 10 | 16,
	from: number,
	to: number,
	role?: CanonicalPiece["role"],
): CanonicalPiece {
	return {
		role,
		from,
		to,
		header: EMPTY,
		bytes: source.subarray(from, to),
		kind: { type: "os", sizeClass },
	};
}

/** An existing `.car` is already canonical; read its type out of the header. */
function carPiece(source: Uint8Array): CanonicalPiece {
	const cartType =
		(((source[4] ?? 0) << 24) |
			((source[5] ?? 0) << 16) |
			((source[6] ?? 0) << 8) |
			(source[7] ?? 0)) >>>
		0;
	return {
		from: 0,
		to: source.length,
		header: EMPTY,
		bytes: source,
		kind: { type: "cart", cartType },
	};
}

/** ATR passthrough — geometry only; container-stripping is deferred. */
function diskPiece(source: Uint8Array): CanonicalPiece {
	const sectorSize =
		((source[4] ?? 0) | ((source[5] ?? 0) << 8)) === 256 ? 256 : 128;
	// Paragraph (16-byte) count → total image bytes; the 128-byte boot-sector
	// quirk on DD disks is ignored until we actually strip the container.
	const paragraphs =
		(source[2] ?? 0) | ((source[3] ?? 0) << 8) | ((source[6] ?? 0) << 16);
	const sectors = Math.floor((paragraphs * 16) / sectorSize);
	return {
		from: 0,
		to: source.length,
		header: EMPTY,
		bytes: source,
		kind: { type: "disk", sectorSize, sectors },
	};
}

/**
 * Canonicalize `source` into one or more canonical images. Throws on an
 * unrecognized format (the caller decides how to surface that).
 */
export function canonicalize(
	source: Uint8Array,
	fileName?: string,
): CanonicalPiece[] {
	const format: AtariFileFormat | null = detectFileFormat(source, fileName);
	switch (format) {
		case "raw-cart-8k-8000-9fff":
		case "raw-cart-8k-a000-bfff":
		case "raw-cart-16k":
			return [cartPiece(source, RAW_CART_TYPE[format]!, 0, source.length)];
		case "cart":
			return [carPiece(source)];
		case "os-rom-10k":
			return [osPiece(source, 10, 0, source.length)];
		case "os-rom-16k":
			return [osPiece(source, 16, 0, source.length)];
		case "xex":
			return [
				{
					from: 0,
					to: source.length,
					header: EMPTY,
					bytes: source,
					kind: { type: "xex" },
				},
			];
		case "atr":
			return [diskPiece(source)];
		case "xegs-rom-32k":
			return [
				cartPiece(source, 1, 0, XEGS_GAME_END, "game"),
				cartPiece(source, 1, XEGS_GAME_END, XEGS_BASIC_END, "basic"),
				osPiece(source, 16, XEGS_BASIC_END, XEGS_OS_END, "os"),
			];
		case null:
			throw new Error("Unrecognized image format");
	}
}
