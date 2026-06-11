/**
 * An ATR disk image, read-only for now.
 *
 * Layout: a 16-byte header ($96 $02 magic, image size in 16-byte paragraphs,
 * sector size) followed by raw sector data. On double-density (256-byte
 * sector) images the first three sectors — the boot sectors, which the drive
 * always transfers as 128 bytes — are usually stored as 128 bytes, but some
 * tools store them as full 256-byte slots; both layouts are detected by the
 * data length's remainder.
 */
export class AtrImage {
	readonly sectorSize: 128 | 256;
	readonly sectorCount: number;

	readonly #data: Uint8Array;
	// Whether sectors 1-3 occupy 128-byte slots on a double-density image.
	readonly #boot128: boolean;

	constructor(contents: Uint8Array) {
		if (contents.length < 16 || contents[0] !== 0x96 || contents[1] !== 0x02) {
			throw new Error("Not an ATR image");
		}

		const sectorSize = contents[4]! | (contents[5]! << 8);
		if (sectorSize !== 128 && sectorSize !== 256) {
			throw new Error(`Unsupported ATR sector size (${sectorSize})`);
		}

		this.sectorSize = sectorSize;
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

	/**
	 * The contents of a sector (1-based), or `null` when out of range. The
	 * boot sectors (1-3) are 128 bytes even on double-density images, like
	 * the bytes a real drive would transfer.
	 */
	readSector(sector: number): Uint8Array | null {
		if (sector < 1 || sector > this.sectorCount) return null;

		if (this.sectorSize === 128) {
			const offset = (sector - 1) * 128;
			return this.#data.subarray(offset, offset + 128);
		}

		if (sector <= 3) {
			const offset = (sector - 1) * (this.#boot128 ? 128 : 256);
			return this.#data.subarray(offset, offset + 128);
		}

		const offset = this.#boot128
			? 384 + (sector - 4) * 256
			: (sector - 1) * 256;
		return this.#data.subarray(offset, offset + 256);
	}
}
