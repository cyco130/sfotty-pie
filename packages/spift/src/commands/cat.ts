import { parseArgs } from "node:util";
import type { AtariDosVariant } from "../atari-dos.ts";
import { CliError, UsageError } from "../cli-error.ts";
import { recodeText, type EolStyle } from "../text.ts";
import { parseEol } from "./eol-option.ts";
import { parseFsOption } from "./fs-option.ts";
import { openImageFilesystem } from "./open-image.ts";

export interface CatArgs {
	image: string;
	specs: string[];
	fs: "atari" | "sparta" | undefined;
	variant: AtariDosVariant | undefined;
	eol: EolStyle;
}

export function parseCatArgs(args: string[]): CatArgs {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: {
				image: { type: "string", short: "i" },
				fs: { type: "string" },
				eol: { type: "string" },
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
	if (positionals.length === 0) {
		throw new UsageError("missing the file to show");
	}

	const selection =
		values.fs === undefined ? undefined : parseFsOption(values.fs, "--fs");

	return {
		image,
		specs: positionals,
		fs: selection?.family,
		variant: selection?.variant,
		eol: parseEol(values.eol),
	};
}

export async function catCommand(args: string[]): Promise<void> {
	const parsed = parseCatArgs(args);
	const { filesystem } = await openImageFilesystem(
		parsed.image,
		parsed.fs,
		parsed.variant,
	);

	// Everything is read before anything is written, so a missing file or a
	// binary bound for a terminal stops the lot rather than half of it.
	const files: { path: string; bytes: Uint8Array; diagnostics: string[] }[] =
		[];
	for (const spec of parsed.specs) {
		let matched;
		try {
			matched = [...filesystem.entries(spec, { listContents: false })];
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new CliError(`${parsed.image}: ${message}`);
		}
		if (matched.length === 0) {
			throw new CliError(`no files match "${spec}"`);
		}
		for (const entry of matched) {
			if (entry.kind === "dir") {
				throw new CliError(`${entry.path} is a directory`);
			}
			const contents = filesystem.readFile(entry.path);
			if (contents === null) {
				throw new CliError(`${entry.path} could not be read`);
			}
			// Always as text: an image holds the family's own character set,
			// so raw bytes would be the odd case rather than the useful one.
			// It is the safe default too - recoding turns control codes into
			// glyphs, so a file cannot paint the terminal with escapes.
			const recoded = recodeText(
				contents.bytes,
				filesystem.textEncoding ?? "unicode",
				"unicode",
				{ eol: parsed.eol },
			);
			files.push({
				path: entry.path,
				bytes: recoded.bytes,
				diagnostics: [...contents.diagnostics, ...recoded.diagnostics],
			});
		}
	}

	let damaged = false;
	for (const file of files) {
		for (const diagnostic of file.diagnostics) {
			process.stderr.write(`spift: ${file.path}: ${diagnostic}\n`);
			damaged = true;
		}
		process.stdout.write(file.bytes);
	}
	if (damaged) {
		process.exitCode = 1;
	}
}
