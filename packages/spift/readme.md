# Spift

**Spift** (**S**fotty **P**ie **I**mage **F**ile **T**ool) is a Swiss army knife for retro disk images and file formats: inspect, identify, list, and extract, with create, convert, and repair to follow. The core is system-neutral with per-system family modules; Atari 8-bit (ATR, XEX, and friends) comes first. It is both a library (powering the a8-web disk browser) and a `spift` command-line tool. Work in progress.

## Usage

Every command names the image it works on with `--image`/`-i`; positional arguments are paths inside that image.

```sh
spift ls -i game.dcm                  # read a DiskComm image directly
spift convert -i game.dcm game.atr    # or rewrite it as an ATR
spift create -i blank.atr             # blank 720 x 128-byte sector image (--sd)
spift create -i big.atr --dd          # 720 x 256; --ed is 1040 x 128
spift create -i hd.atr --sector-size 512 --sector-count 65535
spift mkfs -i blank.atr               # put an empty filesystem on it
spift ls -i dos25.atr                 # list the root directory
spift ls -i dos25.atr '*.com' -l      # filtered, with sizes and attributes
spift ls -i dos25.atr -lv             # ... plus deleted and half-written files
spift cat -i dos25.atr 'readme.txt'   # read a file as text
spift hexdump -i dos25.atr -s 361     # or look at raw sectors
spift cp --from dos25.atr '*.*' out/  # copy everything off, into out/
spift cp --to dos25.atr game.xex /    # ... and host files onto an image
spift rm -i dos25.atr '*.tmp'         # remove matching files
spift chattr -i dos25.atr read-only=on '*.com'   # lock a batch
spift recode -f atascii notes.txt                # ATASCII text as Unicode
spift recode -t atascii notes.md > notes.atascii # and the other way
spift mkdir -i mydos.atr -p 'games>arcade'    # MyDOS subdirectories
spift mv -i dos25.atr '*.lst' '*.txt'         # batch rename by template
spift mv -i mydos.atr '*.com' 'games/'        # move a batch into a directory
spift ls -i mydos.atr -lR                     # walk the whole tree
spift cp --from a.atr --to b.atr '*.*' /      # copy between two images
spift cp --from disk.atr -R 'games' out/      # whole subtrees, either way
spift write-boot-sectors -i blank.atr boot.bin
spift extract-boot-sectors -i dos25.atr boot.bin
spift install-dos -i blank.atr --from dos20s.atr   # make it bootable
spift unpack -i dos25.atr tree/ --extract-boot-sectors   # disk -> directory
spift pack -i rebuilt.atr tree/ --write-boot-sectors      # and back again
```

spift reads two container formats and writes one. **ATR** is the plain one - a 16-byte header over the sectors - and **DCM**, Bob Puff's Disk Communicator format (also seen as `.dc3`), holds exactly the same sectors compressed, so a DCM opens for reading anywhere an ATR does and `convert` rewrites it losslessly. Writing to a DCM is refused with a pointer at `convert`, since an encoder would be work nobody needs to read a collection. Content decides which format a file is, not its name; `convert --type`/`-t` forces the output.

Two points where the published descriptions of DCM disagree were settled by decoding a 203-file corpus both ways. A double-density image carries **full 256-byte sectors even for the boot sectors**, though an ATR stores 128 of them - reading those as 128 puts the stream out of step, and every DD file failed that way before it was fixed. And a change-begin block **keeps the previous sector's tail** rather than painting the sector with a fill byte first: the two differ in exactly one file of the 203, and there the fill reading resurrects stale directory entries whose own recorded file numbers show they belong to slots they no longer occupy. Keeping the tail is also the only reading that squares with how the reference encoder chooses to emit the block.

`create` writes a blank image - a valid header over all-zero sector data, no filesystem installed. The image type is inferred from the file name, or given with `--type`/`-t`; only `atr` exists so far. Existing files are not overwritten unless `--force`/`-f` is given.

`mkfs` writes an empty filesystem: `dos10`, `dos20s`, `dos20d`, `dos25`, or `mydos`, chosen with `--fs atari/VARIANT` (or `--variant`). Without one, a standard single-density image gets `dos20s`, enhanced density is refused as ambiguous (DOS 2.5 and MyDOS both fit), and anything else gets `mydos`. `--boot-sectors FILE` fills the boot area, which must be exactly the variant's size - one sector for DOS 1.0, three otherwise; use `write-boot-sectors` for anything else. The structures match disks formatted by the real DOSes byte for byte, quirks included: only MyDOS reclaims sector 720, DOS 1.0 reserves a single boot sector, DOS 2.5 splits its accounting across both VTOCs, and MyDOS spills its bitmap into extra sectors below the VTOC on disks over 943 sectors.

`ls` lists a directory of the filesystem on an image (Atari DOS 1.0/2.0s/2.0d/2.5 and MyDOS so far; SpartaDOS is detected but not yet readable). A spec is a path whose last part may be a native wildcard pattern (`*` and `?`, name and extension matched separately) - quote it to keep the shell out of it; naming a directory lists its contents, and `--recursive`/`-R` walks the tree showing full paths.

`--long`/`-l` leads with two status lines - the physical image (format, sector count, sector size) and the filesystem (id, capacity, free space, volume label where the family has one) - then adds sector counts, start sectors, and attributes per file. On DOS 2.5 the free figure is the honest total across both VTOCs, with a note giving the smaller number its own DIR reports. `--verbose`/`-v` additionally lists what a directory listing passes over, marked `deleted` or `open-output`; like the DOSes, the scan still stops at the first never-used slot, so entries beyond it stay invisible.

On a terminal, names are colored: directories blue, deleted entries red, open-for-output ones magenta. Names themselves are never decorated - `-l` is where the same facts appear as words, `dir` included, for anything reading the output rather than looking at it.

`cat` writes files to stdout as text, reading them in the family character set - the same conversion `recode` does. It is always text, with no raw mode, because that is what an image holds: an Atari disk carries ATASCII, and a Unicode file on one would be the strange case. It is the safe default too, since recoding turns control codes into glyphs and so a file cannot paint your terminal with escape sequences. The host already has `cat(1)`, so this one only reads images.

`hexdump` is the other half: offset, hex, and the glyphs an Atari would show for those bytes, with inverse video in reverse video where the terminal allows. That last column is why it exists rather than piping to `xxd`, which renders EOL and every graphics character as a dot - a directory sector dumped this way reads as `A       TXT` where `xxd` shows nothing. `--sectors`/`-s` takes a sector or a range and reaches the parts no file occupies: the boot record, the VTOC, the directory.

There is deliberately no "is this a text file" test anywhere in spift. Decoding is total - every one of the 256 codes has a glyph - so a binary reads as displayable garbage rather than an error, and nothing tells it apart from text. Which of the two commands to reach for is yours to judge; the file will not tell you.

`mkdir` and `rmdir` manage MyDOS subdirectories, with `-p` for parents. A directory is a contiguous eight-sector extent holding 64 entries, so `mkdir` can fail for want of a _run_ of free sectors on a disk with plenty of room - the same refusal MyDOS gives. `rmdir` takes only empty directories; `rm -r` clears a tree, deepest first. Paths accept `/`, `>` and `:` as separators, plus SpartaDOS's `<`, which separates and steps up a level at once (`games>arcade<other` means `games/other`); quote them, since shells read `<` and `>` as redirection.

`cp` and `mv` work on two sides at once. `--from` and `--to` name them, `--image`/`-i` says both sides are the same image, and a side with no flag is the host - so `--from` alone copies out of an image, `--to` alone copies into one, and both together copy image to image. At least one side has to be an image, since host-to-host copying is what `cp(1)` is for.

The two ways a host side gets named mean different things. A directory named outright (`--to out/`) is a container: paths are relative to it and confined to it, so a rename template can never write outside the directory you pointed at. The side that falls back to the host when no flag names one is not a container - paths there mean what they mean in the shell, relative to the working directory and absolute when they say so, which is how `spift cp --to disk.atr ~/games/blast.xex /` reaches a file that lives nowhere near you. `--fs` forces how a container is read, with `--from-fs` and `--to-fs` to override one side; `--recursive`/`-R` is needed to copy a directory (a `mv` implies it). Positional arguments are `SOURCE... DESTINATION`, following the same rule as Unix `cp`: the last one is a destination directory when it names or ends in one, and otherwise there may be only two, the second being a name template.

The template is the target's own rename rule, so `spift cp --from img.atr '*.ttt' '*.txt'` re-extensions a batch on the way out just as it does on the way in. The host rule is the DOSes' rule with the two things that only mean something for fixed-width fields taken out: the split is at the _last_ dot, so `archive.tar.gz` has the extension `gz` and `.gitignore` is all stem, and there is no padding to copy from, so a `?` reaching past the end of the source adds nothing where an 8.3 field would have handed back a space.

Attributes travel as far as both sides can carry them. What a target cannot represent is dropped rather than faked, so copying a locked DOS 1.0 file to another Atari image keeps both properties, copying it to a host directory keeps only the read-only bit, and `--no-attributes` drops even what would have travelled - which is how a DOS 1.0 file becomes an ordinary one, since writing it without the marking writes DOS 2 chains. The DOS 2.5 and MyDOS markings never travel: they say where a file landed on a particular disk rather than anything anyone asked for. Neither does the boot-file pointer, which belongs to the image (a `mv` within one image keeps it, because that move never rewrites the file at all).

`mv` renames and moves. The destination is a directory when it ends in a separator or names one, and otherwise a name template applied per match, following the DOSes' own RENAME rules exactly (measured against DOS 2.0S): `*` copies the source from that position to the end of the field, `?` copies one character, anything else replaces, and a template shorter than the field blanks the rest - so `'*.lst' '*.txt'` re-extensions a batch, `ab.txt` with `q*.bak` gives `qb.bak`, and `abcdefgh.txt` with `??z.bak` gives `abz.bak`. Renaming inside a directory touches only the directory entry; moving between directories has to rewrite the file number every data sector carries, unless the entry is a directory or a MyDOS full-link file, which store none. File contents never move either way - a move within one image is bookkeeping, so it also keeps the sectors a file occupies and the boot record pointing at it. Crossing containers is the other thing entirely: there the file is copied and then removed, target written first, so an interruption leaves a duplicate rather than a hole.

Moving _off_ the host needs `--remove-source`, because the two directions are not equally reversible. Removing from an image leaves the entry with its name under the deleted flag, the way the DOSes leave it, so it is still there to recover; removing from the host is a real unlink. Everywhere else spift treats the host as where its inputs and outputs live rather than as something it deletes, so the irreversible half is opt-in.

`rm` removes files matching its specs. Locked files need `--force`/`-f` (which also quiets specs that match nothing), and directories need `--recursive`/`-r`. Deleted entries keep their name under the deleted flag, the way the DOSes leave them for undelete tools.

`write-boot-sectors` lays a boot file over an image's first sectors - a container-level operation that works on blank images too, so `create` + `write-boot-sectors` builds a boot disk from scratch. The file must span a whole number of sectors (the three 128-byte boot sectors of 256-bps images are accounted for; `--pad` zero-fills the tail) and its second byte - the boot record's sector count - must match, unless `--force`/`-f`.

`install-dos` makes a disk bootable the way a DOS's own "write DOS files" does: it copies a master's boot sectors, the file that master's boot record loads, and `DUP.SYS` beside it, then points the new disk's boot record at the copy. It refuses masters whose boot area or density disagrees with the target's filesystem, since the installed DOS would then read the disk wrongly. `set-dos-file` is the low-level half - it points the boot record at a file already on the image (default `dos.sys`), or unsets it with `--clear`. Neither needs the file contiguous or in any particular place; the boot code follows the sector chain. In `ls -l` the file the boot record points at is marked `dos-file`, which is derived from the boot record rather than any directory flag. The pointer is maintained from then on: rewriting that file follows it to wherever it lands, and deleting it marks the disk non-bootable rather than leaving the boot record aimed at freed sectors.

`recode` converts text between a family's own character set and Unicode, writing to stdout (or reading stdin with no file). The codes are `atascii`, `unicode` and `escaped-unicode`, and whichever of `--from`/`-f` and `--to`/`-t` you leave out is `unicode`, so a single flag usually says it. `--in-place` converts the files named instead, for a batch.

Inverse video is bracketed by `~`, a line ending is EOL (`$9B`), and `{ddd}` or `{$hh}` is a byte outright - `{!ddd}` too, so text written for the emulator's paste convention is accepted as-is. That makes both Unicode flavours round-trip every one of the 256 codes exactly; `escaped-unicode` differs only in writing the Atari graphics as escapes rather than glyphs, for terminals and fonts that cannot show them.

Going the other way, anything with no ATASCII character - a backtick, a brace that is not an escape, an accented letter, an emoji - becomes `?` with a warning and exit code 1, so a batch is never stopped by one stray character. `--strict` refuses instead, and also catches a `~` that opens inverse video and lets the line ending close it, which is exactly what ordinary host text holding a tilde looks like. `--eol` picks what EOL becomes and defaults to `lf` on every platform, so the same disk gives the same bytes everywhere; encoding accepts LF, CR and CRLF alike, so nothing is lost feeding it back.

`--text` on `cp`, `mv`, `pack` and `unpack` is the same conversion applied on the way across, which is FTP's `ascii` transfer mode by another name: `spift unpack -i disk.atr tree/ --text '*.txt'` gives readable text, and `spift pack -i new.atr tree/ --text '*.txt'` puts it back. No encoding needs naming, because each end declares its own and Unicode is the pivot - so a copy between two images passes through untouched, and a host directory at either end is the side that gets Unicode. Recoding a binary ruins it, so something has to say which files are text. On `cp` and `mv` that is the source spec you already gave; `pack` and `unpack` copy everything, so there `--text` takes the pattern itself, and repeats for as many kinds of text file as a disk holds. `--strict` goes along on the commands that encode and `--eol` on the ones that decode.

The Atari's international character set is deliberately not folded in: its 27 accented letters sit on codes `$00`-`$1A` and `$7B`, which the standard character ROM shows as graphics, so writing `é` as `$14` would produce a file that reads as a graphics glyph on any machine not running that ROM. It belongs in its own encoding, alongside screen codes, when those land.

`chattr` changes what an entry carries. A setting is `name=on` or `name=off`, and the leading positionals holding an `=` are the settings while the rest are specs - the way `env FOO=1 cmd` splits them, and unambiguous because no native name can contain an `=`. Names are the ones `ls -l` prints, so a listing reads back as something `chattr` accepts: `read-only` (spelled `locked` or `protected` if you prefer) and `dos1`.

The other names `ls -l` prints are deliberately not settable, and each says why rather than coming back as "unknown": `dos2.5` and `mydos` record where a file's sectors landed, `dos-file` lives in the boot record (`set-dos-file` points it at a file), `deleted` is what `rm` leaves behind, and `open-output` marks a half-written file, which is damage to repair rather than a flag to clear.

The two settable ones cost very different things. `read-only` is one bit in the directory entry. `dos1` is the data sector encoding, so changing it reads the file and writes it back, which reallocates the chain - `--force`/`-f` is required to do that to a read-only file, and a directory has no data sectors to re-encode either way. Verified in the emulator: a file written as DOS 2 and converted with `chattr -i disk.atr dos1=on` is read back by real Atari DOS 1.0.

`unpack` explodes an image into a host directory (made if missing, defaulting to the current one) and `pack` builds one back from a directory - `pack` creates the image, formats it, and copies the tree in, so it takes `create`'s geometry options and `mkfs`'s `--fs`. Dot-prefixed host files are passed over on the way in, the way a shell glob passes over them, which is what keeps `.DS_Store` and the like off the disk.

The boot record is not a file on the disk, so it travels beside the files as `.boot.bin`: `unpack --extract-boot-sectors` writes it, `pack --write-boot-sectors` reads it back, and being dot-prefixed it is never mistaken for content. `pack --set-dos-file NAME` then points the rebuilt boot record at a file that was packed, which requires `--write-boot-sectors` - with no boot code on the image there would be nothing to follow the pointer. A disk with no boot record to begin with says so and unpacks its files anyway. A MyDOS disk taken apart and rebuilt this way boots MyDOS 4.53 and lists its own files, subdirectories included.

`extract-boot-sectors` is the counterpart: it pulls the boot sectors into a file, sized by the boot record's own count byte. When that byte claims zero or more sectors than the image holds, pass `--sector-count` explicitly. Existing output files are not overwritten without `--force`/`-f`.

Copying host files onto an image is `cp --to`, and taking them off is `cp --from`. A name that does not fit 8.3 in `[A-Z0-9_@]` is refused, with the reason, rather than mangled to fit: truncating to eight characters throws away the part that tells related files apart and then collides with its neighbours, so naming the file is your call - give an explicit name, or a template for a batch. Coming the other way, a decoded name is made safe for the host - which is a guard against a damaged directory decoding to whatever bytes were in it, not a way of fitting names to a shape. Characters outside a portable set become `_`, and so do trailing dots, which Windows strips silently; a name Windows reserves for a device gets a `_` prefix, since `CON` and `AUX` are legal Atari names and `CON.TXT` opens the console whatever its extension. The rules are the portable intersection applied everywhere rather than the host's own, so the same disk gives the same names on every system - which is what keeps a `pack`/`unpack` round trip reproducible across them.

Files land in DOS 2 format whatever the disk was formatted with, and allocation follows the bitmap rather than any DOS's habits - so a sector the format left free (720 on a MyDOS disk) gets used, which real DOS 2.0 never does but reads back fine. `--to-fs atari/dos10` writes DOS 1.0 format chains instead, which only DOS 1.0 can read. On DOS 2.5, files reaching past sector 719 get the extended marking, and the VTOC2 shared bitmap is silently repaired from the main VTOC (which DOS 2.0 keeps current). Damaged files still copy whatever is recoverable, with warnings and exit code 1. Run `spift help` for details.

## License and credits

MIT license.

- [Fatih Aygün](https://github.com/cyco130) and [contributors](https://github.com/cyco130/sfotty-pie/graphs/contributors).
