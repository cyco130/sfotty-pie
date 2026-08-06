import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { AtariDosVariant } from "../atari-dos.ts";
import type { DirEntry } from "../filesystem.ts";
import { parseFsOption } from "./fs-option.ts";
import { CliError, UsageError } from "../cli-error.ts";
import { openImageFilesystem } from "./open-image.ts";

export interface RmArgs {
	image: string;
	specs: string[];
	fs: "atari" | "sparta" | undefined;
	variant: AtariDosVariant | undefined;
	force: boolean;
	recursive: boolean;
}

export function parseRmArgs(args: string[]): RmArgs {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: {
				fs: { type: "string" },
				force: { type: "boolean", short: "f" },
				recursive: { type: "boolean", short: "r" },
			},
			allowPositionals: true,
		});
	} catch (error) {
		throw new UsageError(
			error instanceof Error ? error.message : String(error),
		);
	}
	const { values, positionals } = parsed;

	const [image, ...specs] = positionals;
	if (image === undefined) {
		throw new UsageError("missing IMAGE_FILE");
	}
	if (specs.length === 0) {
		throw new UsageError("missing SPEC to remove");
	}

	const selection =
		values.fs === undefined ? undefined : parseFsOption(values.fs, "--fs");

	return {
		image,
		specs,
		fs: selection?.family,
		variant: selection?.variant,
		force: values.force ?? false,
		recursive: values.recursive ?? false,
	};
}

export async function rmCommand(args: string[]): Promise<void> {
	const parsed = parseRmArgs(args);
	const { filesystem, medium } = await openImageFilesystem(
		parsed.image,
		parsed.fs,
		parsed.variant,
	);

	// Resolve every spec up front; the whole batch either goes or nothing
	// does. -f follows rm: a spec matching nothing stops being an error.
	const targets = new Map<string, DirEntry>();
	for (const spec of parsed.specs) {
		let matched;
		try {
			// A spec names things to remove, so a directory means itself
			// rather than its contents - "rm games" is about games.
			matched = [...filesystem.entries(spec, { listContents: false })];
			if (matched.length === 0 && !parsed.force) {
				throw new CliError(`no files match "${spec}"`);
			}
			for (const entry of matched) {
				targets.set(entry.path, entry);
				// -r takes everything under a matched directory, whatever it
				// is named; the spec only had to pick the directory.
				if (entry.kind === "dir" && parsed.recursive) {
					for (const inner of filesystem.entries(entry.path, {
						recursive: true,
					})) {
						targets.set(inner.path, inner);
					}
				}
			}
		} catch (error) {
			if (error instanceof CliError) {
				throw error;
			}
			const message = error instanceof Error ? error.message : String(error);
			throw new CliError(`${parsed.image}: ${message}`);
		}
	}
	// Deepest first, so a directory is empty by the time its turn comes.
	const entries = [...targets.values()].sort(
		(a, b) => b.path.split("/").length - a.path.split("/").length,
	);

	const directories = entries.filter((entry) => entry.kind === "dir");
	if (directories.length > 0 && !parsed.recursive) {
		throw new CliError(
			`cannot remove directories without --recursive: ${directories
				.map((entry) => entry.path)
				.join(", ")}`,
		);
	}
	if (!parsed.force) {
		const locked = entries.filter((entry) =>
			entry.attributes.includes("ReadOnly"),
		);
		if (locked.length > 0) {
			throw new CliError(
				`locked: ${locked.map((entry) => entry.path).join(", ")} (use --force)`,
			);
		}
	}

	let damaged = false;
	for (const entry of entries) {
		let diagnostics: string[];
		try {
			if (entry.kind === "dir") {
				filesystem.removeDirectory(entry.path);
				process.stdout.write(`removed ${entry.path}\n`);
				continue;
			}
			diagnostics = filesystem.deleteFile(entry.path, {
				force: parsed.force,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new CliError(`${entry.path}: ${message}`);
		}
		for (const diagnostic of diagnostics) {
			process.stderr.write(`spift: ${entry.path}: ${diagnostic}\n`);
		}
		damaged ||= diagnostics.length > 0;
		process.stdout.write(`removed ${entry.path}\n`);
	}

	// Removing the file the boot record loads unsets it, which is quiet
	// enough to be worth saying out loud.
	if (entries.some((entry) => entry.attributes.includes("BootFile"))) {
		process.stdout.write(`${parsed.image} is no longer bootable\n`);
	}

	// Nothing touched the disk until here.
	if (entries.length > 0) {
		await writeFile(parsed.image, medium.bytes);
	}
	if (damaged) {
		process.exitCode = 1;
	}
}
