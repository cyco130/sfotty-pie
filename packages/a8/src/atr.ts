/**
 * An ATR disk image.
 *
 * Layout: a 16-byte header ($96 $02 magic, image size in 16-byte paragraphs,
 * sector size) followed by raw sector data. On double-density (256-byte
 * sector) images the first three sectors - the boot sectors, which the drive
 * always transfers as 128 bytes - are usually stored as 128 bytes, but some
 * tools store them as full 256-byte slots; both layouts are detected by the
 * data length's remainder.
 *
 * Sectors are mutable ({@link writeSector}); writes land in the same backing
 * buffer {@link toBytes} hands back, so a modified image round-trips to a
 * fresh `.atr` byte-for-byte (header included). `writeProtected` models the
 * disk's write-protect notch - a property of the medium; a protected image
 * rejects writes. (For a synthetic disk this is policy, not a real notch -
 * see {@link ./xex-boot.ts}.)
 */
export class AtrImage {
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

		this.#sectorSize = sectorSize;
		this.writeProtected = options.writeProtected ?? false;
		this.#raw = contents;
		this.#data = contents.subarray(16);

		const length = this.#data.length;
		if (sectorSize === 128) {
			this.#boot128 = false;
			this.#sectorCount = Math.floor(length / 128);
		} else {
			this.#boot128 = length % 256 === 128;
			this.#sectorCount = this.#boot128
				? Math.floor((length - 384) / 256) + 3
				: Math.floor(length / 256);
		}

		if (this.#sectorCount < 1) {
			throw new Error("ATR image has no sectors");
		}
	}

	get sectorSize(): 128 | 256 {
		return this.#sectorSize;
	}

	get sectorCount(): number {
		return this.#sectorCount;
	}
	/** The write-protect notch: mutable, like flipping the tab on a real
	 *  disk - hosts may toggle it on a mounted image. */
	writeProtected: boolean;

	/** Set when a sector write lands - the "unsaved changes" sense. Hosts
	 *  clear it after persisting the image; the machine never reads it. */
	dirty = false;

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
		this.dirty = true;
		return true;
	}

	/** The full image bytes (header + data), reflecting any writes. */
	toBytes(): Uint8Array {
		return this.#raw;
	}

	/**
	 * Reformat the medium in place: new geometry, every sector zeroed, a
	 * fresh backing buffer - but the same object identity, like a real disk
	 * staying in the drive through a format. The caller is responsible for
	 * the write-protect check, as with {@link writeSector}. Double-density
	 * images get the customary 128-byte boot-sector slots.
	 */
	format(sectorSize: 128 | 256, sectorCount: number): void {
		if (sectorCount < 1 || sectorCount > 0xffff) {
			throw new Error(`Bad sector count (${sectorCount})`);
		}
		const bootSlots = sectorSize === 256 ? Math.min(sectorCount, 3) : 0;
		const dataSize =
			sectorSize === 256
				? bootSlots * 128 + (sectorCount - bootSlots) * 256
				: sectorCount * 128;
		const raw = new Uint8Array(16 + dataSize);
		const paragraphs = dataSize / 16;
		raw[0] = 0x96;
		raw[1] = 0x02;
		raw[2] = paragraphs & 0xff;
		raw[3] = (paragraphs >> 8) & 0xff;
		raw[4] = sectorSize & 0xff;
		raw[5] = sectorSize >> 8;
		raw[6] = (paragraphs >> 16) & 0xff;
		this.#raw = raw;
		this.#data = raw.subarray(16);
		this.#sectorSize = sectorSize;
		this.#sectorCount = sectorCount;
		this.#boot128 = sectorSize === 256;
		this.dirty = true;
	}

	#sectorSize: 128 | 256;
	#sectorCount: number;
	// The full image (header + data); #data views the data region of the same
	// buffer, so writes through #data are visible in #raw and thus toBytes().
	#raw: Uint8Array;
	#data: Uint8Array;
	// Whether sectors 1-3 occupy 128-byte slots on a double-density image.
	#boot128: boolean;

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
}
