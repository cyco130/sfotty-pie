import { stat, readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { toAtariName, type AtariDosVariant } from "../atari-dos.ts";
import { CliError, UsageError } from "../cli-error.ts";
import { parseFsOption } from "./fs-option.ts";
import { openImageFilesystem } from "./open-image.ts";

export interface AddArgs {
	image: string;
	files: string[];
	fs: "atari" | "sparta" | undefined;
	variant: AtariDosVariant | undefined;
	force: boolean;
}

export function parseAddArgs(args: string[]): AddArgs {
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

	const [image, ...files] = positionals;
	if (image === undefined) {
		throw new UsageError("missing IMAGE_FILE");
	}
	if (files.length === 0) {
		throw new UsageError("missing FILE to add");
	}

	const selection =
		values.fs === undefined ? undefined : parseFsOption(values.fs, "--fs");

	return {
		image,
		files,
		fs: selection?.family,
		variant: selection?.variant,
		force: values.force ?? false,
	};
}

export async function addCommand(args: string[]): Promise<void> {
	const parsed = parseAddArgs(args);

	// Read every source up front - the whole batch either goes in or nothing
	// does.
	const sources: { host: string; native: string; bytes: Uint8Array }[] = [];
	for (const file of parsed.files) {
		let info;
		try {
			info = await stat(file);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw new CliError(`${file}: no such file`);
			}
			throw error;
		}
		if (info.isDirectory()) {
			throw new CliError(`${file} is a directory (not supported yet)`);
		}
		sources.push({
			host: basename(file),
			native: toAtariName(basename(file)),
			bytes: await readFile(file),
		});
	}

	// Two sources mangling to the same native name is an error, not a
	// last-one-wins surprise.
	const byNative = new Map<string, string[]>();
	for (const source of sources) {
		byNative.set(source.native, [
			...(byNative.get(source.native) ?? []),
			source.host,
		]);
	}
	for (const [native, hosts] of byNative) {
		if (hosts.length > 1) {
			throw new CliError(
				`${hosts.join(" and ")} would all become ${native} on the image`,
			);
		}
	}

	const { filesystem, medium } = await openImageFilesystem(
		parsed.image,
		parsed.fs,
		parsed.variant,
	);
	// Without an explicit variant every disk gets DOS 2 files, MyDOS-style:
	// they read everywhere from DOS 2.0 on, and allocation follows the
	// bitmap, so a sector the format left free (720 on a MyDOS disk) is
	// fair game. Asking for dos10 specifically is the way to get DOS 1.0
	// chains, which nothing later can read.
	const format = parsed.variant === "dos10" ? "dos1" : "dos2";

	// Existing-name conflicts are collected up front too; -f is only about
	// files already on the image, never about the same batch.
	const before = [...filesystem.entries()];
	if (!parsed.force) {
		const existing = new Set(before.map((entry) => entry.name));
		const conflicts = sources
			.filter((source) => existing.has(source.native))
			.map((source) => source.native);
		if (conflicts.length > 0) {
			throw new CliError(
				`already on the image: ${conflicts.join(", ")} (use --force)`,
			);
		}
	}
	// Replacing the file the boot record loads moves it; the driver keeps
	// the pointer pinned to it, and this reports where it went.
	const bootFile = before.find(
		(entry) =>
			entry.attributes.includes("BootFile") &&
			sources.some((source) => source.native === entry.name),
	);

	let damaged = false;
	for (const source of sources) {
		let diagnostics: string[];
		try {
			diagnostics = filesystem.writeFile(source.native, source.bytes, {
				overwrite: parsed.force,
				format,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new CliError(`${source.host}: ${message}`);
		}
		for (const diagnostic of diagnostics) {
			process.stderr.write(`spift: ${source.native}: ${diagnostic}\n`);
		}
		damaged ||= diagnostics.length > 0;
		const renamed =
			source.native === source.host.toLowerCase()
				? ""
				: ` (as ${source.native})`;
		process.stdout.write(
			`${source.host}  ${source.bytes.length} bytes${renamed}\n`,
		);
	}

	if (bootFile !== undefined) {
		const moved = [...filesystem.entries(bootFile.name)][0];
		if (moved !== undefined && moved.startSector !== bootFile.startSector) {
			process.stdout.write(
				`${parsed.image} still boots ${moved.name}, now from sector ` +
					`${moved.startSector}\n`,
			);
		}
	}

	// Nothing touched the disk until here.
	await writeFile(parsed.image, medium.bytes);
	if (damaged) {
		process.exitCode = 1;
	}
}
