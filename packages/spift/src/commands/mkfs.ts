import { statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
	defaultAtariDosVariant,
	formatAtariDos,
	openAtariDos,
	writeAtariDosFilePointer,
	type AtariDosVariant,
} from "../atari-dos.ts";
import { openAtr, type AtrImage } from "../atr.ts";
import {
	adaptBootRecord,
	notBootableRecord,
	setBootable,
} from "../boot-record.ts";
import { extractBootSectors } from "../boot-sectors.ts";
import { CliError, UsageError } from "../cli-error.ts";
import { openHostDirectory } from "../host-dir.ts";
import { parseFsOption } from "./fs-option.ts";
import { openImageFilesystem } from "./open-image.ts";
import { BOOT_FILE } from "./pack.ts";

export interface MkfsArgs {
	image: string;
	variant: AtariDosVariant | undefined;
	bootSectors: string | undefined;
	/** An image or unpacked directory to take the boot record from. */
	master: string | undefined;
	/** Copy the master's DOS files too, and mark the disk bootable. */
	installDos: boolean;
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
			`${flag} needs a variant to create (for example atari/dos20); ` +
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
				image: { type: "string", short: "i" },
				fs: { type: "string" },
				variant: { type: "string" },
				"boot-sectors": { type: "string" },
				master: { type: "string" },
				"install-dos": { type: "boolean" },
			},
			allowPositionals: true,
		});
	} catch (error) {
		throw new UsageError(
			error instanceof Error ? error.message : String(error),
		);
	}
	const { values, positionals } = parsed;

	const extra = positionals;
	const image = values.image;
	if (image === undefined) {
		throw new UsageError("missing --image (-i)");
	}
	if (extra.length > 0) {
		throw new UsageError(`unexpected argument "${extra[0]}"`);
	}
	if (values.fs !== undefined && values.variant !== undefined) {
		throw new UsageError("--fs and --variant are mutually exclusive");
	}
	// Both name the boot area; one takes it verbatim, the other adapts it.
	if (values["boot-sectors"] !== undefined && values.master !== undefined) {
		throw new UsageError(
			"--boot-sectors and --master are mutually exclusive: one writes a " +
				"file as-is, the other takes a record from a disk and fits it",
		);
	}
	if (values["install-dos"] === true && values.master === undefined) {
		throw new UsageError("--install-dos needs --master to copy the DOS from");
	}

	let variant: AtariDosVariant | undefined;
	if (values.fs !== undefined) {
		variant = parseVariant(values.fs, "--fs");
	} else if (values.variant !== undefined) {
		variant = parseVariant(values.variant, "--variant");
	}

	return {
		image,
		variant,
		bootSectors: values["boot-sectors"],
		master: values.master,
		installDos: values["install-dos"] ?? false,
	};
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

	const master =
		parsed.master === undefined ? undefined : await openMaster(parsed.master);

	// The master deliberately does NOT settle the variant. Its filesystem
	// says how the master itself was formatted, not which DOS it carries:
	// the DOS 2.5 distribution disk is 720 sectors of plain dos20s format,
	// because 2.5 only differs at enhanced density. Inferring from it would
	// quietly build a DOS 2.0 filesystem for a DOS 2.5 disk.
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

	// A boot record from a master is fitted to this disk; --boot-sectors is
	// written as given; with neither, the disk gets ours, which says it has
	// no DOS and waits for RESET.
	let record = bootSectors;
	let adapted = false;
	if (master !== undefined) {
		record = master.boot;
		try {
			adapted = adaptBootRecord(record, medium.sectorSize).adapted;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new CliError(`${parsed.master}: ${message}`);
		}
		// Formatting leaves the record marked not bootable, as a DOS's own
		// FORMAT does; --install-dos is what turns it on, once the files are
		// there and the pointer is set.
		setBootable(record, false, medium.sectorSize);
	} else if (record === undefined) {
		record = notBootableRecord(variant, medium.sectorSize);
	}

	// Measured: stock DOS 1.0 and DOS 2.0 refuse to allocate at or above
	// sector 720 however big the disk is, so anything past that is ours and
	// MyDOS's to use but invisible to them. They read it back fine.
	if (variant !== "dos25" && medium.sectorCount > 720) {
		process.stderr.write(
			`spift: ${parsed.image}: ${medium.sectorCount} sectors, but stock ` +
				`Atari DOS never allocates at or above sector 720 - it will read ` +
				`what is up there and never write there itself\n`,
		);
	}

	let result;
	try {
		result = formatAtariDos(medium, variant, { bootSectors: record });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new CliError(`${parsed.image}: ${message}`);
	}

	let installed: string[] = [];
	if (parsed.installDos && master !== undefined) {
		installed = await installFrom(master, medium, variant, parsed.image);
	}

	await writeFile(parsed.image, medium.bytes);
	const wasted =
		result.unusableSectors > 0
			? `, ${result.unusableSectors} sector(s) beyond its reach`
			: "";
	const boot =
		installed.length > 0
			? `, bootable with ${installed.join(" and ")}`
			: parsed.master !== undefined
				? `, boot record from ${parsed.master}${adapted ? " (fitted to this density)" : ""}, not bootable`
				: parsed.bootSectors !== undefined
					? `, boot record from ${parsed.bootSectors}`
					: "";
	process.stdout.write(
		`made an atari/${result.variant} filesystem on ${parsed.image}: ` +
			`${result.freeSectors} free sectors${wasted}${boot}\n`,
	);
}

interface MasterFiles {
	/** The boot record, ready to be fitted and written. */
	boot: Uint8Array;
	/** Reads a file the master holds, or null when it has none. */
	read(name: string): Uint8Array | null;
	name: string;
}

/**
 * Opens a master: a disk image, or a directory an unpack left behind, where
 * the boot record travels as `.boot.bin` beside the files.
 */
async function openMaster(path: string): Promise<MasterFiles> {
	const directory = statSync(path, { throwIfNoEntry: false })?.isDirectory();
	if (directory === undefined) {
		throw new CliError(`${path}: no such file or directory`);
	}
	if (directory) {
		const store = openHostDirectory(path);
		const boot = store.readFile(BOOT_FILE);
		if (boot === null) {
			throw new CliError(
				`${path}: no ${BOOT_FILE} to take a boot record from ` +
					`(unpack writes one with --extract-boot-sectors)`,
			);
		}
		return {
			boot: Uint8Array.from(boot.bytes),
			read: (name) => store.readFile(name)?.bytes ?? null,
			name: path,
		};
	}
	const opened = await openImageFilesystem(path, undefined, undefined);
	let boot;
	try {
		boot = extractBootSectors(opened.medium).bytes;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new CliError(`${path}: ${message}`);
	}
	return {
		boot: Uint8Array.from(boot),
		read: (name) => opened.filesystem.readFile(name)?.bytes ?? null,
		name: path,
	};
}

/**
 * Copies the DOS across and points the boot record at it, the way a DOS's
 * own "write DOS files" does. DOS 1.0 has no DUP.SYS; every later one keeps
 * the menu in a second file beside DOS.SYS.
 */
async function installFrom(
	master: MasterFiles,
	medium: AtrImage,
	variant: AtariDosVariant,
	image: string,
): Promise<string[]> {
	const wanted = variant === "dos10" ? ["dos.sys"] : ["dos.sys", "dup.sys"];
	const filesystem = openAtariDos(medium, variant);
	const written: string[] = [];
	for (const name of wanted) {
		const bytes = master.read(name);
		if (bytes === null) {
			throw new CliError(`${master.name}: no ${name} to install`);
		}
		try {
			filesystem.writeFile(name, bytes, {
				format: variant === "dos10" ? "dos1" : "dos2",
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new CliError(`${image}: ${name}: ${message}`);
		}
		written.push(name);
	}
	const dos = [...filesystem.entries("dos.sys")][0];
	if (dos?.startSector === undefined) {
		throw new CliError(`${image}: dos.sys did not land on the disk`);
	}
	writeAtariDosFilePointer(medium, variant, dos.startSector);
	// The pointer is set and the files are there, so the disk can say it
	// boots - which is the one thing byte 14 controls.
	const record = medium.readSector(1);
	if (record !== null) {
		setBootable(record, true, medium.sectorSize);
		medium.writeSector(1, record);
	}
	return written;
}
