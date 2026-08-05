import { readFile } from "node:fs/promises";
import { openAtr } from "../atr.ts";
import {
	openAtariDos,
	type AtariDosFilesystem,
	type AtariDosVariant,
} from "../atari-dos.ts";
import { detectFilesystem } from "../detect.ts";
import { CliError } from "../cli-error.ts";

/**
 * Shared front half of the filesystem commands: load the image, open the
 * container, and resolve the filesystem family (autodetected, or forced via
 * --fs).
 */
export async function openImageFilesystem(
	image: string,
	fs: "atari" | "sparta" | undefined,
): Promise<AtariDosFilesystem> {
	let bytes: Uint8Array;
	try {
		bytes = await readFile(image);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new CliError(`${image}: no such file`);
		}
		throw error;
	}

	let medium;
	try {
		medium = openAtr(bytes);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new CliError(`${image}: ${message}`);
	}

	if (fs === "sparta") {
		throw new CliError("SpartaDOS filesystem support is not implemented yet");
	}
	let variant: AtariDosVariant | undefined;
	if (fs === undefined) {
		const detected = detectFilesystem(medium);
		if (detected === undefined) {
			throw new CliError(
				`${image}: no recognizable filesystem (use --fs to override)`,
			);
		}
		if (detected.family === "sparta") {
			throw new CliError(
				`${image}: SpartaDOS filesystem support is not implemented yet`,
			);
		}
		variant = detected.variant;
	}

	return openAtariDos(medium, variant);
}
