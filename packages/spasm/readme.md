# Spasm

A work-in-progress 6502 cross-assembler/linker. It's used to assemble 6502 code needed in this monorepo but it's not yet ready for public use - the API and syntax are still changing, and diagnostics are rough.

What exists today: an `assemble()` API (single source string, or a multi-module project through a `Host`), a `spasm INPUT -o OUTPUT` CLI, and enough of the language (segments, modules with `.import`/`.export`, macros, multipass zero-page/branch sizing) to build real programs.

> Contributors: see [design.md](./design.md) for how it works internally.

## License and credits

MIT license.

- [Fatih Aygün](https://github.com/cyco130) and [contributors](https://github.com/cyco130/sfotty-pie/graphs/contributors).
