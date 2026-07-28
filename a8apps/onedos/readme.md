# OneDOS

An Atari 8-bit DOS, assembled with [@sfotty-pie/spasm](../../packages/spasm). Work in progress.

`pnpm build` produces:

| artifact          | what it is                                                   |
| ----------------- | ------------------------------------------------------------ |
| `dist/nodos.atr`  | a bootable single-density disk with no DOS on it             |
| `dist/onedos.xex` | the DOS itself - a binary-load file at `$0700`, still a stub |

## The No DOS disk

A freshly formatted 720-sector single-density disk whose boot sectors print `No DOS!` and return a boot error. It is a real, mountable Atari DOS 2.0 disk - a DOS that reads it sees an empty, fully usable volume.

| sectors   | contents                                                         |
| --------- | ---------------------------------------------------------------- |
| 1-3       | [src/loaders/atari-dos-no-dos.s](src/loaders/atari-dos-no-dos.s) |
| 360       | VTOC                                                             |
| 361-368   | root directory (empty - all zeroes)                              |
| all other | zero                                                             |

Two things are worth knowing about it:

- **708 free sectors, not 707.** DOS 2.0S leaves sector 720 out of its bitmap - a quirk of that formatter, not a geometry limit - and so reports 707. This disk marks it free the way MyDOS does. Every DOS in the family reads the result; DOS 2.0S just never allocates the extra sector itself.
- **`sector_link_offset` is patched by the build, not assembled in.** It describes the _disk_ the loader ships on (125 for 128-byte sectors, 253 for 256-byte ones), and the loader reads it back to learn the sector size. [build.ts](build.ts) finds the field through the assembler's symbol table rather than a hardcoded offset, so the two can't drift apart.

The layout rules live in [disk.ts](disk.ts), next to the format notes they implement.

## Scaffold caveats

- **`src/dos.s` does nothing** - it's a bare `rts`.
- **[src/xex.s](src/xex.s) is copied** from [ragtime-snake](../ragtime-snake/src/xex.s). Two copies now, so it wants lifting into a shared package. Its `$80` zero-page choice is written for a program that owns the machine and is likely wrong for a DOS.
