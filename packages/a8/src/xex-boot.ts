import type { AtrImage } from "./atr.ts";
import { buildLoaderBootDisk } from "./boot-disk.ts";
import { XEX_LOADER } from "./xex-loader-bytes.ts";

/**
 * Wrap an XEX binary in a bootable in-memory disk: a single-density ATR whose
 * sectors 1-3 are the XEX boot loader (with the file size patched in) and
 * whose remaining sectors are the file's raw bytes. Booting the disk loads
 * and runs the executable, INITAD/RUNAD protocol included.
 */
export function buildBootDisk(xex: Uint8Array): AtrImage {
	return buildLoaderBootDisk(XEX_LOADER, xex);
}
