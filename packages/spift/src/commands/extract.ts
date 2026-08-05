import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { DirEntry } from "../filesystem.ts";
import { toHostName, uniqueHostNames } from "../host-names.ts";
import { CliError, UsageError } from "../cli-error.ts";
import { openImageFilesystem } from "./open-image.ts";

export interface ExtractArgs {
	image: string;
	spec: string | undefined;
	out: string;
	fs: "atari" | "sparta" | undefined;
	force: boolean;
}

export function parseExtractArgs(args: string[]): ExtractArgs {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: {
				out: { type: "string", short: "o" },
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

	const [image, spec, ...extra] = positionals;
	if (image === undefined) {
		throw new UsageError("missing IMAGE_FILE");
	}
	if (extra.length > 0) {
		throw new UsageError(`unexpected argument "${extra[0]}"`);
	}

	let fs: "atari" | "sparta" | undefined;
	if (values.fs !== undefined) {
		const lowered = values.fs.toLowerCase();
		if (lowered !== "atari" && lowered !== "sparta") {
			throw new UsageError(
				`invalid --fs "${values.fs}" (valid: atari, sparta)`,
			);
		}
		fs = lowered;
	}

	return {
		image,
		spec,
		out: values.out ?? ".",
		fs,
		force: values.force ?? false,
	};
}

export async function extractCommand(args: string[]): Promise<void> {
	const parsed = parseExtractArgs(args);
	const filesystem = await openImageFilesystem(parsed.image, parsed.fs);

	const matched = [...filesystem.entries(parsed.spec)];
	const files: DirEntry[] = [];
	for (const entry of matched) {
		if (entry.kind === "dir") {
			process.stderr.write(
				`spift: skipping ${entry.name}/ ` +
					`(subdirectories are not supported yet)\n`,
			);
		} else {
			files.push(entry);
		}
	}
	if (files.length === 0) {
		if (parsed.spec !== undefined) {
			throw new CliError(`no files match "${parsed.spec}"`);
		}
		return;
	}

	const hostNames = uniqueHostNames(
		files.map((entry) => toHostName(entry.name)),
	);
	const targets = files.map((entry, index) => ({
		entry,
		hostName: hostNames[index] ?? entry.name,
		path: join(parsed.out, hostNames[index] ?? entry.name),
	}));

	// Whole-run atomicity: refuse before writing anything, not midway.
	if (!parsed.force) {
		const existing = targets.filter((target) => existsSync(target.path));
		if (existing.length > 0) {
			throw new CliError(
				`would overwrite ${existing
					.map((target) => target.path)
					.join(", ")} (use --force)`,
			);
		}
	}
	await mkdir(parsed.out, { recursive: true });

	let damaged = false;
	for (const target of targets) {
		const contents = filesystem.readFile(target.entry.name);
		if (contents === null) {
			continue; // unreachable: the entry came from the same listing
		}
		for (const diagnostic of contents.diagnostics) {
			process.stderr.write(`spift: ${target.entry.name}: ${diagnostic}\n`);
		}
		damaged ||= contents.diagnostics.length > 0;
		await writeFile(target.path, contents.bytes);
		const renamed =
			target.hostName === target.entry.name ? "" : ` (as ${target.hostName})`;
		process.stdout.write(
			`${target.entry.name}  ${contents.bytes.length} bytes${renamed}\n`,
		);
	}
	if (damaged) {
		process.exitCode = 1;
	}
}
