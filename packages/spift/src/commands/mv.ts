import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
	applyAtariNameTemplate,
	splitAtariPath,
	type AtariDosVariant,
} from "../atari-dos.ts";
import { CliError, UsageError } from "../cli-error.ts";
import { parseFsOption } from "./fs-option.ts";
import { openImageFilesystem } from "./open-image.ts";

export interface MvArgs {
	image: string;
	source: string;
	destination: string;
	fs: "atari" | "sparta" | undefined;
	variant: AtariDosVariant | undefined;
	force: boolean;
}

export function parseMvArgs(args: string[]): MvArgs {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: {
				fs: { type: "string" },
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

	const [image, source, destination, ...extra] = positionals;
	if (image === undefined) {
		throw new UsageError("missing IMAGE_FILE");
	}
	if (source === undefined || destination === undefined) {
		throw new UsageError("missing SOURCE and DESTINATION");
	}
	if (extra.length > 0) {
		throw new UsageError(`unexpected argument "${extra[0]}"`);
	}

	const selection =
		values.fs === undefined ? undefined : parseFsOption(values.fs, "--fs");

	return {
		image,
		source,
		destination,
		fs: selection?.family,
		variant: selection?.variant,
		force: values.force ?? false,
	};
}

export async function mvCommand(args: string[]): Promise<void> {
	const parsed = parseMvArgs(args);
	const { filesystem, medium } = await openImageFilesystem(
		parsed.image,
		parsed.fs,
		parsed.variant,
	);

	const fail = (error: unknown): never => {
		if (error instanceof CliError) {
			throw error;
		}
		const message = error instanceof Error ? error.message : String(error);
		throw new CliError(`${parsed.image}: ${message}`);
	};

	let sources;
	try {
		// A source names things to move, so a directory means itself.
		sources = [...filesystem.entries(parsed.source, { listContents: false })];
	} catch (error) {
		fail(error);
	}
	if (sources === undefined || sources.length === 0) {
		throw new CliError(`no files match "${parsed.source}"`);
	}

	// The destination is a directory when it says so with a trailing
	// separator or by being one; otherwise it is a name template.
	const trailing = /[/>:]$/.test(parsed.destination);
	const destinationParts = splitAtariPath(parsed.destination);
	let intoDirectory = trailing || destinationParts.length === 0;
	if (!intoDirectory) {
		try {
			const named = [
				...filesystem.entries(parsed.destination, { listContents: false }),
			];
			intoDirectory = named[0]?.kind === "dir";
		} catch {
			intoDirectory = false; // a path that does not resolve is a template
		}
	}
	const templatePath = intoDirectory ? undefined : destinationParts.slice();
	const template = intoDirectory ? undefined : templatePath?.pop();
	if (!intoDirectory && sources.length > 1 && !/[*?]/.test(template ?? "")) {
		throw new CliError(
			`"${parsed.destination}" names one file but ${sources.length} match ` +
				`"${parsed.source}"; use a template like '*.txt' or a directory`,
		);
	}

	let damaged = false;
	for (const entry of sources) {
		const leaf = intoDirectory
			? entry.name
			: applyAtariNameTemplate(entry.name, template ?? entry.name);
		const directory = intoDirectory ? destinationParts : (templatePath ?? []);
		const to = [...directory, leaf].join("/");
		let diagnostics: string[];
		try {
			diagnostics = filesystem.moveFile(entry.path, to, {
				force: parsed.force,
			});
		} catch (error) {
			fail(error);
			return;
		}
		for (const diagnostic of diagnostics) {
			process.stderr.write(`spift: ${entry.path}: ${diagnostic}\n`);
		}
		damaged ||= diagnostics.length > 0;
		process.stdout.write(`${entry.path} -> ${to}\n`);
	}

	// Nothing touched the disk until here.
	await writeFile(parsed.image, medium.bytes);
	if (damaged) {
		process.exitCode = 1;
	}
}
