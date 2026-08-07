#!/usr/bin/env node
import { CliError, UsageError } from "./cli-error.ts";
import { createCommand } from "./commands/create.ts";
import { extractBootSectorsCommand } from "./commands/extract-boot-sectors.ts";
import { installDosCommand } from "./commands/install-dos.ts";
import { lsCommand } from "./commands/ls.ts";
import { setDosFileCommand } from "./commands/set-dos-file.ts";
import { mkdirCommand } from "./commands/mkdir.ts";
import { mkfsCommand } from "./commands/mkfs.ts";
import { cpCommand } from "./commands/cp.ts";
import { mvCommand } from "./commands/mv.ts";
import { rmCommand } from "./commands/rm.ts";
import { rmdirCommand } from "./commands/rmdir.ts";
import { writeBootSectorsCommand } from "./commands/write-boot-sectors.ts";

const USAGE = `usage: spift <command> -i IMAGE [paths...] [options]

Every command names the image it works on with --image (-i); positional
arguments are paths inside that image unless a command says otherwise.

cp and mv work on two containers at once, written [CONTAINERS] below:

  -i, --image IMAGE     both sides are this image
  --from CONTAINER      read from here (an image, or a host directory)
  --to CONTAINER        write to here
  --fs FILESYSTEM       force how a container is read; --from-fs and
                        --to-fs override one side

A side with no flag is the host, where paths mean what they mean in the
shell - so --from alone copies out and --to alone copies in. A host
directory named outright is a container instead, and paths stay inside
it. At least one side must be an image.

commands:
  create -i FILE [-t TYPE] [-f] [--sd | --ed | --dd]
                 [--sector-size N] [--sector-count N]
    Create a blank image (all zeroes, no filesystem). TYPE is inferred from
    the file name when omitted; supported types: atr. Defaults to --sd
    (720 x 128-byte sectors); --ed is 1040 x 128 and --dd is 720 x 256.
    Refuses to overwrite an existing file unless --force (-f) is given.

  mkfs -i IMAGE [--fs atari/VARIANT | --variant VARIANT]
               [--boot-sectors FILE]
    Write an empty filesystem onto an image. Variants: dos10, dos20s,
    dos20d, dos25, mydos. Without one, a standard single-density image
    gets dos20s, enhanced density is refused as ambiguous (dos25 and
    mydos both fit), and anything else gets mydos. --boot-sectors fills
    the boot area from a file sized exactly for the variant.

  ls -i IMAGE [SPEC] [--fs FILESYSTEM] [-l] [-v] [-R]
    List a directory of the filesystem on an image. SPEC is a path whose
    last part may be a native wildcard pattern (* and ?; name and
    extension match separately; quote it to keep the shell out of it);
    naming a directory lists its contents. Separators: / > or :, plus
    SpartaDOS's < which also steps up a level. The
    filesystem is autodetected; --fs overrides. --long (-l) leads with
    status lines (image, then filesystem) and adds sector counts, start
    sectors, and attributes. --verbose (-v) also lists what a directory
    listing passes over: deleted files and ones left open for output.
    --recursive (-R) descends into subdirectories, showing full paths.

  rm -i IMAGE SPEC... [--fs FILESYSTEM] [-f] [-r]
    Remove files matching the SPECs (native wildcards, quoted). Locked
    files need --force (-f), which also quiets specs that match nothing.
    --recursive (-r) descends into subdirectories and removes them too,
    deepest first.

  mkdir -i IMAGE DIRECTORY... [--fs FILESYSTEM] [-p]
    Create directories. --parents (-p) makes missing parents on the way
    and accepts one that already exists. A directory needs eight
    contiguous free sectors, so this can fail on a fragmented disk with
    plenty of room.

  mv [CONTAINERS] SOURCE... DESTINATION [-f] [--no-attributes]
     [--remove-source]
    Rename or move entries. DESTINATION is a directory when it ends in a
    separator or names one, and otherwise a name template applied to each
    match: * copies the source from that position to the end of the
    field, ? copies one character, anything else replaces (so '*.lst'
    '*.txt' re-extensions a batch, as the DOSes' own RENAME does).
    Renaming inside a directory only rewrites the entry; moving between
    directories may renumber the file's sectors. A move across containers
    copies and then removes, target written first. Moving off the host
    needs --remove-source: an image's entries survive deletion under the
    deleted flag, host files do not.

  cp [CONTAINERS] SOURCE... DESTINATION [-R] [-f] [--no-attributes]
    Copy entries, with the same DESTINATION rules as mv - a template is
    the target's own rename rule, so '*.ttt' '*.txt' works copying out to
    the host as well as in. --recursive (-R) is needed to copy a
    directory. With the host on one side this puts files onto an image or
    takes them off; with images on both it copies between them.

  rmdir -i IMAGE DIRECTORY... [--fs FILESYSTEM]
    Remove empty directories, freeing what they occupied. A directory
    holding anything is refused, as the DOSes refuse it.

  write-boot-sectors -i IMAGE BOOT_FILE [--pad] [-f]
    Write a boot file over the image's first sectors (128-byte boot
    sectors on 256-bps images are handled). The file must span a whole
    number of sectors - --pad zero-fills the tail - and its second byte
    must claim that count; --force (-f) writes despite a mismatch.

  set-dos-file -i IMAGE [NAME] [--fs FILESYSTEM] [--clear]
    Point the image's boot record at the file it should load (default:
    dos.sys), which is what makes a disk bootable. --clear unsets it.

  install-dos -i IMAGE --from MASTER_IMAGE [--fs FILESYSTEM] [-f]
    Copy a DOS from a master disk: its boot sectors, the file its boot
    record loads, and DUP.SYS beside it, then point the boot record at
    the copy. Refuses masters whose boot area or density does not match
    the target's filesystem. --force (-f) overwrites existing files.

  extract-boot-sectors -i IMAGE OUTPUT_FILE [--sector-count N] [-f]
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
		case "rm":
			await rmCommand(args);
			break;
		case "mkdir":
			await mkdirCommand(args);
			break;
		case "mv":
			await mvCommand(args);
			break;
		case "cp":
			await cpCommand(args);
			break;
		case "rmdir":
			await rmdirCommand(args);
			break;
		case "write-boot-sectors":
			await writeBootSectorsCommand(args);
			break;
		case "extract-boot-sectors":
			await extractBootSectorsCommand(args);
			break;
		case "set-dos-file":
			await setDosFileCommand(args);
			break;
		case "install-dos":
			await installDosCommand(args);
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
