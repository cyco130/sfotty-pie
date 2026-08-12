import { readFile, writeFile } from "node:fs/promises";
import type { AtrImage } from "../atr.ts";
import { openAtariDos, type AtariDosFilesystem } from "../atari-dos.ts";
import { openSpartaDos, type SpartaDosFilesystem } from "../sparta-dos.ts";
import { detectFilesystem } from "../detect.ts";
import { CliError } from "../cli-error.ts";
import { detectImageFormat, type ImageFormat } from "../formats.ts";
import type { FsVariant } from "./fs-option.ts";

export interface OpenedImage {
	filesystem: AtariDosFilesystem | SpartaDosFilesystem;
	medium: AtrImage;
	/** The container it came out of, which is also how it goes back. */
	format: ImageFormat;
}

function isSpartaVariant(
	variant: FsVariant,
): variant is SpartaDosFilesystem["variant"] {
	return variant.startsWith("sdfs");
}

/**
 * Shared front half of the filesystem commands: load the image, open the
 * container, and resolve the filesystem (autodetected, or forced via --fs).
 * A forced variant also decides how the disk's layout is read, so pass it
 * only when the caller means it.
 */
export async function openImageFilesystem(
	image: string,
	fs: "atari" | "sparta" | undefined,
	variantOverride?: FsVariant,
): Promise<OpenedImage> {
	let bytes: Uint8Array;
	try {
		bytes = await readFile(image);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new CliError(`${image}: no such file`);
		}
		throw error;
	}

	const format = detectImageFormat(bytes, image);
	if (format === undefined) {
		throw new CliError(
			`${image}: not an image spift knows (it reads: atr, dcm)`,
		);
	}
	let medium;
	try {
		medium = format.decode(bytes);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new CliError(`${image}: ${message}`);
	}

	let family = fs;
	if (
		family === undefined &&
		variantOverride !== undefined &&
		isSpartaVariant(variantOverride)
	) {
		family = "sparta";
	}
	if (family === undefined && variantOverride === undefined) {
		const detected = detectFilesystem(medium);
		if (detected === undefined) {
			throw new CliError(
				`${image}: no recognizable filesystem (use --fs to override)`,
			);
		}
		return {
			filesystem:
				detected.family === "sparta"
					? openSpartaDos(medium, detected.variant)
					: openAtariDos(medium, detected.variant),
			medium,
			format,
		};
	}

	if (family === "sparta") {
		const variant =
			variantOverride !== undefined && isSpartaVariant(variantOverride)
				? variantOverride
				: undefined;
		return { filesystem: openSpartaDos(medium, variant), medium, format };
	}
	const variant =
		variantOverride !== undefined && !isSpartaVariant(variantOverride)
			? variantOverride
			: undefined;
	return { filesystem: openAtariDos(medium, variant), medium, format };
}

/**
 * Writes an image back in the format it was read from. A format spift can
 * only decode says so here rather than at the point of no return, and
 * points at the way through.
 */
export async function saveImage(
	path: string,
	opened: Pick<OpenedImage, "medium" | "format">,
): Promise<void> {
	if (opened.format.encode === undefined) {
		throw new CliError(
			`${path}: spift reads ${opened.format.name} but does not write it - ` +
				`convert it to an atr first (spift convert -i ${path} out.atr)`,
		);
	}
	await writeFile(path, opened.format.encode(opened.medium));
}
