import { parseArgs } from "node:util";
import type { AtariDosVariant } from "../atari-dos.ts";
import { CliError, UsageError } from "../cli-error.ts";
import { parseFsOption } from "./fs-option.ts";
import { openImageFilesystem, saveImage } from "./open-image.ts";

export interface MkdirArgs {
	image: string;
	paths: string[];
	fs: "atari" | "sparta" | undefined;
	variant: AtariDosVariant | undefined;
	parents: boolean;
}

export function parseMkdirArgs(args: string[]): MkdirArgs {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: {
				image: { type: "string", short: "i" },
				fs: { type: "string" },
				parents: { type: "boolean", short: "p" },
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
		throw new UsageError("missing DIRECTORY to create");
	}

	const selection =
		values.fs === undefined ? undefined : parseFsOption(values.fs, "--fs");

	return {
		image,
		paths,
		fs: selection?.family,
		variant: selection?.variant,
		parents: values.parents ?? false,
	};
}

export async function mkdirCommand(args: string[]): Promise<void> {
	const parsed = parseMkdirArgs(args);
	const opened = await openImageFilesystem(
		parsed.image,
		parsed.fs,
		parsed.variant,
	);
	const { filesystem } = opened;

	// Nothing reaches the disk until every path has been made, so a failure
	// part way through leaves the image as it was - stricter than mkdir -p,
	// which keeps whatever it managed.
	for (const path of parsed.paths) {
		try {
			filesystem.makeDirectory(path, { parents: parsed.parents });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new CliError(`${path}: ${message}`);
		}
		process.stdout.write(`created ${path}\n`);
	}
	await saveImage(parsed.image, opened);
}
