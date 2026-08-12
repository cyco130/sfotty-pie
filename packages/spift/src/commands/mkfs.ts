import { statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
	checkAtariDosGeometry,
	defaultAtariDosVariant,
	formatAtariDos,
	openAtariDos,
	writeAtariDosFilePointer,
	type AtariDosVariant,
} from "../atari-dos.ts";
import {
	formatSpartaDos,
	openSpartaDos,
	readSpartaDosFilePointer,
	writeSpartaDosFilePointer,
	type SpartaDosVariant,
} from "../sparta-dos.ts";
import { openAtr, type AtrImage } from "../atr.ts";
import {
	adaptBootRecord,
	notBootableRecord,
	setBootable,
} from "../boot-record.ts";
import { extractBootSectors } from "../boot-sectors.ts";
import { CliError, UsageError } from "../cli-error.ts";
import { openHostDirectory } from "../host-dir.ts";
import { fsId, parseFsOption } from "./fs-option.ts";
import { openImageFilesystem, type OpenedImage } from "./open-image.ts";
import { BOOT_FILE } from "./pack.ts";

export interface MkfsArgs {
	image: string;
	family: "atari" | "sparta" | undefined;
	variant: AtariDosVariant | SpartaDosVariant | undefined;
	bootSectors: string | undefined;
	/** An image or unpacked directory to take the boot record from. */
	master: string | undefined;
	/** Copy the master's DOS files too, and mark the disk bootable. */
	installDos: boolean;
	/** SpartaDOS volume name (the family with one). */
	volumeName: string | undefined;
	/**
	 * Keep the last disk sector out of the data area, the way the pre-2.1
	 * SpartaDOS formatters do. spift reclaims it by default (SDX 4.50's
	 * "Optimize"); this is the SpartaDOS-only opt-out. The Atari DOS family
	 * has no equivalent - its way to reach more sectors is the MyDOS variant.
	 */
	reserveLastSector: boolean;
}

export function parseMkfsArgs(args: string[]): MkfsArgs {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: {
				image: { type: "string", short: "i" },
				fs: { type: "string" },
				"boot-sectors": { type: "string" },
				master: { type: "string" },
				"install-dos": { type: "boolean" },
				"volume-name": { type: "string" },
				"reserve-last-sector": { type: "boolean" },
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
	return { image, ...parseFormatValues(values) };
}

/** The formatting flags mkfs owns and create forwards. */
export interface FormatFlagValues {
	fs?: string | undefined;
	"boot-sectors"?: string | undefined;
	master?: string | undefined;
	"install-dos"?: boolean | undefined;
	"volume-name"?: string | undefined;
	"reserve-last-sector"?: boolean | undefined;
}

/**
 * Cross-checks and resolves the formatting flags, shared between mkfs and
 * create so the two spell formatting identically.
 */
export function parseFormatValues(
	values: FormatFlagValues,
): Omit<MkfsArgs, "image"> {
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

	const selection =
		values.fs === undefined ? undefined : parseFsOption(values.fs, "--fs");
	// Whether a volume name belongs here turns on the family, which a
	// 512-byte image settles only once it is open (it defaults to SpartaDOS),
	// so both checks - name-on-Atari and no-name-on-Sparta - wait for
	// formatImage. The one thing settled now: an explicit --fs sparta must
	// carry a name, since that is the whole point of naming the family.
	if (selection?.family === "sparta" && values["volume-name"] === undefined) {
		throw new UsageError(
			"a SpartaDOS filesystem needs a volume name (--volume-name NAME): " +
				"it identifies the disk for change detection, and SpartaDOS 1.1 " +
				"relies on it being unique",
		);
	}

	return {
		family: selection?.family,
		variant: selection?.variant,
		bootSectors: values["boot-sectors"],
		master: values.master,
		installDos: values["install-dos"] ?? false,
		volumeName: values["volume-name"],
		reserveLastSector: values["reserve-last-sector"] === true,
	};
}

async function readInput(path: string): Promise<Uint8Array> {
	try {
		return await readFile(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new CliError(`${path}: no such file`);
		}
		throw error;
	}
}

export async function mkfsCommand(args: string[]): Promise<void> {
	const parsed = parseMkfsArgs(args);
	const imageBytes = await readInput(parsed.image);

	let medium;
	try {
		medium = openAtr(imageBytes);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new CliError(`${parsed.image}: ${message}`);
	}

	const summary = await formatImage(parsed, medium);
	await writeFile(parsed.image, medium.bytes);
	process.stdout.write(summary);
}

/**
 * The whole mkfs pipeline minus reading and writing the image file: formats
 * the opened medium in memory and returns the summary line to print once
 * the bytes are saved. create runs this on a freshly made blank image.
 */
export async function formatImage(
	parsed: MkfsArgs,
	medium: AtrImage,
): Promise<string> {
	const bootSectors =
		parsed.bootSectors === undefined
			? undefined
			: await readInput(parsed.bootSectors);

	const master =
		parsed.master === undefined ? undefined : await openMaster(parsed.master);

	// No filesystem spift makes uses a sector size other than 128, 256, or
	// 512, so a larger one (an 8192-byte hard-disk block, say) is refused on
	// its own terms rather than blamed on a particular family.
	if (![128, 256, 512].includes(medium.sectorSize)) {
		throw new CliError(
			`${parsed.image}: spift's filesystems use 128-, 256-, or 512-byte ` +
				`sectors, not ${medium.sectorSize}`,
		);
	}

	// A 512-byte-sector image is hard-disk territory that only SpartaDOS
	// reaches, so it defaults there when no family is named; everything else
	// defaults to the Atari DOS family.
	const family =
		parsed.family ?? (medium.sectorSize === 512 ? "sparta" : "atari");
	if (family === "atari" && parsed.volumeName !== undefined) {
		throw new CliError(
			`${parsed.image}: --volume-name is SpartaDOS's (the Atari DOS family ` +
				`has no label); say --fs sparta to make one`,
		);
	}
	if (family === "sparta") {
		return mkfsSparta(parsed, medium, bootSectors, master);
	}
	return mkfsAtari(parsed, medium, bootSectors, master);
}

function mkfsAtari(
	parsed: MkfsArgs,
	medium: AtrImage,
	bootSectors: Uint8Array | undefined,
	master: MasterFiles | undefined,
): string {
	// The last-sector switch is a SpartaDOS bitmap detail; the Atari DOS
	// family reaches more sectors by variant (MyDOS), not by a formatter knob.
	if (parsed.reserveLastSector) {
		throw new CliError(
			"--reserve-last-sector is a SpartaDOS option; the Atari DOS family " +
				"has no last-sector reserve - use --fs atari/mydos to reach past " +
				"the DOS 2 sector limits instead",
		);
	}
	// The master deliberately does NOT settle the variant. Its filesystem
	// says how the master itself was formatted, not which DOS it carries:
	// the DOS 2.5 distribution disk is 720 sectors of plain dos20s format,
	// because 2.5 only differs at enhanced density. Inferring from it would
	// quietly build a DOS 2.0 filesystem for a DOS 2.5 disk.
	const variant =
		(parsed.variant as AtariDosVariant | undefined) ??
		defaultAtariDosVariant(medium.sectorSize, medium.sectorCount);

	// Refuse an impossible geometry before anything else, so the error stands
	// on its own instead of trailing the sectors-past-720 warning below (which
	// formatAtariDos would otherwise print on the way to the same rejection).
	const problem = checkAtariDosGeometry(
		variant,
		medium.sectorSize,
		medium.sectorCount,
	);
	if (problem !== undefined) {
		throw new CliError(`${parsed.image}: ${problem}`);
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
		installed = installAtariFrom(master, medium, variant, parsed.image);
	}

	// DOS 2.5 addresses 1023 sectors, so a standard 1040-sector enhanced disk
	// always leaves 17 past its reach - that is just the format, not worth
	// mentioning. On any other size the leftover is the caller's own doing, so
	// it is worth a word.
	const wasted =
		result.unusableSectors > 0 && medium.sectorCount !== 1040
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
	return (
		`made an ${fsId("atari", result.variant)} filesystem on ${parsed.image}: ` +
		`${result.freeSectors} free sectors${wasted}${boot}\n`
	);
}

function mkfsSparta(
	parsed: MkfsArgs,
	medium: AtrImage,
	bootSectors: Uint8Array | undefined,
	master: MasterFiles | undefined,
): string {
	// parseMkfsArgs requires the volume name when --fs sparta is explicit; a
	// 512-byte image that defaulted here (no --fs at all) has not passed that
	// gate, so it is enforced again once the family is settled.
	if ((parsed.volumeName ?? "").trim() === "") {
		throw new CliError(
			"a SpartaDOS filesystem needs a volume name (--volume-name NAME): " +
				"it identifies the disk for change detection, and SpartaDOS 1.1 " +
				"relies on it being unique",
		);
	}
	// SDX 4.50 formats every geometry as SDFS 2.1, so that is the default;
	// sdfs20 writes the same layout under the older revision byte.
	const variant = (parsed.variant as SpartaDosVariant | undefined) ?? "sdfs21";

	// A master's boot record travels verbatim: the parameter block inside
	// it is overwritten by the formatter anyway, so unlike the Atari DOS
	// family there is nothing to adapt.
	const record = master !== undefined ? master.boot : bootSectors;

	let result;
	try {
		result = formatSpartaDos(medium, variant, {
			...(record === undefined ? {} : { bootSectors: record }),
			...(parsed.volumeName === undefined
				? {}
				: { volumeName: parsed.volumeName }),
			// spift reclaims the last sector by default across every revision;
			// --reserve-last-sector opts into the pre-2.1 reserve.
			reclaimLastSector: !parsed.reserveLastSector,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new CliError(`${parsed.image}: ${message}`);
	}

	let installed: string | undefined;
	if (parsed.installDos && master !== undefined) {
		installed = installSpartaFrom(master, medium, parsed.image);
	}

	const wasted =
		result.unusableSectors > 0
			? `, ${result.unusableSectors} sector(s) beyond its reach`
			: "";
	const boot =
		installed !== undefined
			? `, boots ${installed}`
			: parsed.master !== undefined
				? `, boot record from ${parsed.master}, no DOS file`
				: parsed.bootSectors !== undefined
					? `, boot record from ${parsed.bootSectors}`
					: "";
	return (
		`made a ${fsId("sparta", result.variant)} filesystem on ${parsed.image}: ` +
		`${result.freeSectors} free sectors${wasted}${boot}\n`
	);
}

interface MasterFiles {
	/** The boot record, ready to be fitted and written. */
	boot: Uint8Array;
	/** Reads a file the master holds, or null when it has none. */
	read(name: string): Uint8Array | null;
	/** The opened image, when the master is one (not an unpacked tree). */
	opened: OpenedImage | undefined;
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
			opened: undefined,
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
		opened,
		name: path,
	};
}

/**
 * Copies the DOS across and points the boot record at it, the way a DOS's
 * own "write DOS files" does. DOS 1.0 has no DUP.SYS; every later one keeps
 * the menu in a second file beside DOS.SYS.
 */
function installAtariFrom(
	master: MasterFiles,
	medium: AtrImage,
	variant: AtariDosVariant,
	image: string,
): string[] {
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

/**
 * Copies a SpartaDOS master's boot file across and points the boot record
 * at the copy, the way XINIT and the BOOT command do. The file is found
 * through the master's own boot pointer - its name is arbitrary
 * (XBW130.DOS, X32G.DOS, ...), so only the pointer knows it.
 */
function installSpartaFrom(
	master: MasterFiles,
	medium: AtrImage,
	image: string,
): string {
	if (master.opened === undefined) {
		throw new CliError(
			`${master.name}: installing a SpartaDOS boot file needs an image ` +
				`master - only its boot record knows which file boots ` +
				`(an unpacked tree keeps no such pointer)`,
		);
	}
	const pointer = readSpartaDosFilePointer(master.opened.medium);
	if (pointer === 0) {
		throw new CliError(`${master.name} is not bootable, nothing to install`);
	}
	// The boot loader follows the pointer wherever the file lives - BW-DOS
	// distribution disks keep XBW130.DOS in a subdirectory - so the whole
	// tree is searched.
	const entry = [
		...master.opened.filesystem.entries(undefined, { recursive: true }),
	].find(
		(candidate) =>
			candidate.startSector === pointer && candidate.kind === "file",
	);
	if (entry === undefined) {
		throw new CliError(
			`${master.name}: its boot record points at sector map ${pointer}, ` +
				`which no file on the disk owns`,
		);
	}
	if (entry.name === "") {
		// Real disks exist whose boot file has an all-blank name (only the
		// pointer knows it); a nameless copy could never be addressed.
		throw new CliError(
			`${master.name}: its boot file has a blank name; copy it by hand ` +
				`and point set-dos-file at the copy`,
		);
	}
	const contents = master.opened.filesystem.readFile(entry.path);
	if (contents === null) {
		throw new CliError(`${master.name}: ${entry.path} did not read`);
	}
	for (const diagnostic of contents.diagnostics) {
		process.stderr.write(
			`spift: ${master.name}: ${entry.name}: ${diagnostic}\n`,
		);
	}
	const filesystem = openSpartaDos(medium);
	try {
		filesystem.writeFile(entry.name, contents.bytes);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new CliError(`${image}: ${entry.name}: ${message}`);
	}
	const landed = [...filesystem.entries()].find(
		(candidate) => candidate.name === entry.name,
	);
	if (landed?.startSector === undefined) {
		throw new CliError(`${image}: ${entry.name} did not land on the disk`);
	}
	writeSpartaDosFilePointer(medium, landed.startSector);
	return entry.name;
}
