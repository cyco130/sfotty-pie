import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { CliError, UsageError } from "../cli-error.ts";
import {
	detectImageFormat,
	formatByExtension,
	formatByName,
	IMAGE_FORMATS,
	type ImageFormat,
} from "../formats.ts";

export interface ConvertArgs {
	image: string;
	output: string;
	type: ImageFormat | undefined;
	force: boolean;
}

export function parseConvertArgs(args: string[]): ConvertArgs {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: {
				image: { type: "string", short: "i" },
				type: { type: "string", short: "t" },
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

	const image = values.image;
	if (image === undefined) {
		throw new UsageError("missing --image (-i)");
	}
	const [output, ...extra] = positionals;
	if (output === undefined) {
		throw new UsageError("missing the file to write");
	}
	if (extra.length > 0) {
		throw new UsageError(`unexpected argument "${extra[0]}"`);
	}

	let type: ImageFormat | undefined;
	if (values.type !== undefined) {
		type = formatByName(values.type);
		if (type === undefined) {
			throw new UsageError(
				`unknown image type "${values.type}" ` +
					`(known: ${IMAGE_FORMATS.map((f) => f.name).join(", ")})`,
			);
		}
	}

	return { image, output, type, force: values.force ?? false };
}

export async function convertCommand(args: string[]): Promise<void> {
	const parsed = parseConvertArgs(args);

	let bytes: Uint8Array;
	try {
		bytes = await readFile(parsed.image);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new CliError(`${parsed.image}: no such file`);
		}
		throw error;
	}

	const from = detectImageFormat(bytes, parsed.image);
	if (from === undefined) {
		throw new CliError(
			`${parsed.image}: not an image spift knows ` +
				`(it reads: ${IMAGE_FORMATS.map((f) => f.name).join(", ")})`,
		);
	}
	const to = parsed.type ?? formatByExtension(parsed.output);
	if (to === undefined) {
		throw new CliError(
			`cannot tell what to write ${parsed.output} as; name it with --type`,
		);
	}
	if (to.encode === undefined) {
		throw new CliError(
			`spift reads ${to.name} but does not write it ` +
				`(writable: ${IMAGE_FORMATS.filter((f) => f.encode)
					.map((f) => f.name)
					.join(", ")})`,
		);
	}

	let medium;
	try {
		medium = from.decode(bytes);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new CliError(`${parsed.image}: ${message}`);
	}

	try {
		await writeFile(parsed.output, to.encode(medium), {
			flag: parsed.force ? "w" : "wx",
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new CliError(
				`${parsed.output} already exists, not overwriting (use --force)`,
			);
		}
		throw error;
	}

	process.stdout.write(
		`converted ${parsed.image} (${from.name}) to ${parsed.output} ` +
			`(${to.name}): ${medium.sectorCount} x ${medium.sectorSize}-byte ` +
			`sectors\n`,
	);
}
