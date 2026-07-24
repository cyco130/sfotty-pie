import { AtrImage } from "./atr.ts";

// Where the loaders' 24-bit `file_size` lives: right after the 6-byte boot
// header and the 2-byte boot-continuation entry (clc, rts). Both loaders
// share this prelude; the boot tests pin it against the assembled bytes.
export const FILE_SIZE_OFFSET = 8;

/**
 * Wrap a file in a bootable in-memory disk: a single-density ATR whose
 * leading sectors are `loader` (with the file's size patched into its 24-bit
 * `file_size` field) and whose remaining sectors are the file's raw bytes.
 * The loader is a whole number of sectors (the format macro pads it), and
 * its own `sector` variable points just past itself, so the file placement
 * here and the loader's read position agree by construction.
 */
export function buildLoaderBootDisk(
	loader: Uint8Array,
	file: Uint8Array,
): AtrImage {
	const loaderSectors = loader.length / 128;
	const dataSectors = Math.ceil(file.length / 128);
	if (file.length === 0 || loaderSectors + dataSectors > 0xffff) {
		throw new Error("File size out of range");
	}

	const image = new Uint8Array(16 + loader.length + dataSectors * 128);

	// The ATR header
	const paragraphs = (image.length - 16) / 16;
	image[0] = 0x96;
	image[1] = 0x02;
	image[2] = paragraphs & 0xff;
	image[3] = (paragraphs >> 8) & 0xff;
	image[4] = 128;
	image[6] = (paragraphs >> 16) & 0xff;

	// The loader, with the file's size patched in
	image.set(loader, 16);
	image[16 + FILE_SIZE_OFFSET] = file.length & 0xff;
	image[16 + FILE_SIZE_OFFSET + 1] = (file.length >> 8) & 0xff;
	image[16 + FILE_SIZE_OFFSET + 2] = (file.length >> 16) & 0xff;

	// The file itself, from the first sector past the loader
	image.set(file, 16 + loader.length);

	// Synthetic boot disk: write-protected so a program can't scribble on its
	// own loader (and so it's never offered for download as a "disk").
	return new AtrImage(image, { writeProtected: true });
}
