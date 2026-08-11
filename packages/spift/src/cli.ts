#!/usr/bin/env node
import { CliError, UsageError } from "./cli-error.ts";
import { catCommand } from "./commands/cat.ts";
import { chattrCommand } from "./commands/chattr.ts";
import { convertCommand } from "./commands/convert.ts";
import { createCommand } from "./commands/create.ts";
import { extractBootSectorsCommand } from "./commands/extract-boot-sectors.ts";
import { hexdumpCommand } from "./commands/hexdump.ts";
import { installDosCommand } from "./commands/install-dos.ts";
import { setDosFileCommand } from "./commands/set-dos-file.ts";
import { lsCommand } from "./commands/ls.ts";
import { mkdirCommand } from "./commands/mkdir.ts";
import { mkfsCommand } from "./commands/mkfs.ts";
import { packCommand } from "./commands/pack.ts";
import { recodeCommand } from "./commands/recode.ts";
import { unpackCommand } from "./commands/unpack.ts";
import { cpCommand } from "./commands/cp.ts";
import { mvCommand } from "./commands/mv.ts";
import { rmCommand } from "./commands/rm.ts";
import { rmdirCommand } from "./commands/rmdir.ts";
import { writeBootSectorsCommand } from "./commands/write-boot-sectors.ts";

// The help text, split per command so `spift help CMD` and `spift CMD
// --help` can show one without the other eighteen.
const GENERAL = `usage: spift <command> -i IMAGE [paths...] [options]

Every command names the image it works on with --image (-i); positional
arguments are paths inside that image unless a command says otherwise.`;

/** Shown with cp and mv, whose synopses say [CONTAINERS]. */
const CONTAINERS = `cp and mv work on two containers at once, written [CONTAINERS] below:

  -i, --image IMAGE     both sides are this image
  --from CONTAINER      read from here (an image, or a host directory)
  --to CONTAINER        write to here
  --fs FILESYSTEM       force how a container is read; --from-fs and
                        --to-fs override one side

A side with no flag is the host, where paths mean what they mean in the
shell - so --from alone copies out and --to alone copies in. A host
directory named outright is a container instead, and paths stay inside
it. At least one side must be an image.`;

const HELP: Record<string, string> = {
	create: `  create -i FILE [-t TYPE] [-f] [--sd | --ed | --dd]
                 [--sector-size N] [--sector-count N]
    Create a blank image (all zeroes, no filesystem). TYPE is inferred from
    the file name when omitted; supported types: atr. Defaults to --sd
    (720 x 128-byte sectors); --ed is 1040 x 128 and --dd is 720 x 256.
    Refuses to overwrite an existing file unless --force (-f) is given.`,
	mkfs: `  mkfs -i IMAGE [--fs FILESYSTEM] [--master IMAGE|DIR]
               [--install-dos] [--boot-sectors FILE] [--volume-name NAME]
    Write an empty filesystem onto an image. Variants: dos10, dos20 (also
    spelled dos20s, dos20d or mydos) and dos25. DOS 2.0 and MyDOS are one
    filesystem - their VTOCs differ in a single bit, whether sector 720 is
    reserved, and only on a 720-sector disk - so the two names part company
    there and nowhere else. Without a variant the geometry decides, except
    at enhanced density, where DOS 2.5 and the DOS 2.0 layout both fit and
    you have to say which.

    --fs sparta makes a SpartaDOS filesystem instead, matching SDX 4.50's
    own FORMAT byte for byte; sdfs21 (what SDX writes everywhere) is the
    default and sparta/sdfs20 spells the older revision. --volume-name is
    required for SpartaDOS (it identifies the disk for change detection,
    and 1.1 relies on it being unique). --master with --install-dos copies
    the master's boot file - found through its boot pointer, since
    SpartaDOS boot files have arbitrary names - and points the new disk at
    the copy.

    The boot area gets spift's own record by default: it says the disk has
    no DOS and waits for RESET. --master takes the record from a disk (or
    an unpacked directory with .boot.bin) and fits it to this geometry -
    two bytes, measured, and nothing at all for SpartaDOS, whose record
    travels verbatim - and --install-dos then copies DOS.SYS, and
    DUP.SYS unless DOS 1.0, and marks the disk bootable. --boot-sectors
    writes a file verbatim instead, and cannot be combined with --master.`,
	ls: `  ls -i IMAGE [SPEC] [--fs FILESYSTEM] [-l] [-v] [-R]
    List a directory of the filesystem on an image. SPEC is a path whose
    last part may be a native wildcard pattern (* and ?; name and
    extension match separately; quote it to keep the shell out of it);
    naming a directory lists its contents. Separators: / > or :, plus
    SpartaDOS's < which also steps up a level. The
    filesystem is autodetected; --fs overrides. --long (-l) leads with
    status lines (image, then filesystem) and adds sector counts, start
    sectors, and attributes. --verbose (-v) also lists what a directory
    listing passes over: deleted files and ones left open for output.
    --recursive (-R) descends into subdirectories, showing full paths.`,
	rm: `  rm -i IMAGE SPEC... [--fs FILESYSTEM] [-f] [-r]
    Remove files matching the SPECs (native wildcards, quoted). Locked
    files need --force (-f), which also quiets specs that match nothing.
    --recursive (-r) descends into subdirectories and removes them too,
    deepest first.`,
	mkdir: `  mkdir -i IMAGE DIRECTORY... [--fs FILESYSTEM] [-p]
    Create directories. --parents (-p) makes missing parents on the way
    and accepts one that already exists. A directory needs eight
    contiguous free sectors, so this can fail on a fragmented disk with
    plenty of room.`,
	mv: `  mv [CONTAINERS] SOURCE... DESTINATION [-f] [--no-attributes]
     [--remove-source] [--text] [--strict] [--eol lf | crlf | native]
    Rename or move entries. DESTINATION is a directory when it ends in a
    separator or names one, and otherwise a name template applied to each
    match: * copies the source from that position to the end of the
    field, ? copies one character, anything else replaces (so '*.lst'
    '*.txt' re-extensions a batch, as the DOSes' own RENAME does).
    Renaming inside a directory only rewrites the entry; moving between
    directories may renumber the file's sectors. A move across containers
    copies and then removes, target written first. Moving off the host
    needs --remove-source: an image's entries survive deletion under the
    deleted flag, host files do not.`,
	cp: `  cp [CONTAINERS] SOURCE... DESTINATION [-R] [-f] [-p]
     [--no-attributes] [--text] [--strict] [--eol lf | crlf | native]
    Copy entries, with the same DESTINATION rules as mv - a template is
    the target's own rename rule, so '*.ttt' '*.txt' works copying out to
    the host as well as in. --recursive (-R) is needed to copy a
    directory. With the host on one side this puts files onto an image or
    takes them off; with images on both it copies between them.
    --preserve (-p) carries timestamps across, as cp -p does everywhere
    (SpartaDOS entries and host mtimes carry them; Atari DOS has none);
    without it the target stamps its own clock. mv always carries them.`,
	chattr: `  chattr -i IMAGE SETTING... SPEC... [--fs FILESYSTEM] [-R] [-f]
    Change what an entry carries. A SETTING is name=on or name=off, and
    the leading positionals that hold an "=" are the settings; the rest
    are specs. Names are the ones ls -l prints: read-only (also spelled
    locked or protected), dos1, and on SpartaDOS hidden, archived and
    symlink (each one bit, set on any revision). The others it prints are
    not flags to set - dos2.5 and mydos say where a file's sectors are,
    dos-file lives in the boot record, deleted is rm's business - each says
    so.
    read-only is one bit in the directory entry; dos1 is the data sector
    encoding, so changing it rewrites the file and reallocates its chain,
    which needs --force (-f) on a read-only one.`,
	convert: `  convert -i IMAGE OUTPUT [-t TYPE] [-f]
    Rewrite an image in another container format. The output type comes
    from its file name, or --type (-t). spift reads atr and dcm (Disk
    Communicator, also seen as .dc3) and writes atr - a DCM holds exactly
    the sectors an ATR does, so nothing is lost either way. Refuses to
    overwrite an existing file unless --force (-f) is given.`,
	recode: `  recode [-f CODE] [-t CODE] [FILE...] [--in-place] [--strict]
         [--eol lf | crlf | native]
    Convert text between a family character set and Unicode, writing to
    stdout (or reading stdin with no FILE). Codes: atascii, unicode,
    escaped-unicode; whichever of --from (-f) and --to (-t) you leave out
    is unicode. Inverse video is bracketed by "~", a line ending is EOL,
    and {ddd} or {$hh} is a byte outright - so both Unicode flavours
    round-trip, escaped-unicode writing the Atari graphics as escapes
    rather than glyphs. Anything with no ATASCII character becomes "?";
    --strict refuses instead, and also catches a "~" that opens inverse
    video and never closes it, which is what ordinary text holding a
    tilde looks like. --eol picks what EOL becomes (decoding only;
    encoding takes LF, CR, and CRLF alike). --in-place converts the files
    named rather than writing to stdout.`,
	pack: `  pack -i IMAGE [DIR] [--fs FILESYSTEM] [--sd | --ed | --dd]
       [--sector-size N] [--sector-count N] [--write-boot-sectors]
       [--set-dos-file NAME] [--text SPEC]... [--strict] [-f]
       [--no-timestamps]
    Build an image from a host directory (default: the current one):
    create it, put a filesystem on it, and copy the tree in. Geometry and
    filesystem options are create's and mkfs's. --write-boot-sectors
    takes the boot record from .boot.bin in the directory and points it at
    dos.sys wherever packing put it - the record carries its old disk's
    sector, which repacking rarely reuses - or marks the disk not bootable
    when no dos.sys was packed. --set-dos-file NAME overrides that name,
    and needs --write-boot-sectors, since otherwise there is no boot code
    to follow the pointer. --text SPEC recodes the files it names into the family
    character set - a whole directory holds binaries too, so they have to
    be named - with --strict to refuse what will not survive. Host mtimes
    become entry timestamps where the filesystem has them (SpartaDOS),
    as an archiver does; --no-timestamps stamps pack time instead.
    Refuses to overwrite an existing image without -f.`,
	unpack: `  unpack -i IMAGE [DIR] [--fs FILESYSTEM] [--extract-boot-sectors]
         [--text SPEC]... [--eol lf | crlf | native] [-f]
         [--no-timestamps]
    Explode an image into a host directory (default: the current one),
    made if missing, mirroring the whole tree.
    --extract-boot-sectors also writes the boot record to .boot.bin
    there, which is what lets pack rebuild a bootable disk. --text SPEC
    recodes the files it names out of the family character set (a whole
    disk holds binaries too) and repeats for more than one pattern, with
    --eol picking what EOL becomes. Entry timestamps become the extracted
    files' mtimes, as an archiver does; --no-timestamps leaves extraction
    time. Refuses to overwrite existing files without -f.`,
	rmdir: `  rmdir -i IMAGE DIRECTORY... [--fs FILESYSTEM]
    Remove empty directories, freeing what they occupied. A directory
    holding anything is refused, as the DOSes refuse it.`,
	"write-boot-sectors": `  write-boot-sectors -i IMAGE BOOT_FILE [--pad] [-f]
    Write a boot file over the image's first sectors (128-byte boot
    sectors on 256-bps images are handled). The file must span a whole
    number of sectors - --pad zero-fills the tail - and its second byte
    must claim that count; --force (-f) writes despite a mismatch.`,
	"install-dos": `  install-dos -i IMAGE --from MASTER_IMAGE [--fs FILESYSTEM] [-f]
    Copy a DOS from a master disk: its boot sectors, the file its boot
    record loads, and DUP.SYS beside it, then point the boot record at
    the copy. Refuses masters whose boot area or density does not match
    the target's filesystem. --force (-f) overwrites existing files.`,
	"set-dos-file": `  set-dos-file -i IMAGE [NAME] [--fs FILESYSTEM] [--clear]
    Point the boot record at the file the disk should boot. On SpartaDOS
    the boot file is arbitrary and naming it is the point (there is no
    default; XBW130.DOS, X32G.DOS, ...). On Atari DOS disks this is not
    something to do by hand - mkfs --install-dos maintains it - but the
    pointer can be repaired here; NAME defaults to dos.sys. --clear
    makes the disk not boot.`,
	cat: `  cat -i IMAGE SPEC... [--fs FILESYSTEM] [--eol lf | crlf | native]
    Write files from an image to stdout as text, reading them in the
    family character set - see recode, whose conversion this is. SPECs
    are matched as ls matches them, so wildcards work and several files
    concatenate. Always text, because that is what an image holds: the
    raw bytes of a binary belong in hexdump, and recoding also means a
    file cannot paint your terminal with escape codes. The host has
    cat(1), so this one only reads images.`,
	hexdump: `  hexdump -i IMAGE SPEC... | -s SECTOR[-SECTOR] [--fs FILESYSTEM]
    Dump bytes: offset, hex, and the glyphs an Atari would show for them,
    with inverse video shown in reverse video. That last column is why
    this exists rather than piping to xxd, which renders EOL and every
    graphics character as a dot. --sectors (-s) dumps sectors instead of
    files, which reaches the parts no file occupies - boot record, VTOC,
    directory.`,
	"extract-boot-sectors": `  extract-boot-sectors -i IMAGE OUTPUT_FILE [--sector-count N] [-f]
    Extract the boot sectors into a file. The count comes from the boot
    record's second byte; when that claims zero or more sectors than the
    image holds, --sector-count is required. Refuses to overwrite an
    existing file unless --force (-f) is given.`,
};

/** Every command's block, which is what `spift help` alone prints. */
function usage(): string {
	return (
		`${GENERAL}

${CONTAINERS}

commands:
` +
		Object.values(HELP).join("\n\n") +
		"\n"
	);
}

/**
 * One command's block. cp and mv get the container flags with it, since
 * their synopses are written in terms of them.
 */
function commandHelp(name: string): string | undefined {
	const block = HELP[name];
	if (block === undefined) {
		return undefined;
	}
	return name === "cp" || name === "mv"
		? `${block}

${CONTAINERS}
`
		: `${block}
`;
}

const COMMAND_NAMES = Object.keys(HELP).sort();

async function main(): Promise<void> {
	const [command, ...args] = process.argv.slice(2);

	// `spift help CMD` and `spift CMD --help` show one command's block. The
	// second is caught here rather than in each parser, so asking for help
	// works even when the rest of the line is wrong or missing.
	if (command === "help" || command === "--help" || command === "-h") {
		const wanted = args[0];
		if (wanted === undefined) {
			process.stdout.write(usage());
			return;
		}
		const help = commandHelp(wanted);
		if (help === undefined) {
			throw new UsageError(
				`unknown command "${wanted}" ` +
					`(commands: ${COMMAND_NAMES.join(", ")})`,
			);
		}
		process.stdout.write(help);
		return;
	}
	if (command !== undefined && args.some((a) => a === "-h" || a === "--help")) {
		const help = commandHelp(command);
		if (help !== undefined) {
			process.stdout.write(help);
			return;
		}
	}

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
		case "chattr":
			await chattrCommand(args);
			break;
		case "cat":
			await catCommand(args);
			break;
		case "hexdump":
			await hexdumpCommand(args);
			break;
		case "convert":
			await convertCommand(args);
			break;
		case "recode":
			await recodeCommand(args);
			break;
		case "pack":
			await packCommand(args);
			break;
		case "unpack":
			await unpackCommand(args);
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
		case "install-dos":
			await installDosCommand(args);
			break;
		case "set-dos-file":
			await setDosFileCommand(args);
			break;
		case undefined:
			process.stdout.write(usage());
			process.exit(2);
			break;
		default:
			throw new UsageError(
				`unknown command "${command}" ` +
					`(commands: ${COMMAND_NAMES.join(", ")})`,
			);
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
