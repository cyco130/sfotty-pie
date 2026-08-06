# Spift

**Spift** (**S**fotty **P**ie **I**mage **F**ile **T**ool) is a Swiss army knife for retro disk images and file formats: inspect, identify, list, and extract, with create, convert, and repair to follow. The core is system-neutral with per-system family modules; Atari 8-bit (ATR, XEX, and friends) comes first. It is both a library (powering the a8-web disk browser) and a `spift` command-line tool. Work in progress.

## Usage

```sh
spift create blank.atr           # blank 720 x 128-byte sector image (--sd)
spift create big.atr --dd        # 720 x 256; --ed is 1040 x 128
spift create hd.atr --sector-size 512 --sector-count 65535
spift mkfs blank.atr             # put an empty filesystem on it
spift ls dos25.atr               # list the root directory
spift ls dos25.atr '*.com' -l    # filtered, with sizes and attributes
spift ls dos25.atr -lv           # ... including deleted and half-written files
spift extract dos25.atr -o out/  # extract everything into out/
spift extract dos25.atr '*.com'  # extract matching files here
spift add dos25.atr game.xex     # add host files to the image
spift rm dos25.atr '*.tmp'       # remove matching files
spift mkdir mydos.atr -p 'games>arcade'          # MyDOS subdirectories
spift mv dos25.atr '*.lst' '*.txt'              # batch rename by template
spift mv mydos.atr '*.com' 'games/'             # move a batch into a directory
spift ls mydos.atr -lR                          # walk the whole tree
spift write-boot-sectors blank.atr boot.bin
spift extract-boot-sectors dos25.atr boot.bin
spift install-dos blank.atr --from dos20s.atr   # make it bootable
```

`create` writes a blank image - a valid header over all-zero sector data, no filesystem installed. The image type is inferred from the file name, or given with `--type`/`-t`; only `atr` exists so far. Existing files are not overwritten unless `--force`/`-f` is given.

`mkfs` writes an empty filesystem: `dos10`, `dos20s`, `dos20d`, `dos25`, or `mydos`, chosen with `--fs atari/VARIANT` (or `--variant`). Without one, a standard single-density image gets `dos20s`, enhanced density is refused as ambiguous (DOS 2.5 and MyDOS both fit), and anything else gets `mydos`. `--boot-sectors FILE` fills the boot area, which must be exactly the variant's size - one sector for DOS 1.0, three otherwise; use `write-boot-sectors` for anything else. The structures match disks formatted by the real DOSes byte for byte, quirks included: only MyDOS reclaims sector 720, DOS 1.0 reserves a single boot sector, DOS 2.5 splits its accounting across both VTOCs, and MyDOS spills its bitmap into extra sectors below the VTOC on disks over 943 sectors.

`ls` lists a directory of the filesystem on an image (Atari DOS 1.0/2.0s/2.0d/2.5 and MyDOS so far; SpartaDOS is detected but not yet readable). A spec is a path whose last part may be a native wildcard pattern (`*` and `?`, name and extension matched separately) - quote it to keep the shell out of it; naming a directory lists its contents, and `--recursive`/`-R` walks the tree showing full paths.

`--long`/`-l` leads with two status lines - the physical image (format, sector count, sector size) and the filesystem (id, capacity, free space, volume label where the family has one) - then adds sector counts, start sectors, and attributes per file. On DOS 2.5 the free figure is the honest total across both VTOCs, with a note giving the smaller number its own DIR reports. `--verbose`/`-v` additionally lists what a directory listing passes over, marked `deleted` or `open-output`; like the DOSes, the scan still stops at the first never-used slot, so entries beyond it stay invisible.

On a terminal, names are colored: directories blue, deleted entries red, open-for-output ones magenta. Names themselves are never decorated - `-l` is where the same facts appear as words, `dir` included, for anything reading the output rather than looking at it.

`extract` copies matching files (default: all) out of an image into `-o DIR` (default: here); `--recursive`/`-R` descends into subdirectories and mirrors the tree below whatever directory the spec picked. Host names are lowercased and made filesystem-safe, per path component; nothing is overwritten without `--force`/`-f`, checked before any file is written. Damaged files still extract whatever is recoverable, with warnings and exit code 1.

`mkdir` and `rmdir` manage MyDOS subdirectories, with `-p` for parents. A directory is a contiguous eight-sector extent holding 64 entries, so `mkdir` can fail for want of a _run_ of free sectors on a disk with plenty of room - the same refusal MyDOS gives. `rmdir` takes only empty directories; `rm -r` clears a tree, deepest first. Paths accept `/`, `>` and `:` as separators, plus SpartaDOS's `<`, which separates and steps up a level at once (`games>arcade<other` means `games/other`); quote them, since shells read `<` and `>` as redirection.

`mv` renames and moves. The destination is a directory when it ends in a separator or names one, and otherwise a name template applied per match, following the DOSes' own RENAME rules exactly (measured against DOS 2.0S): `*` copies the source from that position to the end of the field, `?` copies one character, anything else replaces, and a template shorter than the field blanks the rest - so `'*.lst' '*.txt'` re-extensions a batch, `ab.txt` with `q*.bak` gives `qb.bak`, and `abcdefgh.txt` with `??z.bak` gives `abz.bak`. Renaming inside a directory touches only the directory entry; moving between directories has to rewrite the file number every data sector carries, unless the entry is a directory or a MyDOS full-link file, which store none. File contents never move either way.

`rm` removes files matching its specs. Locked files need `--force`/`-f` (which also quiets specs that match nothing), and directories need `--recursive`/`-r`. Deleted entries keep their name under the deleted flag, the way the DOSes leave them for undelete tools.

`write-boot-sectors` lays a boot file over an image's first sectors - a container-level operation that works on blank images too, so `create` + `write-boot-sectors` builds a boot disk from scratch. The file must span a whole number of sectors (the three 128-byte boot sectors of 256-bps images are accounted for; `--pad` zero-fills the tail) and its second byte - the boot record's sector count - must match, unless `--force`/`-f`.

`install-dos` makes a disk bootable the way a DOS's own "write DOS files" does: it copies a master's boot sectors, the file that master's boot record loads, and `DUP.SYS` beside it, then points the new disk's boot record at the copy. It refuses masters whose boot area or density disagrees with the target's filesystem, since the installed DOS would then read the disk wrongly. `set-dos-file` is the low-level half - it points the boot record at a file already on the image (default `dos.sys`), or unsets it with `--clear`. Neither needs the file contiguous or in any particular place; the boot code follows the sector chain. In `ls -l` the file the boot record points at is marked `dos-file`, which is derived from the boot record rather than any directory flag. The pointer is maintained from then on: rewriting that file follows it to wherever it lands, and deleting it marks the disk non-bootable rather than leaving the boot record aimed at freed sectors.

`extract-boot-sectors` is the counterpart: it pulls the boot sectors into a file, sized by the boot record's own count byte. When that byte claims zero or more sectors than the image holds, pass `--sector-count` explicitly. Existing output files are not overwritten without `--force`/`-f`.

`add` copies host files into an image. Names convert to uppercase 8.3 - letters, digits, `_` and `@`, everything else becomes `_`. Overwriting a file already on the image needs `--force`/`-f`; two sources mangling to the same name is always an error. On DOS 2.5, files reaching past sector 719 get the extended marking, and the VTOC2 shared bitmap is silently repaired from the main VTOC (which DOS 2.0 keeps current). The image is only written back after the whole batch succeeds.

Files are written in DOS 2 format whatever the disk was formatted with, and allocation follows the bitmap rather than any DOS's habits - so a sector the format left free (720 on a MyDOS disk) gets used, which real DOS 2.0 never does but reads back fine. `--fs atari/dos10` writes DOS 1.0 format chains instead, which only DOS 1.0 can read; `--fs` takes a family (`atari`), a variant (`dos25`), or both (`atari/dos25`), and the same syntax works on `ls`, `extract`, and `rm` to force how a disk is interpreted. Run `spift help` for details.

## License and credits

MIT license.

- [Fatih Aygün](https://github.com/cyco130) and [contributors](https://github.com/cyco130/sfotty-pie/graphs/contributors).
