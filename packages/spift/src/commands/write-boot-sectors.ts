import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { openAtr } from "../atr.ts";
import { writeBootSectors } from "../boot-sectors.ts";
import { CliError, UsageError } from "../cli-error.ts";

export interface WriteBootSectorsArgs {
	image: string;
	file: string;
	pad: boolean;
	force: boolean;
}

export function parseWriteBootSectorsArgs(
	args: string[],
): WriteBootSectorsArgs {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: {
				pad: { type: "boolean" },
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

	const [image, file, ...extra] = positionals;
	if (image === undefined) {
		throw new UsageError("missing IMAGE_FILE");
	}
	if (file === undefined) {
		throw new UsageError("missing BOOT_FILE");
	}
	if (extra.length > 0) {
		throw new UsageError(`unexpected argument "${extra[0]}"`);
	}

	return {
		image,
		file,
		pad: values.pad ?? false,
		force: values.force ?? false,
	};
}

export async function writeBootSectorsCommand(args: string[]): Promise<void> {
	const parsed = parseWriteBootSectorsArgs(args);

	const read = async (path: string): Promise<Uint8Array> => {
		try {
			return await readFile(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw new CliError(`${path}: no such file`);
			}
			throw error;
		}
	};
	const imageBytes = await read(parsed.image);
	const bootBytes = await read(parsed.file);

	let medium;
	try {
		medium = openAtr(imageBytes);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new CliError(`${parsed.image}: ${message}`);
	}

	let result;
	try {
		result = writeBootSectors(medium, bootBytes, {
			pad: parsed.pad,
			force: parsed.force,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new CliError(`${parsed.file}: ${message}`);
	}

	await writeFile(parsed.image, medium.bytes);
	const padded =
		result.padded > 0 ? ` (padded with ${result.padded} zero bytes)` : "";
	process.stdout.write(
		`wrote ${result.sectorsWritten} boot sector(s) to ` +
			`${parsed.image}${padded}\n`,
	);
}
