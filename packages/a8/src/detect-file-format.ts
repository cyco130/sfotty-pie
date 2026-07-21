export type AtariFileFormat =
	| "xex"
	| "atr"
	| "bas"
	| "raw-cart-8k-8000-9fff"
	| "raw-cart-8k-a000-bfff"
	| "raw-cart-16k"
	| "cart"
	| "os-rom-10k"
	| "os-rom-16k"
	| "xegs-rom-32k";

/**
 * Whether a filename's extension is one any detector accepts - a cheap,
 * name-only pre-filter (the content check still confirms the actual format). Use
 * it to skip clearly-irrelevant files (e.g. the PNGs in a ROM archive) before
 * reading them when bulk-importing a directory.
 */
export function hasKnownExtension(name: string): boolean {
	return KNOWN_RE.test(name);
}

/**
 * Whether a filename has a raw-ROM-dump extension (`.rom`/`.bin`/`.raw`).
 * Used by canonicalize to decide that an undetected file may still be a
 * cartridge dump of unknown type.
 */
export function hasRawRomExtension(name: string): boolean {
	return RAW_ROM_RE.test(name);
}

export function detectFileFormat(
	contents: Uint8Array,
	name?: string,
): AtariFileFormat | null {
	if (
		(!name || ATR_RE.test(name)) &&
		contents[0] === 0x96 &&
		contents[1] === 0x02
	) {
		return "atr";
	}

	if (
		(!name || XEX_RE.test(name)) &&
		contents[0] === 0xff &&
		contents[1] === 0xff
	) {
		return "xex";
	}

	if (!name || RAW_ROM_RE.test(name)) {
		const cartType = getRawCartType(contents);
		if (cartType) {
			return cartType;
		}

		if (isOsRom(contents)) {
			return contents.length === 16384 ? "os-rom-16k" : "os-rom-10k";
		}

		// The XEGS internal ROM is a 32K dump laid out as two 8K $A000-$BFFF
		// carts (the built-in game and BASIC) followed by the 16K XL/XE OS.
		// Detect it structurally from its pieces rather than by signature.
		if (
			contents.length === 32768 &&
			getRawCartType(contents.subarray(0, 0x2000)) ===
				"raw-cart-8k-a000-bfff" &&
			getRawCartType(contents.subarray(0x2000, 0x4000)) ===
				"raw-cart-8k-a000-bfff" &&
			isOsRom(contents.subarray(0x4000, 0x8000))
		) {
			return "xegs-rom-32k";
		}
	}

	if (
		(!name || CAR_RE.test(name)) &&
		contents[0] === 0x43 && // 'C'
		contents[1] === 0x41 && // 'A'
		contents[2] === 0x52 && // 'R'
		contents[3] === 0x54 // 'T'
	) {
		return "cart";
		// first 4 bytes containing 'C' 'A' 'R' 'T'.
		// next 4 bytes containing cartridge type in MSB format (see the table below).
		// next 4 bytes containing cartridge checksum in MSB format (ROM only).
		// next 4 bytes are currently unused (zero).
		// followed immediately with the ROM data: 2, 4, 8, 16, 32, 40, etc. kilobytes.
	}

	// A tokenized (SAVEd) BASIC program. The `.bas` extension is required on
	// top of the structural check: the signature is weak for nameless blobs.
	if (name !== undefined && BAS_RE.test(name) && isBasicProgram(contents)) {
		return "bas";
	}

	return null;
}

// The seven-word .bas header: zero-page table pointers (LOMEM..STARP), each
// stored LSB-first relative to LOMEM. Checks validated against a 400+ file
// corpus loaded in real BASIC:
// - the first word (LOMEM itself) is always 0;
// - VNTP is at least 256 (it grows by 16 per BASIC Rev. B save/load cycle;
//   no upper bound is enforced pending further research);
// - the table pointers ascend (STMCUR excluded: stored but unused by LOAD,
//   and junk in many circulating files);
// - BASIC's LOAD reads exactly STARP-256 body bytes, so a shorter file
//   cannot load on real hardware (LOAD hits EOF and silently NEWs) - files
//   trimmed to the intuitive-but-wrong STARP-VNTP size are refused here on
//   purpose. Trailing bytes beyond the demand are ignored by LOAD and
//   tolerated here.
function isBasicProgram(contents: Uint8Array): boolean {
	if (contents.length < 14) {
		return false;
	}
	const word = (i: number) => contents[i]! | (contents[i + 1]! << 8);
	const [lomem, vntp, vntd, vvtp, stmtab, , starp] = Array.from(
		{ length: 7 },
		(_, i) => word(i * 2),
	) as [number, number, number, number, number, number, number];
	return (
		lomem === 0 &&
		vntp >= 256 &&
		vntp <= vntd &&
		vntd <= vvtp &&
		vvtp <= stmtab &&
		stmtab <= starp &&
		contents.length >= 14 + starp - 256
	);
}

// Filename extensions each detector accepts (the content check still confirms).
// A format matches a named file only when its extension is in its list; a
// nameless blob (e.g. a built-in served raw) matches on content alone.
const ATR = ["atr"];
const XEX = ["xex", "axe", "exe", "com", "obj", "bin", "obx"];
// Tokenized BASIC programs.
const BAS = ["bas"];
// Raw ROM dumps: raw cartridges, OS ROMs, and the XEGS 32K dump.
const RAW_ROM = ["rom", "bin", "raw"];
const CAR = ["car"];

const extMatcher = (exts: readonly string[]): RegExp =>
	new RegExp(`\\.(?:${exts.join("|")})$`, "i");

const ATR_RE = extMatcher(ATR);
const XEX_RE = extMatcher(XEX);
const BAS_RE = extMatcher(BAS);
const RAW_ROM_RE = extMatcher(RAW_ROM);
const CAR_RE = extMatcher(CAR);

// The union of every accepted extension, derived from the lists above so it
// can't drift out of sync.
const KNOWN_RE = extMatcher([
	...new Set([...ATR, ...XEX, ...BAS, ...RAW_ROM, ...CAR]),
]);

function getRawCartType(
	contents: Uint8Array,
): null | "raw-cart-8k-8000-9fff" | "raw-cart-8k-a000-bfff" | "raw-cart-16k" {
	const length = contents.length;

	if ((length !== 8192 && length !== 16384) || contents[length - 4] !== 0) {
		return null;
	}

	const startAddress =
		contents[contents.length - 6]! | (contents[contents.length - 5]! << 8);
	const flags = contents[contents.length - 3]!;
	const initAddress =
		contents[contents.length - 2]! | (contents[contents.length - 1]! << 8);
	const isStartAddressUsed = (flags & 0x04) !== 0;

	if (length === 8192) {
		const hasEmptyInit = (initAddress & 0xff00) === 0xff00;

		const isInitValid =
			// Init address FFxx is always valid (kind of)
			hasEmptyInit ||
			// Otherwise it should be between $8000 and $C000
			(initAddress >= 0x8000 && initAddress < 0xc000);

		if (!isInitValid) {
			return null;
		}

		if (!isStartAddressUsed && hasEmptyInit) {
			// If init address is $FFxx and start address is not used,
			// we can't determine the type of cartridge
			return null;
		}

		if (hasEmptyInit) {
			// If init address is $FFxx, it can be either type
			if (startAddress >= 0x8000 && startAddress < 0xa000) {
				return "raw-cart-8k-8000-9fff";
			} else if (startAddress >= 0xa000 && startAddress < 0xc000) {
				return "raw-cart-8k-a000-bfff";
			}

			return null;
		}

		// Otherwise the init address picks the space, and the start address -
		// when used - must agree with it.
		if (initAddress < 0xa000) {
			if (
				!isStartAddressUsed ||
				(startAddress >= 0x8000 && startAddress < 0xa000)
			) {
				return "raw-cart-8k-8000-9fff";
			}

			return null;
		}

		if (
			!isStartAddressUsed ||
			(startAddress >= 0xa000 && startAddress < 0xc000)
		) {
			return "raw-cart-8k-a000-bfff";
		}

		return null;
	}

	// 16K cartridge
	if (
		// Init address FFxx is always valid (kind of)
		((initAddress & 0xff00) === 0xff00 ||
			// Otherwise it should be between $8000 and $C000
			(initAddress >= 0x8000 && initAddress < 0xc000)) &&
		// If start address is used, it should be between $8000 and $C000
		(!isStartAddressUsed || (startAddress >= 0x8000 && startAddress < 0xc000))
	) {
		return "raw-cart-16k";
	}

	return null;
}

function isOsRom(contents: Uint8Array): boolean {
	const length = contents.length;
	if (length !== 10240 && length !== 16384) {
		return false;
	}

	// The ROM is loaded at this base; jump-table addresses below are absolute,
	// so subtract it to index into `contents`.
	const base = length === 16384 ? 0xc000 : 0xd800;

	const isInRange =
		length === 10240
			? (vector: number) => vector >= 0xd800
			: (vector: number) =>
					vector >= 0xd800 || (vector >= 0xc000 && vector < 0xd000);

	const interruptVectors = [
		contents[length - 6]! + contents[length - 5]! * 256,
		contents[length - 4]! + contents[length - 3]! * 256,
		contents[length - 2]! + contents[length - 1]! * 256,
	];

	if (!interruptVectors.every(isInRange)) {
		return false;
	}

	// 16 jump vectors starting from $e450
	for (let address = 0xe450; address < 0xe480; address += 3) {
		const offset = address - base;
		if (
			contents[offset] !== 0x4c || // JMP
			!isInRange(contents[offset + 1]! + contents[offset + 2]! * 256)
		) {
			return false;
		}
	}

	return true;
}
