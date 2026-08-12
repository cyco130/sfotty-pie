# Spift

**Spift** (**S**fotty **P**ie **I**mage **F**ile **T**ool) aims to be a Swiss army knife for retro file formats. It is both a library (that will power the future a8-web disk browser) and a `spift` command-line tool.

Current features include:

- Creating, reading, and writing `.atr` disk images
- Reading `.dcm` (aka `.dc3`) disk images and converting them to `.atr`
- Managing files and directories on disk images in several Atari DOS and SpartaDOS [file system variants](#supported-file-systems-and-variants)
- Converting text between ATASCII and Unicode
- Hex dumping files or disk sectors

## Installation

```sh
npm install -g @sfotty-pie/spift # Global installation for the CLI
npm install -S @sfotty-pie/spift # Local installation for Node.js projects
```

## CLI usage

The command-line tool consists of multiple subcommands, invoked as `spift <SUBCOMMAND> [OPTIONS] [ARGS...]`. Subcommand names usually mirror the Unix commands they resemble, like `spift ls`, `spift cp`, and `spift mv` etc. Use `spift help <SUBCOMMAND>` or `spift <SUBCOMMAND> --help` (or `-h`) to see the options and arguments for a subcommand.

The following subcommands are currently implemented:

- `unpack`: Extract disk image contents into a directory
- `pack`: Create a disk image from a directory
- `convert`: Convert between disk image formats
- `create`: Create an empty disk image
- `mkfs`: Create an empty file system on a disk image
- `ls`: List files and directories on a disk image
- `rm`: Remove files from a disk image
- `mkdir`: Create a directory on a disk image
- `rmdir`: Remove an empty directory from a disk image
- `cp`: Copy files within or between disk images and the host file system
- `mv`: Move/rename files within or between disk images and the host file system
- `chattr`: Change file attributes of a file on a disk image
- `install-dos`: Install a DOS on a disk image from a master image or directory
- `write-boot-sectors`: Write a boot record to a disk image
- `extract-boot-sectors`: Extract the boot record from a disk image
- `set-dos-file`: Set the DOS file on a SpartaDOS disk image
- `cat`: Display the contents of a file on a disk image as text
- `hexdump`: Display the contents of a file or disk sectors as hex
- `recode`: Convert between ATASCII and Unicode text

Commands that operate on a disk image accept an `-i` or `--image` option to specify the disk image file. Commands that operate on a source and destination accept `--from` and `--to` options to specify the source and destination disk images, respectively (`-i` sets both `--from` and `--to` to the same image).

For commands that operate on files inside a disk image, the file system and variant can be specified with `--fs`. It's normally not necessary to specify it except for `mkfs` since `spift` can usually automatically detect the file system and variant.

Commands that take a file or directory specifier accept `*` and `?` as wildcards, and `>`, `:`, or `/` as directory separators. `<` is also supported for going up one level. Make sure to quote any wildcard patterns and `<` or `>` to prevent the shell from processing them before `spift` sees them. In most Unix shells, you can use single quotes (`'`) for this purpose.

## Supported file systems and variants

`spift` currently supports the following file systems and variants:

- Atari DOS family:
  - `atari/10` (Atari DOS 1.0): A rarely used variant, incompatible with later versions. It supports 720x128-byte sectors only. `mkfs` can create this file system on larger disk and use up to 943 sectors. The real DOS 1.0 will be able to read such images but will not allocate sectors above 719.
  - `atari/20` (Atari DOS 2.0S and 2.0D): The common denominator of the Atari DOS family. It supports 720x128- and 720x256-byte sectors. `mkfs` can create this file system on larger disk and use up to 943 sectors. The real DOS 2.0 will be able to read such images but will not allocate sectors above 719. MyDOS can use them fully, though.
  - `atari/25` (Atari DOS 2.5): The enhanced-density extension of Atari DOS. The file system supports 1040x128-byte sectors only but DOS 2.5 can read and write DOS 2.0 file system on 128-byte sectors just fine. `mkfs` can create this file system on larger disk and use up to 1023 sectors and the real DOS 2.5 can read and write such images without any problem.
  - `atari/mydos` (MyDOS): MyDOS file system is an extension of DOS 2.0 file system that supports up to 65535 128- or 256-byte sectors. It is read-write compatible up to 720 sectors and read-compatible up to 943 sectors with DOS 2.0. Beyond that, none of the earlier DOSes can read or write MyDOS file system. MyDOS also supports subdirectories. `spift` can create subdirectories on all variants but they will only be accessible by MyDOS.
- SpartaDOS family. All variants support up to 65535 128- or 256-byte sectors. Revision 2.1 also supports 512-byte sectors.
  - `sparta/11` (SpartaDOS 1.1). `spift` can read and write this file system but `mkfs` cannot create it currently.
  - `sparta/20` (SpartaDOS 2.x, 3.x, SpartaDOS X 4.1x and 4.2x).
  - `sparta/21` (SpartaDOS X 4.4x and later): Adds support for 512-byte sectors, "hidden" and "archived" file attributes, and symbolic links. `spift` will create such files on any SpartaDOS file system but they will only be meaningful on SpartaDOS X 4.4x and later.

## License and credits

MIT license.

- [Fatih Aygün](https://github.com/cyco130) and [contributors](https://github.com/cyco130/sfotty-pie/graphs/contributors).
