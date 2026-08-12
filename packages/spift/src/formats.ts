// Which container a file is, and how to get sectors out of it.
//
// Formats divide into kinds, and only the first is interchangeable with the
// others in it: plain sector images (ATR, DCM, and XFD when it lands) hold
// exactly the sectors and nothing else, so converting between them loses
// nothing. Protection-preserving images (ATX, PRO) carry per-sector status,
// duplicate sectors and timing, so they are a superset and converting one
// to an ATR discards what makes it worth having; those are not sector
// images and will not simply join this list.

import { openAtr, type AtrImage } from "./atr.ts";
import { decodeDcm, isDcm, type DcmDecodeOptions } from "./dcm.ts";

export interface ImageFormat {
	readonly name: string;
	/** Lower-case, no dot. The first is what convert writes by default. */
	readonly extensions: readonly string[];
	/** True when the bytes look like this format. */
	detect(bytes: Uint8Array): boolean;
	decode(bytes: Uint8Array): AtrImage;
	/**
	 * The file's own bytes for an image that came from this format, or
	 * undefined when spift cannot write it. Decoding is enough to read and
	 * to convert; writing DCM would mean an encoder nobody needs yet.
	 */
	encode?(image: AtrImage): Uint8Array;
}

export const ATR_FORMAT: ImageFormat = {
	name: "atr",
	extensions: ["atr"],
	detect: (bytes) =>
		bytes.length >= 16 && bytes[0] === 0x96 && bytes[1] === 0x02,
	decode: (bytes) => openAtr(bytes),
	// An ATR is a header over the sectors, which is what we hold in memory.
	encode: (image) => image.bytes,
};

export function dcmFormat(options?: DcmDecodeOptions): ImageFormat {
	return {
		name: "dcm",
		// DiskComm's own extension, plus the .dc3 one collection uses; the
		// files are structurally identical.
		extensions: ["dcm", "dc3"],
		detect: isDcm,
		decode: (bytes) => openAtr(decodeDcm(bytes, options).bytes),
	};
}

export const IMAGE_FORMATS: readonly ImageFormat[] = [ATR_FORMAT, dcmFormat()];

export function formatByName(name: string): ImageFormat | undefined {
	const wanted = name.toLowerCase();
	return IMAGE_FORMATS.find(
		(format) => format.name === wanted || format.extensions.includes(wanted),
	);
}

/** The format a file name suggests, by extension alone. */
export function formatByExtension(path: string): ImageFormat | undefined {
	const dot = path.lastIndexOf(".");
	return dot === -1 ? undefined : formatByName(path.slice(dot + 1));
}

/**
 * What these bytes are. Content decides; a name is only a tie-breaker,
 * since a DCM called .atr is still a DCM.
 */
export function detectImageFormat(
	bytes: Uint8Array,
	path?: string,
): ImageFormat | undefined {
	const suggested = path === undefined ? undefined : formatByExtension(path);
	if (suggested?.detect(bytes) === true) {
		return suggested;
	}
	return IMAGE_FORMATS.find((format) => format.detect(bytes));
}
