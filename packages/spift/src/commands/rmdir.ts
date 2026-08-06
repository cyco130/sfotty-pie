import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { AtariDosVariant } from "../atari-dos.ts";
import { CliError, UsageError } from "../cli-error.ts";
import { parseFsOption } from "./fs-option.ts";
import { openImageFilesystem } from "./open-image.ts";

export interface RmdirArgs {
	image: string;
	paths: string[];
	fs: "atari" | "sparta" | undefined;
	variant: AtariDosVariant | undefined;
}

export function parseRmdirArgs(args: string[]): RmdirArgs {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: { fs: { type: "string" } },
			allowPositionals: true,
		});
	} catch (error) {
		throw new UsageError(
			error instanceof Error ? error.message : String(error),
		);
	}
	const { values, positionals } = parsed;

	const [image, ...paths] = positionals;
	if (image === undefined) {
		throw new UsageError("missing IMAGE_FILE");
	}
	if (paths.length === 0) {
		throw new UsageError("missing DIRECTORY to remove");
	}

	const selection =
		values.fs === undefined ? undefined : parseFsOption(values.fs, "--fs");

	return {
		image,
		paths,
		fs: selection?.family,
		variant: selection?.variant,
	};
}

export async function rmdirCommand(args: string[]): Promise<void> {
	const parsed = parseRmdirArgs(args);
	const { filesystem, medium } = await openImageFilesystem(
		parsed.image,
		parsed.fs,
		parsed.variant,
	);

	for (const path of parsed.paths) {
		try {
			filesystem.removeDirectory(path);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new CliError(`${path}: ${message}`);
		}
		process.stdout.write(`removed ${path}\n`);
	}
	await writeFile(parsed.image, medium.bytes);
}
