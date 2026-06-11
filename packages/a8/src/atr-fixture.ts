/**
 * Test fixture: build an ATR image whose every sector is filled with its own
 * sector number. `boot128` picks between the two double-density layouts
 * (128-byte vs full-size boot sector slots); ignored for single density.
 */
export function makeAtr(
	sectorSize: 128 | 256,
	sectorCount: number,
	boot128 = true,
): Uint8Array {
	const slotSize = (sector: number) =>
		sectorSize === 128 || (boot128 && sector <= 3) ? 128 : 256;

	let dataLength = 0;
	for (let sector = 1; sector <= sectorCount; sector++) {
		dataLength += slotSize(sector);
	}

	const image = new Uint8Array(16 + dataLength);
	const paragraphs = dataLength / 16;
	image[0] = 0x96;
	image[1] = 0x02;
	image[2] = paragraphs & 0xff;
	image[3] = (paragraphs >> 8) & 0xff;
	image[4] = sectorSize & 0xff;
	image[5] = sectorSize >> 8;
	image[6] = (paragraphs >> 16) & 0xff;

	let offset = 16;
	for (let sector = 1; sector <= sectorCount; sector++) {
		image.fill(sector & 0xff, offset, offset + slotSize(sector));
		offset += slotSize(sector);
	}

	return image;
}
