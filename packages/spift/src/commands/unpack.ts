import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { AtariDosVariant } from "../atari-dos.ts";
import { extractBootSectors } from "../boot-sectors.ts";
import { CliError, UsageError } from "../cli-error.ts";
import { copyEntries } from "../copy.ts";
import { openHostDirectory } from "../host-dir.ts";
import { parseFsOption } from "./fs-option.ts";
import { openImageFilesystem } from "./open-image.ts";
import { BOOT_FILE } from "./pack.ts";

export interface UnpackArgs {
	image: string;
	directory: string;
	fs: "atari" | "sparta" | undefined;
	variant: AtariDosVariant | undefined;
	extractBootSectors: boolean;
	force: boolean;
}

export function parseUnpackArgs(args: string[]): UnpackArgs {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: {
				image: { type: "string", short: "i" },
				fs: { type: "string" },
				"extract-boot-sectors": { type: "boolean" },
				force: { type: "boolean", short: "f" },
			},
			allowPositionals: true,
		});
	} catch (error) {
		throw new UsageError(
			error instanceof Error ? error.message : String(error),
		);
	}
	const { values, positionals } = parsed;

	const [directory = ".", ...extra] = positionals;
	const image = values.image;
	if (image === undefined) {
		throw new UsageError("missing --image (-i)");
	}
	if (extra.length > 0) {
		throw new UsageError(`unexpected argument "${extra[0]}"`);
	}

	const selection =
		values.fs === undefined ? undefined : parseFsOption(values.fs, "--fs");

	return {
		image,
		directory,
		fs: selection?.family,
		variant: selection?.variant,
		extractBootSectors: values["extract-boot-sectors"] ?? false,
		force: values.force ?? false,
	};
}

export async function unpackCommand(args: string[]): Promise<void> {
	const parsed = parseUnpackArgs(args);
	const { filesystem, medium } = await openImageFilesystem(
		parsed.image,
		parsed.fs,
		parsed.variant,
	);

	// The destination is made on demand, as extracting into one that is not
	// there yet always did.
	await mkdir(parsed.directory, { recursive: true });
	const target = openHostDirectory(parsed.directory);

	let result;
	try {
		// "*.*" is the whole disk in native wildcard terms - "*" alone would
		// match only the names with no extension.
		result = copyEntries(filesystem, target, {
			sources: ["*.*"],
			destination: "/",
			recursive: true,
			force: parsed.force,
			noAttributes: false,
			move: false,
		});
	} catch (error) {
		if (error instanceof CliError) {
			throw error;
		}
		throw new CliError(error instanceof Error ? error.message : String(error));
	}

	// The boot record is not a file on the disk, so it travels beside the
	// files as one of ours. Dot-prefixed, which is also why a later pack does
	// not mistake it for content: nothing lists it.
	let bootBytes;
	if (parsed.extractBootSectors) {
		// A disk that claims no boot sectors has no boot record to keep - any
		// image mkfs made without one says so - and that is not a reason to
		// refuse the files. A count that is merely wrong is odd enough to be
		// worth stopping for.
		if ((medium.readSector(1)?.[1] ?? 0) === 0) {
			process.stderr.write(
				`spift: ${parsed.image}: no boot record, ${BOOT_FILE} not written\n`,
			);
		} else {
			try {
				bootBytes = extractBootSectors(medium).bytes;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new CliError(`${parsed.image}: ${message}`);
			}
		}
	}

	await target.commit();
	if (bootBytes !== undefined) {
		await writeFile(join(parsed.directory, BOOT_FILE), bootBytes, {
			flag: parsed.force ? "w" : "wx",
		}).catch((error: NodeJS.ErrnoException) => {
			if (error.code === "EEXIST") {
				throw new CliError(
					`${join(parsed.directory, BOOT_FILE)} already exists, not ` +
						`overwriting (use --force)`,
				);
			}
			throw error;
		});
	}

	let damaged = false;
	for (const file of result.files) {
		for (const diagnostic of file.diagnostics) {
			process.stderr.write(`spift: ${file.from}: ${diagnostic}\n`);
			damaged = true;
		}
	}
	const boot =
		bootBytes === undefined
			? ""
			: `, boot record to ${BOOT_FILE} (${bootBytes.length} bytes)`;
	process.stdout.write(
		`unpacked ${result.files.length} file(s) from ${parsed.image} into ` +
			`${parsed.directory}${boot}\n`,
	);
	if (damaged) {
		process.exitCode = 1;
	}
}
