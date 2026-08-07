import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { openAtr } from "../atr.ts";
import { extractBootSectors } from "../boot-sectors.ts";
import { CliError, UsageError } from "../cli-error.ts";

export interface ExtractBootSectorsArgs {
	image: string;
	file: string;
	sectorCount: number | undefined;
	force: boolean;
}

export function parseExtractBootSectorsArgs(
	args: string[],
): ExtractBootSectorsArgs {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: {
				image: { type: "string", short: "i" },
				"sector-count": { type: "string" },
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

	const [file, ...extra] = positionals;
	const image = values.image;
	if (image === undefined) {
		throw new UsageError("missing --image (-i)");
	}
	if (file === undefined) {
		throw new UsageError("missing OUTPUT_FILE");
	}
	if (extra.length > 0) {
		throw new UsageError(`unexpected argument "${extra[0]}"`);
	}

	let sectorCount: number | undefined;
	if (values["sector-count"] !== undefined) {
		if (
			!/^[0-9]+$/.test(values["sector-count"]) ||
			Number(values["sector-count"]) < 1
		) {
			throw new UsageError(
				`--sector-count expects a positive integer, ` +
					`got "${values["sector-count"]}"`,
			);
		}
		sectorCount = Number(values["sector-count"]);
	}

	return { image, file, sectorCount, force: values.force ?? false };
}

export async function extractBootSectorsCommand(args: string[]): Promise<void> {
	const parsed = parseExtractBootSectorsArgs(args);

	let imageBytes: Uint8Array;
	try {
		imageBytes = await readFile(parsed.image);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new CliError(`${parsed.image}: no such file`);
		}
		throw error;
	}

	let medium;
	try {
		medium = openAtr(imageBytes);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new CliError(`${parsed.image}: ${message}`);
	}

	let result;
	try {
		result = extractBootSectors(
			medium,
			parsed.sectorCount === undefined
				? undefined
				: { sectorCount: parsed.sectorCount },
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new CliError(`${parsed.image}: ${message}`);
	}

	try {
		await writeFile(parsed.file, result.bytes, {
			flag: parsed.force ? "w" : "wx",
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new CliError(
				`${parsed.file} already exists, not overwriting (use --force)`,
			);
		}
		throw error;
	}
	process.stdout.write(
		`extracted ${result.sectorCount} boot sector(s) ` +
			`(${result.bytes.length} bytes) to ${parsed.file}\n`,
	);
}
