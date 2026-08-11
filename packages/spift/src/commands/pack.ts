import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
	defaultAtariDosVariant,
	formatAtariDos,
	openAtariDos,
	writeAtariDosFilePointer,
	type AtariDosVariant,
} from "../atari-dos.ts";
import {
	ATR_MAX_SECTOR_COUNT,
	ATR_SECTOR_SIZES,
	createBlankAtr,
	openAtr,
	type AtrSectorSize,
} from "../atr.ts";
import { setBootable } from "../boot-record.ts";
import { writeBootSectors } from "../boot-sectors.ts";
import { CliError, UsageError } from "../cli-error.ts";
import { copyEntries } from "../copy.ts";
import { compileHostPattern, openHostDirectory } from "../host-dir.ts";
import { parseFsOption } from "./fs-option.ts";

/** The boot record, kept beside the files as an ordinary host file. */
export const BOOT_FILE = ".boot.bin";

export interface PackArgs {
	image: string;
	directory: string;
	variant: AtariDosVariant | undefined;
	sectorSize: AtrSectorSize;
	sectorCount: number;
	writeBootSectors: boolean;
	setDosFile: string | undefined;
	force: boolean;
	noTimestamps: boolean;
	text: string[];
	strict: boolean;
}

const GEOMETRY_SHORTHANDS = {
	sd: { sectorSize: 128, sectorCount: 720 },
	ed: { sectorSize: 128, sectorCount: 1040 },
	dd: { sectorSize: 256, sectorCount: 720 },
} as const;

export function parsePackArgs(args: string[]): PackArgs {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: {
				image: { type: "string", short: "i" },
				fs: { type: "string" },
				"sector-size": { type: "string" },
				"sector-count": { type: "string" },
				sd: { type: "boolean" },
				ed: { type: "boolean" },
				dd: { type: "boolean" },
				"write-boot-sectors": { type: "boolean" },
				"set-dos-file": { type: "string" },
				text: { type: "string", multiple: true },
				"no-timestamps": { type: "boolean" },
				strict: { type: "boolean" },
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

	const [directory = ".", ...extra] = positionals;
	const image = values.image;
	if (image === undefined) {
		throw new UsageError("missing --image (-i)");
	}
	if (extra.length > 0) {
		throw new UsageError(`unexpected argument "${extra[0]}"`);
	}

	// Pointing the boot record at a file only means something once there is
	// boot code to read it: without --write-boot-sectors the boot sectors are
	// the zeroes a fresh image was made with, and the pointer would sit in
	// them doing nothing.
	if (
		values["set-dos-file"] !== undefined &&
		values["write-boot-sectors"] !== true
	) {
		throw new UsageError(
			`--set-dos-file needs --write-boot-sectors: with no boot code on ` +
				`the image there is nothing to follow the pointer`,
		);
	}

	const shorthands = (["sd", "ed", "dd"] as const).filter((k) => values[k]);
	if (shorthands.length > 1) {
		throw new UsageError(
			`--${shorthands.join(" and --")} are mutually exclusive`,
		);
	}
	const shorthand = shorthands[0];
	if (
		shorthand !== undefined &&
		(values["sector-size"] !== undefined ||
			values["sector-count"] !== undefined)
	) {
		throw new UsageError(
			`--${shorthand} cannot be combined with --sector-size or ` +
				`--sector-count`,
		);
	}

	const number = (
		text: string | undefined,
		flag: string,
	): number | undefined => {
		if (text === undefined) {
			return undefined;
		}
		if (!/^\d+$/.test(text) || Number(text) === 0) {
			throw new UsageError(`${flag} must be a positive integer`);
		}
		return Number(text);
	};
	const geometry =
		shorthand === undefined ? undefined : GEOMETRY_SHORTHANDS[shorthand];
	const sectorSize = number(values["sector-size"], "--sector-size");
	if (
		sectorSize !== undefined &&
		!ATR_SECTOR_SIZES.includes(sectorSize as AtrSectorSize)
	) {
		throw new UsageError(
			`invalid --sector-size ${sectorSize} ` +
				`(supported: ${ATR_SECTOR_SIZES.join(", ")})`,
		);
	}
	const sectorCount = number(values["sector-count"], "--sector-count");
	if (sectorCount !== undefined && sectorCount > ATR_MAX_SECTOR_COUNT) {
		throw new UsageError(
			`--sector-count ${sectorCount} is too large ` +
				`(at most ${ATR_MAX_SECTOR_COUNT})`,
		);
	}

	const selection =
		values.fs === undefined ? undefined : parseFsOption(values.fs, "--fs");
	if (selection?.family === "sparta") {
		throw new CliError("SpartaDOS filesystem support is not implemented yet");
	}

	return {
		image,
		directory,
		variant: selection?.variant,
		sectorSize:
			(sectorSize as AtrSectorSize | undefined) ?? geometry?.sectorSize ?? 128,
		sectorCount: sectorCount ?? geometry?.sectorCount ?? 720,
		writeBootSectors: values["write-boot-sectors"] ?? false,
		setDosFile: values["set-dos-file"],
		force: values.force ?? false,
		noTimestamps: values["no-timestamps"] ?? false,
		text: values.text ?? [],
		strict: values.strict ?? false,
	};
}

export async function packCommand(args: string[]): Promise<void> {
	const parsed = parsePackArgs(args);

	let source;
	try {
		source = openHostDirectory(parsed.directory);
	} catch (error) {
		throw new CliError(error instanceof Error ? error.message : String(error));
	}

	// Build the whole image in memory: geometry, then a filesystem, then the
	// boot record, then the files. Nothing reaches the disk until all of it
	// has worked.
	const medium = openAtr(
		createBlankAtr({
			sectorSize: parsed.sectorSize,
			sectorCount: parsed.sectorCount,
		}),
	);
	let variant = parsed.variant;
	if (variant === undefined) {
		variant = defaultAtariDosVariant(medium.sectorSize, medium.sectorCount);
		if (variant === undefined) {
			throw new CliError(
				`enhanced density fits both DOS 2.5 and MyDOS equally well; ` +
					`pick one with --fs atari/dos25 or --fs atari/mydos`,
			);
		}
	}

	const fail = (error: unknown): never => {
		if (error instanceof CliError) {
			throw error;
		}
		throw new CliError(error instanceof Error ? error.message : String(error));
	};

	try {
		formatAtariDos(medium, variant);
	} catch (error) {
		fail(error);
	}

	if (parsed.writeBootSectors) {
		const where = join(parsed.directory, BOOT_FILE);
		let boot;
		try {
			boot = await readFile(where);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw new CliError(
					`${where}: no boot record to write (unpack writes one with ` +
						`--extract-boot-sectors)`,
				);
			}
			throw error;
		}
		try {
			// The boot record is laid down before the filesystem's own
			// structures are anyone's concern, and a mismatched count byte is
			// the packer's problem, not ours to second-guess.
			writeBootSectors(medium, boot, { force: true, pad: true });
		} catch (error) {
			fail(error);
		}
	}

	// Repeatable, since a directory holds more than one kind of text file
	// and keeping only the last pattern would quietly leave the rest as
	// bytes.
	const textPatterns = parsed.text.map((pattern) =>
		compileHostPattern(pattern),
	);

	let bootFile: string | undefined;
	const filesystem = openAtariDos(medium, variant);
	let result;
	try {
		result = copyEntries(source, filesystem, {
			sources: ["*"],
			destination: "/",
			recursive: true,
			force: true,
			noAttributes: false,
			attributes: variant === "dos10" ? ["AtariDos10"] : undefined,
			// As unpack: pack takes the whole directory, so the text files
			// have to be named rather than assumed.
			text: textPatterns.length > 0,
			textMatch:
				textPatterns.length === 0
					? undefined
					: (entry) => textPatterns.some((matches) => matches(entry.name)),
			strict: parsed.strict,
			// An archiver carries timestamps unless told not to, like tar.
			preserveTimestamps: !parsed.noTimestamps,
			move: false,
		});
	} catch (error) {
		fail(error);
		return;
	}

	// A boot record from .boot.bin carries the sector its old disk kept the
	// DOS at, and repacking almost never puts it back there - so the pointer
	// is stale by construction and has to be dealt with either way. Left
	// alone it points at whatever landed on that sector, and the disk claims
	// to boot from it.
	if (parsed.writeBootSectors) {
		const wanted = (parsed.setDosFile ?? "dos.sys").toLowerCase();
		const entry = [...filesystem.entries()].find(
			(candidate) => candidate.name === wanted && candidate.kind === "file",
		);
		if (entry?.startSector !== undefined) {
			writeAtariDosFilePointer(medium, variant, entry.startSector);
			bootFile = wanted;
		} else if (parsed.setDosFile !== undefined) {
			throw new CliError(`no file named ${wanted} to boot from`);
		} else {
			// Nothing to boot: say so in the record rather than leave it
			// aimed at a sector that now holds something else.
			writeAtariDosFilePointer(medium, variant, 0);
			const record = medium.readSector(1);
			if (record !== null) {
				setBootable(record, false, medium.sectorSize);
				medium.writeSector(1, record);
			}
		}
	}

	await writeFile(parsed.image, medium.bytes, {
		flag: parsed.force ? "w" : "wx",
	}).catch((error: NodeJS.ErrnoException) => {
		if (error.code === "EEXIST") {
			throw new CliError(
				`${parsed.image} already exists, not overwriting (use --force)`,
			);
		}
		throw error;
	});

	let damaged = false;
	for (const file of result.files) {
		for (const diagnostic of file.diagnostics) {
			process.stderr.write(`spift: ${file.from}: ${diagnostic}\n`);
			damaged = true;
		}
	}
	const boot = !parsed.writeBootSectors
		? ""
		: `, boot record from ${BOOT_FILE}` +
			(bootFile === undefined
				? " (no dos.sys packed, so not bootable)"
				: `, booting ${bootFile}`);
	process.stdout.write(
		`packed ${result.files.length} file(s) from ${parsed.directory} into ` +
			`${parsed.image} as atari/${variant}${boot}\n`,
	);
	if (damaged) {
		process.exitCode = 1;
	}
}
