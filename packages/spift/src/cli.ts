#!/usr/bin/env node
import { CliError, UsageError } from "./cli-error.ts";
import { addCommand } from "./commands/add.ts";
import { createCommand } from "./commands/create.ts";
import { extractBootSectorsCommand } from "./commands/extract-boot-sectors.ts";
import { extractCommand } from "./commands/extract.ts";
import { lsCommand } from "./commands/ls.ts";
import { mkfsCommand } from "./commands/mkfs.ts";
import { rmCommand } from "./commands/rm.ts";
import { writeBootSectorsCommand } from "./commands/write-boot-sectors.ts";

const USAGE = `usage: spift <command> [options]

commands:
  create FILENAME [-t TYPE] [-f] [--sd | --ed | --dd]
                  [--sector-size N] [--sector-count N]
    Create a blank image (all zeroes, no filesystem). TYPE is inferred from
    the file name when omitted; supported types: atr. Defaults to --sd
    (720 x 128-byte sectors); --ed is 1040 x 128 and --dd is 720 x 256.
    Refuses to overwrite an existing file unless --force (-f) is given.

  mkfs IMAGE_FILE [--fs atari/VARIANT | --variant VARIANT]
                  [--boot-sectors FILE]
    Write an empty filesystem onto an image. Variants: dos10, dos20s,
    dos20d, dos25, mydos. Without one, a standard single-density image
    gets dos20s, enhanced density is refused as ambiguous (dos25 and
    mydos both fit), and anything else gets mydos. --boot-sectors fills
    the boot area from a file sized exactly for the variant.

  ls IMAGE_FILE [SPEC] [--fs atari|sparta] [-l]
    List the root directory of the filesystem on an image. SPEC filters
    with native wildcards (* and ?; name and extension match separately;
    quote it to keep the shell from expanding it). The filesystem is
    autodetected; --fs overrides. --long (-l) adds sector counts, start
    sectors, and attributes.

  extract IMAGE_FILE [SPEC] [-o DIR] [--fs atari|sparta] [-f]
    Extract files matching SPEC (default: all) from the root directory
    into DIR (default: the current directory, created if missing). Host
    names are lowercased and made filesystem-safe. Refuses to overwrite
    existing files unless --force (-f) is given; damaged files extract
    what is recoverable, with warnings, and exit 1.

  add IMAGE_FILE FILE... [--fs FILESYSTEM] [-f]
    Add host files to the root directory of the filesystem on an image.
    Names convert to uppercase 8.3 (letters, digits, _ and @; anything
    else becomes _). Two sources mangling to the same name is an error;
    overwriting a file already on the image requires --force (-f).
    Files are written in DOS 2 format by default, whatever the disk was
    formatted with, and may use any sector the bitmap says is free.
    --fs atari/dos10 writes DOS 1.0 format files instead (readable only
    by DOS 1.0); --fs also accepts a bare family to skip detection.

  rm IMAGE_FILE SPEC... [--fs atari|sparta] [-f]
    Remove files matching the SPECs (native wildcards, quoted) from the
    root directory. Locked files need --force (-f), which also quiets
    specs that match nothing. Directories cannot be removed yet.

  write-boot-sectors IMAGE_FILE BOOT_FILE [--pad] [-f]
    Write a boot file over the image's first sectors (128-byte boot
    sectors on 256-bps images are handled). The file must span a whole
    number of sectors - --pad zero-fills the tail - and its second byte
    must claim that count; --force (-f) writes despite a mismatch.

  extract-boot-sectors IMAGE_FILE OUTPUT_FILE [--sector-count N] [-f]
    Extract the boot sectors into a file. The count comes from the boot
    record's second byte; when that claims zero or more sectors than the
    image holds, --sector-count is required. Refuses to overwrite an
    existing file unless --force (-f) is given.
`;

async function main(): Promise<void> {
	const [command, ...args] = process.argv.slice(2);
	switch (command) {
		case "create":
			await createCommand(args);
			break;
		case "mkfs":
			await mkfsCommand(args);
			break;
		case "ls":
			await lsCommand(args);
			break;
		case "extract":
			await extractCommand(args);
			break;
		case "add":
			await addCommand(args);
			break;
		case "rm":
			await rmCommand(args);
			break;
		case "write-boot-sectors":
			await writeBootSectorsCommand(args);
			break;
		case "extract-boot-sectors":
			await extractBootSectorsCommand(args);
			break;
		case undefined:
		case "help":
		case "--help":
		case "-h":
			process.stdout.write(USAGE);
			if (command === undefined) {
				process.exit(2);
			}
			break;
		default:
			throw new UsageError(`unknown command "${command}"`);
	}
}

main().catch((error: unknown) => {
	if (error instanceof CliError) {
		process.stderr.write(`spift: ${error.message}\n`);
		process.exit(error.exitCode);
	}
	const detail =
		error instanceof Error ? (error.stack ?? error.message) : String(error);
	process.stderr.write(`${detail}\n`);
	process.exit(1);
});
