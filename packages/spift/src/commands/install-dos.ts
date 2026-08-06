import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
	ATARI_DOS_BOOT_SECTORS,
	readAtariDosFilePointer,
	writeAtariDosFilePointer,
	type AtariDosVariant,
} from "../atari-dos.ts";
import { extractBootSectors, writeBootSectors } from "../boot-sectors.ts";
import { CliError, UsageError } from "../cli-error.ts";
import { parseFsOption } from "./fs-option.ts";
import { openImageFilesystem } from "./open-image.ts";

export interface InstallDosArgs {
	image: string;
	from: string;
	fs: "atari" | "sparta" | undefined;
	variant: AtariDosVariant | undefined;
	force: boolean;
}

export function parseInstallDosArgs(args: string[]): InstallDosArgs {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: {
				from: { type: "string" },
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

	const [image, ...extra] = positionals;
	if (image === undefined) {
		throw new UsageError("missing IMAGE_FILE");
	}
	if (extra.length > 0) {
		throw new UsageError(`unexpected argument "${extra[0]}"`);
	}
	if (values.from === undefined) {
		throw new UsageError("missing --from MASTER_IMAGE");
	}

	const selection =
		values.fs === undefined ? undefined : parseFsOption(values.fs, "--fs");

	return {
		image,
		from: values.from,
		fs: selection?.family,
		variant: selection?.variant,
		force: values.force ?? false,
	};
}

export async function installDosCommand(args: string[]): Promise<void> {
	const parsed = parseInstallDosArgs(args);

	// The master: its boot sectors, the file its boot record points at, and
	// the menu program beside it.
	const master = await openImageFilesystem(parsed.from, undefined, undefined);
	const masterDosSector = readAtariDosFilePointer(
		master.medium,
		master.filesystem.variant,
	);
	if (masterDosSector === 0) {
		throw new CliError(`${parsed.from} is not bootable, nothing to install`);
	}
	const masterEntries = [...master.filesystem.entries()];
	const dosEntry = masterEntries.find(
		(entry) => entry.startSector === masterDosSector && entry.kind === "file",
	);
	if (dosEntry === undefined) {
		throw new CliError(
			`${parsed.from}: its boot record points at sector ` +
				`${masterDosSector}, which holds no file`,
		);
	}
	const boot = extractBootSectors(master.medium);
	const wanted = [dosEntry.name, "dup.sys"].filter(
		(name, index, all) => all.indexOf(name) === index,
	);
	const payload: { name: string; bytes: Uint8Array }[] = [];
	for (const name of wanted) {
		const contents = master.filesystem.readFile(name);
		if (contents === null) {
			continue; // DUP.SYS is optional - DOS 1.0 keeps its menu inside DOS.SYS
		}
		for (const diagnostic of contents.diagnostics) {
			process.stderr.write(`spift: ${parsed.from}: ${name}: ${diagnostic}\n`);
		}
		payload.push({ name, bytes: contents.bytes });
	}

	// The target has to agree about the shape of the boot area and the
	// density, or the installed DOS would read the disk wrongly.
	const target = await openImageFilesystem(
		parsed.image,
		parsed.fs,
		parsed.variant,
	);
	const variant = target.filesystem.variant;
	const expectedBoot = ATARI_DOS_BOOT_SECTORS[variant];
	if (boot.sectorCount !== expectedBoot) {
		throw new CliError(
			`${parsed.from} boots from ${boot.sectorCount} sector(s) but an ` +
				`atari/${variant} disk reserves ${expectedBoot}; the filesystems ` +
				`do not match`,
		);
	}
	if (
		variant !== "dos10" &&
		boot.bytes[14] !== (target.medium.sectorSize === 256 ? 2 : 1)
	) {
		throw new CliError(
			`${parsed.from} is built for ${boot.bytes[14] === 2 ? "double" : "single"}` +
				`-density disks; ${parsed.image} is the other one`,
		);
	}

	// Everything is in memory until the last write, as ever.
	writeBootSectors(target.medium, boot.bytes, { force: true });
	const format = variant === "dos10" ? "dos1" : "dos2";
	for (const file of payload) {
		try {
			target.filesystem.writeFile(file.name, file.bytes, {
				overwrite: parsed.force,
				format,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new CliError(`${file.name}: ${message}`);
		}
	}
	const installed = [...target.filesystem.entries()].find(
		(entry) => entry.name === dosEntry.name,
	);
	if (installed === undefined) {
		throw new CliError(`${dosEntry.name} did not land on the image`);
	}
	writeAtariDosFilePointer(target.medium, variant, installed.startSector);
	await writeFile(parsed.image, target.medium.bytes);

	process.stdout.write(
		`installed ${payload.map((file) => file.name).join(" and ")} ` +
			`from ${parsed.from}; ${parsed.image} boots ${dosEntry.name} ` +
			`from sector ${installed.startSector}\n`,
	);
}
