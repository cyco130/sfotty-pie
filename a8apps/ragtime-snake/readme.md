# Ragtime Snake

A game for the Atari 8-bit, assembled with [@sfotty-pie/spasm](../../packages/spasm). Work in progress - currently a proof-of-life scaffold that cycles the border color once per frame.

`pnpm build` assembles `src/main.s` into `dist/ragtime-snake.xex`, loadable by any Atari DOS or the [@sfotty-pie/a8](../../packages/a8) XEX boot loader (drop it on [a8-web](../../apps/a8-web) to try it).

The XEX output format lives in [src/xex.s](src/xex.s) as an `output_xex start, load` format macro, following the format-as-macro convention.
