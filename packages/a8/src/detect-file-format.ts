export type AtariFileFormat =
	| "xex"
	| "atr"
	| "raw-cart-8k-8000-9fff"
	| "raw-cart-8k-a000-bfff"
	| "raw-cart-16k"
	| "cart"
	| "os-rom-10k"
	| "os-rom-16k";

export function detectFileFormat(
	contents: Uint8Array,
	name?: string,
): AtariFileFormat | null {
	if (
		(!name || name.match(/\.atr$/i)) &&
		contents[0] === 0x96 &&
		contents[1] === 0x02
	) {
		return "atr";
	}

	if (
		(!name || name.match(/\.(?:xex|axe|exe|com|obj|bin|obx)$/i)) &&
		contents[0] === 0xff &&
		contents[1] === 0xff
	) {
		return "xex";
	}

	if (!name || name.match(/\.(?:rom|bin|raw)$/i)) {
		const cartType = getRawCartType(contents);
		if (cartType) {
			return cartType;
		}
	}

	if ((!name || name.match(/\.(?:rom|bin)$/i)) && isOsRom(contents)) {
		return contents.length === 16384 ? "os-rom-16k" : "os-rom-10k";
	}

	if (
		(!name || name.match(/\.car$/i)) &&
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

	return null;
}

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

		// Otherwise the init address picks the space, and the start address —
		// when used — must agree with it.
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
