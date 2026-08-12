import { parseArgs } from "node:util";
import {
	readAtariDosFilePointer,
	writeAtariDosFilePointer,
} from "../atari-dos.ts";
import {
	readSpartaDosFilePointer,
	writeSpartaDosFilePointer,
} from "../sparta-dos.ts";
import { CliError, UsageError } from "../cli-error.ts";
import { parseFsOption, type FsVariant } from "./fs-option.ts";
import { openImageFilesystem, saveImage } from "./open-image.ts";

export interface SetDosFileArgs {
	image: string;
	name: string | undefined;
	fs: "atari" | "sparta" | undefined;
	variant: FsVariant | undefined;
	clear: boolean;
}

export function parseSetDosFileArgs(args: string[]): SetDosFileArgs {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: {
				image: { type: "string", short: "i" },
				fs: { type: "string" },
				clear: { type: "boolean" },
			},
			allowPositionals: true,
		});
	} catch (error) {
		throw new UsageError(
			error instanceof Error ? error.message : String(error),
		);
	}
	const { values, positionals } = parsed;

	const [name, ...extra] = positionals;
	const image = values.image;
	if (image === undefined) {
		throw new UsageError("missing --image (-i)");
	}
	if (extra.length > 0) {
		throw new UsageError(`unexpected argument "${extra[0]}"`);
	}
	if (values.clear === true && name !== undefined) {
		throw new UsageError("--clear takes no file name");
	}

	const selection =
		values.fs === undefined ? undefined : parseFsOption(values.fs, "--fs");

	return {
		image,
		name,
		fs: selection?.family,
		variant: selection?.variant,
		clear: values.clear ?? false,
	};
}

export async function setDosFileCommand(args: string[]): Promise<void> {
	const parsed = parseSetDosFileArgs(args);
	const opened = await openImageFilesystem(
		parsed.image,
		parsed.fs,
		parsed.variant,
	);
	const { filesystem, medium } = opened;

	const readPointer = (): number =>
		filesystem.family === "sparta"
			? readSpartaDosFilePointer(medium)
			: readAtariDosFilePointer(medium, filesystem.variant);
	const writePointer = (sector: number): void => {
		if (filesystem.family === "sparta") {
			writeSpartaDosFilePointer(medium, sector);
		} else {
			writeAtariDosFilePointer(medium, filesystem.variant, sector);
		}
	};

	if (parsed.clear) {
		writePointer(0);
		await saveImage(parsed.image, opened);
		process.stdout.write(`${parsed.image} will no longer boot\n`);
		return;
	}

	// Atari DOS disks all boot a file called DOS.SYS; a SpartaDOS boot file
	// can be named anything (X32G.DOS, XBW130.DOS, ...), so there is no
	// default worth guessing.
	if (parsed.name === undefined && filesystem.family === "sparta") {
		throw new UsageError(
			"name the file to boot: SpartaDOS has no conventional DOS file name",
		);
	}
	// The boot loader follows the sector map wherever the file lives, so a
	// path into a subdirectory (SpartaDOS) is as bootable as a root file.
	const wanted = (parsed.name ?? "dos.sys").toLowerCase();
	let candidates;
	try {
		candidates = [...filesystem.entries(wanted, { listContents: false })];
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new CliError(`${parsed.image}: ${message}`);
	}
	const entry = candidates.find((candidate) => candidate.kind === "file");
	// startSector is what the boot record points at, so an entry without one
	// (a store with no sectors) could never be booted from anyway.
	if (entry?.startSector === undefined) {
		throw new CliError(`${parsed.image}: no file named ${wanted} to boot from`);
	}
	const start = entry.startSector;

	const previous = readPointer();
	writePointer(start);
	await saveImage(parsed.image, opened);
	const change =
		previous === start
			? " (unchanged)"
			: previous === 0
				? ""
				: ` (was sector ${previous})`;
	process.stdout.write(
		`${parsed.image} boots ${entry.name} from sector ` + `${start}${change}\n`,
	);
}
