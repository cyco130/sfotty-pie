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
spift extract dos25.atr -o out/  # extract everything into out/
spift extract dos25.atr '*.com'  # extract matching files here
spift add dos25.atr game.xex     # add host files to the image
spift rm dos25.atr '*.tmp'       # remove matching files
spift write-boot-sectors blank.atr boot.bin
spift extract-boot-sectors dos25.atr boot.bin
```

`create` writes a blank image - a valid header over all-zero sector data, no filesystem installed. The image type is inferred from the file name, or given with `--type`/`-t`; only `atr` exists so far. Existing files are not overwritten unless `--force`/`-f` is given.

`mkfs` writes an empty filesystem: `dos10`, `dos20s`, `dos20d`, `dos25`, or `mydos`, chosen with `--fs atari/VARIANT` (or `--variant`). Without one, a standard single-density image gets `dos20s`, enhanced density is refused as ambiguous (DOS 2.5 and MyDOS both fit), and anything else gets `mydos`. `--boot-sectors FILE` fills the boot area, which must be exactly the variant's size - one sector for DOS 1.0, three otherwise; use `write-boot-sectors` for anything else. The structures match disks formatted by the real DOSes byte for byte, quirks included: only MyDOS reclaims sector 720, DOS 1.0 reserves a single boot sector, DOS 2.5 splits its accounting across both VTOCs, and MyDOS spills its bitmap into extra sectors below the VTOC on disks over 943 sectors.

`ls` lists the root directory of the filesystem on an image (Atari DOS 1.0/2.0s/2.0d/2.5 and MyDOS so far; SpartaDOS is detected but not yet readable). Specs use the native wildcard rules (`*` and `?`, name and extension matched separately) - quote them to keep the shell out of it.

`extract` copies matching files (default: all) out of an image into `-o DIR` (default: here). Host names are lowercased and made filesystem-safe; nothing is overwritten without `--force`/`-f`, checked before any file is written. Damaged files still extract whatever is recoverable, with warnings and exit code 1.

`rm` removes files matching its specs. Locked files need `--force`/`-f` (which also quiets specs that match nothing); directories cannot be removed yet. Deleted entries keep their name under the deleted flag, the way the DOSes leave them for undelete tools.

`write-boot-sectors` lays a boot file over an image's first sectors - a container-level operation that works on blank images too, so `create` + `write-boot-sectors` builds a boot disk from scratch. The file must span a whole number of sectors (the three 128-byte boot sectors of 256-bps images are accounted for; `--pad` zero-fills the tail) and its second byte - the boot record's sector count - must match, unless `--force`/`-f`.

`extract-boot-sectors` is the counterpart: it pulls the boot sectors into a file, sized by the boot record's own count byte. When that byte claims zero or more sectors than the image holds, pass `--sector-count` explicitly. Existing output files are not overwritten without `--force`/`-f`.

`add` copies host files into an image. Names convert to uppercase 8.3 - letters, digits, `_` and `@`, everything else becomes `_`. Overwriting a file already on the image needs `--force`/`-f`; two sources mangling to the same name is always an error. On DOS 2.5, files reaching past sector 719 get the extended marking, and the VTOC2 shared bitmap is silently repaired from the main VTOC (which DOS 2.0 keeps current). The image is only written back after the whole batch succeeds.

Files are written in DOS 2 format whatever the disk was formatted with, and allocation follows the bitmap rather than any DOS's habits - so a sector the format left free (720 on a MyDOS disk) gets used, which real DOS 2.0 never does but reads back fine. `--fs atari/dos10` writes DOS 1.0 format chains instead, which only DOS 1.0 can read; `--fs` takes a family (`atari`), a variant (`dos25`), or both (`atari/dos25`), and the same syntax works on `ls`, `extract`, and `rm` to force how a disk is interpreted. Run `spift help` for details.

## License and credits

MIT license.

- [Fatih Aygün](https://github.com/cyco130) and [contributors](https://github.com/cyco130/sfotty-pie/graphs/contributors).
