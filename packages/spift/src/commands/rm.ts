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
}

export function parseRmArgs(args: string[]): RmArgs {
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
		const matched = [...filesystem.entries(spec)];
		if (matched.length === 0 && !parsed.force) {
			throw new CliError(`no files match "${spec}"`);
		}
		for (const entry of matched) {
			targets.set(entry.name, entry);
		}
	}
	const entries = [...targets.values()];

	const directories = entries.filter((entry) => entry.kind === "dir");
	if (directories.length > 0) {
		throw new CliError(
			`cannot remove directories: ${directories
				.map((entry) => `${entry.name}/`)
				.join(", ")} (not supported yet)`,
		);
	}
	if (!parsed.force) {
		const locked = entries.filter((entry) =>
			entry.attributes.includes("ReadOnly"),
		);
		if (locked.length > 0) {
			throw new CliError(
				`locked: ${locked.map((entry) => entry.name).join(", ")} (use --force)`,
			);
		}
	}

	let damaged = false;
	for (const entry of entries) {
		let diagnostics: string[];
		try {
			diagnostics = filesystem.deleteFile(entry.name, {
				force: parsed.force,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new CliError(`${entry.name}: ${message}`);
		}
		for (const diagnostic of diagnostics) {
			process.stderr.write(`spift: ${entry.name}: ${diagnostic}\n`);
		}
		damaged ||= diagnostics.length > 0;
		process.stdout.write(`removed ${entry.name}\n`);
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
