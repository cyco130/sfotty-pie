import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { AtariDosVariant } from "../atari-dos.ts";
import { parseFsOption } from "./fs-option.ts";
import { toHostName, uniqueHostNames } from "../host-names.ts";
import { CliError, UsageError } from "../cli-error.ts";
import { openImageFilesystem } from "./open-image.ts";

export interface ExtractArgs {
	image: string;
	spec: string | undefined;
	out: string;
	recursive: boolean;
	fs: "atari" | "sparta" | undefined;
	variant: AtariDosVariant | undefined;
	force: boolean;
}

export function parseExtractArgs(args: string[]): ExtractArgs {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: {
				out: { type: "string", short: "o" },
				recursive: { type: "boolean", short: "R" },
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

	const selection =
		values.fs === undefined ? undefined : parseFsOption(values.fs, "--fs");

	return {
		image,
		spec,
		out: values.out ?? ".",
		recursive: values.recursive ?? false,
		fs: selection?.family,
		variant: selection?.variant,
		force: values.force ?? false,
	};
}

export async function extractCommand(args: string[]): Promise<void> {
	const parsed = parseExtractArgs(args);
	const { filesystem } = await openImageFilesystem(
		parsed.image,
		parsed.fs,
		parsed.variant,
	);

	let matched;
	try {
		matched = [
			...filesystem.entries(parsed.spec, { recursive: parsed.recursive }),
		];
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new CliError(`${parsed.image}: ${message}`);
	}
	// Directories are the shape of the output, not content to copy; -R fills
	// them by yielding what is inside them too.
	const files = matched.filter((entry) => entry.kind !== "dir");
	if (files.length === 0) {
		if (parsed.spec !== undefined) {
			throw new CliError(`no files match "${parsed.spec}"`);
		}
		return;
	}

	// The host layout mirrors the tree below whatever directory the spec
	// selected, so naming one file inside a subdirectory drops it straight
	// into -o rather than rebuilding the path above it.
	let base = parsed.spec === undefined ? [] : parsed.spec.split(/[/>:]/);
	while (
		base.length > 0 &&
		!files.every((entry) => entry.path.startsWith(`${base.join("/")}/`))
	) {
		base = base.slice(0, -1);
	}

	// Mangling applies per path component, and collisions are resolved
	// within each host directory rather than across the whole tree.
	const byDirectory = new Map<string, string[]>();
	const targets = files.map((entry) => {
		const parts = entry.path.split("/").slice(base.length);
		const leaf = parts.pop() ?? entry.name;
		const dir = parts.map(toHostName);
		const key = dir.join("/");
		const taken = byDirectory.get(key) ?? [];
		const hostName = uniqueHostNames([...taken, toHostName(leaf)]).at(
			-1,
		) as string;
		byDirectory.set(key, [...taken, hostName]);
		return {
			entry,
			hostName,
			directory: join(parsed.out, ...dir),
			path: join(parsed.out, ...dir, hostName),
		};
	});

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
		const contents = filesystem.readFile(target.entry.path);
		if (contents === null) {
			continue; // unreachable: the entry came from the same listing
		}
		for (const diagnostic of contents.diagnostics) {
			process.stderr.write(`spift: ${target.entry.path}: ${diagnostic}\n`);
		}
		damaged ||= contents.diagnostics.length > 0;
		await mkdir(target.directory, { recursive: true });
		await writeFile(target.path, contents.bytes);
		const renamed =
			target.hostName === target.entry.name ? "" : ` (as ${target.hostName})`;
		process.stdout.write(
			`${target.entry.path}  ${contents.bytes.length} bytes${renamed}\n`,
		);
	}
	if (damaged) {
		process.exitCode = 1;
	}
}
