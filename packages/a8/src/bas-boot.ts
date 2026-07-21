import type { AtrImage } from "./atr.ts";
import { BAS_LOADER } from "./bas-loader-bytes.ts";
import { buildLoaderBootDisk } from "./boot-disk.ts";

/**
 * Wrap a tokenized (SAVEd) BASIC program in a bootable in-memory disk: a
 * single-density ATR whose sectors 1-3 are the BASIC boot loader (with the
 * file size patched in) and whose remaining sectors are the file's raw bytes.
 * Booting the disk with the BASIC cartridge present installs a B: device
 * serving those bytes and types `RUN "B:"` into BASIC.
 */
export function buildBasicBootDisk(bas: Uint8Array): AtrImage {
	return buildLoaderBootDisk(BAS_LOADER, bas);
}
