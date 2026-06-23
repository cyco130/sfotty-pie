/**
 * An ATR disk image.
 *
 * Layout: a 16-byte header ($96 $02 magic, image size in 16-byte paragraphs,
 * sector size) followed by raw sector data. On double-density (256-byte
 * sector) images the first three sectors — the boot sectors, which the drive
 * always transfers as 128 bytes — are usually stored as 128 bytes, but some
 * tools store them as full 256-byte slots; both layouts are detected by the
 * data length's remainder.
 *
 * Sectors are mutable ({@link writeSector}); writes land in the same backing
 * buffer {@link toBytes} hands back, so a modified image round-trips to a
 * fresh `.atr` byte-for-byte (header included). `writeProtected` models the
 * disk's write-protect notch — a property of the medium; a protected image
 * rejects writes. (For a synthetic disk this is policy, not a real notch —
 * see {@link ./xex-boot.ts}.)
 */
export class AtrImage {
	readonly sectorSize: 128 | 256;
	readonly sectorCount: number;
	readonly writeProtected: boolean;

	// The full image (header + data); #data views the data region of the same
	// buffer, so writes through #data are visible in #raw and thus toBytes().
	readonly #raw: Uint8Array;
	readonly #data: Uint8Array;
	// Whether sectors 1-3 occupy 128-byte slots on a double-density image.
	readonly #boot128: boolean;

	constructor(
		contents: Uint8Array,
		options: { writeProtected?: boolean } = {},
	) {
		if (contents.length < 16 || contents[0] !== 0x96 || contents[1] !== 0x02) {
			throw new Error("Not an ATR image");
		}

		const sectorSize = contents[4]! | (contents[5]! << 8);
		if (sectorSize !== 128 && sectorSize !== 256) {
			throw new Error(`Unsupported ATR sector size (${sectorSize})`);
		}

		this.sectorSize = sectorSize;
		this.writeProtected = options.writeProtected ?? false;
		this.#raw = contents;
		this.#data = contents.subarray(16);

		const length = this.#data.length;
		if (sectorSize === 128) {
			this.#boot128 = false;
			this.sectorCount = Math.floor(length / 128);
		} else {
			this.#boot128 = length % 256 === 128;
			this.sectorCount = this.#boot128
				? Math.floor((length - 384) / 256) + 3
				: Math.floor(length / 256);
		}

		if (this.sectorCount < 1) {
			throw new Error("ATR image has no sectors");
		}
	}

	// The data-region offset and transfer length of a 1-based sector, or null
	// when out of range. Boot sectors (1-3) always transfer 128 bytes; on a
	// double-density image they occupy 128- or 256-byte slots per #boot128.
	#locate(sector: number): { offset: number; length: number } | null {
		if (sector < 1 || sector > this.sectorCount) return null;

		if (this.sectorSize === 128) {
			return { offset: (sector - 1) * 128, length: 128 };
		}

		if (sector <= 3) {
			return {
				offset: (sector - 1) * (this.#boot128 ? 128 : 256),
				length: 128,
			};
		}

		const offset = this.#boot128
			? 384 + (sector - 4) * 256
			: (sector - 1) * 256;
		return { offset, length: 256 };
	}

	/**
	 * The contents of a sector (1-based), or `null` when out of range. The
	 * boot sectors (1-3) are 128 bytes even on double-density images, like
	 * the bytes a real drive would transfer. The result is a live view into
	 * the backing buffer.
	 */
	readSector(sector: number): Uint8Array | null {
		const loc = this.#locate(sector);
		if (!loc) return null;
		return this.#data.subarray(loc.offset, loc.offset + loc.length);
	}

	/**
	 * Overwrite a sector (1-based) with `data`, copying up to the sector's
	 * transfer length (extra bytes are ignored, short writes leave the tail
	 * untouched). Returns `false` when the sector is out of range. The caller
	 * is responsible for the write-protect check; this writes regardless.
	 */
	writeSector(sector: number, data: ArrayLike<number>): boolean {
		const loc = this.#locate(sector);
		if (!loc) return false;
		const n = Math.min(loc.length, data.length);
		for (let i = 0; i < n; i++) this.#data[loc.offset + i] = data[i]! & 0xff;
		return true;
	}

	/** The full image bytes (header + data), reflecting any writes. */
	toBytes(): Uint8Array {
		return this.#raw;
	}
}
