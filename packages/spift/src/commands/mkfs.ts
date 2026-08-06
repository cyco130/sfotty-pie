import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
	defaultAtariDosVariant,
	formatAtariDos,
	type AtariDosVariant,
} from "../atari-dos.ts";
import { openAtr } from "../atr.ts";
import { CliError, UsageError } from "../cli-error.ts";
import { parseFsOption } from "./fs-option.ts";

export interface MkfsArgs {
	image: string;
	variant: AtariDosVariant | undefined;
	bootSectors: string | undefined;
}

function parseVariant(text: string, flag: string): AtariDosVariant {
	const selection = parseFsOption(text, flag);
	if (selection.family !== "atari") {
		throw new UsageError(
			`only atari filesystems can be created so far, not "${text}"`,
		);
	}
	if (selection.variant === undefined) {
		throw new UsageError(
			`${flag} needs a variant to create (for example atari/dos20s); ` +
				`omit ${flag} entirely to pick one from the geometry`,
		);
	}
	return selection.variant;
}

export function parseMkfsArgs(args: string[]): MkfsArgs {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: {
				fs: { type: "string" },
				variant: { type: "string" },
				"boot-sectors": { type: "string" },
			},
			allowPositionals: true,
		});
	} catch (error) {
		throw new UsageError(
			error instanceof Error ? error.message : String(error),
		);
	}
	const { values, positionals } = parsed;

	const [image, ...extra] = positionals;
	if (image === undefined) {
		throw new UsageError("missing IMAGE_FILE");
	}
	if (extra.length > 0) {
		throw new UsageError(`unexpected argument "${extra[0]}"`);
	}
	if (values.fs !== undefined && values.variant !== undefined) {
		throw new UsageError("--fs and --variant are mutually exclusive");
	}

	let variant: AtariDosVariant | undefined;
	if (values.fs !== undefined) {
		variant = parseVariant(values.fs, "--fs");
	} else if (values.variant !== undefined) {
		variant = parseVariant(values.variant, "--variant");
	}

	return { image, variant, bootSectors: values["boot-sectors"] };
}

export async function mkfsCommand(args: string[]): Promise<void> {
	const parsed = parseMkfsArgs(args);

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
	const bootSectors =
		parsed.bootSectors === undefined
			? undefined
			: await read(parsed.bootSectors);

	let medium;
	try {
		medium = openAtr(imageBytes);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new CliError(`${parsed.image}: ${message}`);
	}

	let variant = parsed.variant;
	if (variant === undefined) {
		variant = defaultAtariDosVariant(medium.sectorSize, medium.sectorCount);
		if (variant === undefined) {
			throw new CliError(
				`${parsed.image}: enhanced density fits both DOS 2.5 and MyDOS ` +
					`equally well; pick one with --fs atari/dos25 or --fs atari/mydos`,
			);
		}
	}

	let result;
	try {
		result = formatAtariDos(medium, variant, { bootSectors });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new CliError(`${parsed.image}: ${message}`);
	}

	await writeFile(parsed.image, medium.bytes);
	const wasted =
		result.unusableSectors > 0
			? `, ${result.unusableSectors} sector(s) beyond its reach`
			: "";
	process.stdout.write(
		`made an atari/${result.variant} filesystem on ${parsed.image}: ` +
			`${result.freeSectors} free sectors${wasted}\n`,
	);
}
