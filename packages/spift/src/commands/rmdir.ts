import { parseArgs } from "node:util";
import { CliError, UsageError } from "../cli-error.ts";
import { parseFsOption, type FsVariant } from "./fs-option.ts";
import { openImageFilesystem, saveImage } from "./open-image.ts";

export interface RmdirArgs {
	image: string;
	paths: string[];
	fs: "atari" | "sparta" | undefined;
	variant: FsVariant | undefined;
}

export function parseRmdirArgs(args: string[]): RmdirArgs {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: {
				image: { type: "string", short: "i" },
				fs: { type: "string" },
			},
			allowPositionals: true,
		});
	} catch (error) {
		throw new UsageError(
			error instanceof Error ? error.message : String(error),
		);
	}
	const { values, positionals } = parsed;

	const paths = positionals;
	const image = values.image;
	if (image === undefined) {
		throw new UsageError("missing --image (-i)");
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
	const opened = await openImageFilesystem(
		parsed.image,
		parsed.fs,
		parsed.variant,
	);
	const { filesystem } = opened;

	for (const path of parsed.paths) {
		try {
			filesystem.removeDirectory(path);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new CliError(`${path}: ${message}`);
		}
		process.stdout.write(`removed ${path}\n`);
	}
	await saveImage(parsed.image, opened);
}
