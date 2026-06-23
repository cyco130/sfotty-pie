import { AtrImage } from "./atr.ts";
import { XEX_LOADER } from "./xex-loader-bytes.ts";

// Where the loader's 24-bit `file_size` lives: right after the 6-byte boot
// header and the 2-byte boot-continuation entry (clc, rts). The xex-boot
// tests pin this against the assembled bytes.
export const FILE_SIZE_OFFSET = 8;

/**
 * Wrap an XEX binary in a bootable in-memory disk: a single-density ATR whose
 * sectors 1-3 are the XEX boot loader (with the file size patched in) and
 * whose remaining sectors are the file's raw bytes. Booting the disk loads
 * and runs the executable, INITAD/RUNAD protocol included.
 */
export function buildBootDisk(xex: Uint8Array): AtrImage {
	const dataSectors = Math.ceil(xex.length / 128);
	if (xex.length === 0 || 3 + dataSectors > 0xffff) {
		throw new Error("Executable size out of range");
	}

	const image = new Uint8Array(16 + 384 + dataSectors * 128);

	// The ATR header
	const paragraphs = (image.length - 16) / 16;
	image[0] = 0x96;
	image[1] = 0x02;
	image[2] = paragraphs & 0xff;
	image[3] = (paragraphs >> 8) & 0xff;
	image[4] = 128;
	image[6] = (paragraphs >> 16) & 0xff;

	// The loader, with the executable's size patched in
	image.set(XEX_LOADER, 16);
	image[16 + FILE_SIZE_OFFSET] = xex.length & 0xff;
	image[16 + FILE_SIZE_OFFSET + 1] = (xex.length >> 8) & 0xff;
	image[16 + FILE_SIZE_OFFSET + 2] = (xex.length >> 16) & 0xff;

	// The executable itself, from sector 4 on
	image.set(xex, 16 + 384);

	// Synthetic boot disk: write-protected so a program can't scribble on its
	// own loader (and so it's never offered for download as a "disk").
	return new AtrImage(image, { writeProtected: true });
}
