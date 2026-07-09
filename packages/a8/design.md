# How `@sfotty-pie/a8` works

Notes on the internals of the Atari 8-bit machine emulator, for contributors (and AI agents). The readme is for _users_ of the library; this file is for people working _on_ it. Per-function details live in doc comments next to the code.

## What it is

A8 assembles the [@sfotty-pie/sfotty](../sfotty) 6502 core, ANTIC+GTIA, POKEY, and the PIA into a complete, headless Atari 8-bit machine. "Headless" means the package renders into a byte-array framebuffer, returns an audio level per cycle, and takes input through methods - every real-world interface (canvas, audio device, keyboard) is the host's job. The browser host lives in `apps/a8-web`; a Node host for tests and the CLI lives in this package (not exported - see [The headless HLE host](#the-headless-hle-host)).

Accuracy is tracked against the Altirra **Acid800** conformance suite (see [Conformance](#conformance-acid800)), in both NTSC and PAL.

## The cycle model and the suspend primitive

The host drives the machine one cycle at a time, mirroring how the CPU core is driven. `cycle()` (in [src/machine.ts](src/machine.ts)) runs the committed pre-work - ANTIC scheduling (`beforeCpu`) and the POKEY tick - then the bus phase (ANTIC DMA or the CPU) and the scanline render, and returns the POKEY audio level.

A bus phase may **throw** - an interceptor suspending on a read/write/fetch, or a host breakpoint. The machine defines no sentinel and catches nothing; the throw is whatever the interceptor threw, the same host-defined-sentinel model as sfotty's traps. The host catches it around `cycle()`, resolves it (await input, service a debugger, ...), and calls `resumeCycle()` to finish the _same_ cycle.

Resumability is implemented as a three-phase machine:

```ts
const PHASE = { IDLE: 0, BUS: 1, CPU: 2 } as const;
```

`cycle()` runs the pre-work once, sets `#phase = BUS`, and enters `#runCycle()` - a fall-through switch that re-enters at the saved phase. The marker is advanced _before_ each throwable call, so a throw leaves it pointing at the phase to resume. The invariants that make this correct: `beforeCpu` and `pokey.cycle()` run exactly once per cycle (never on resume - the audio level is cached in `#audio`), and each bus phase performs its access before committing anything, so the retried access repeats nothing. `cycle()` guards against misuse (`cycle() called mid-cycle - use resumeCycle()`).

Between the phases, the machine copies ANTIC's NMI/RDY/HALT outputs onto the CPU: `RDY` models the WSYNC scanline stall (CPU still on the bus, re-reading), while `HALT` skips the CPU's `run()` entirely for an ANTIC DMA steal (CPU off the bus). These are separate mechanisms - don't conflate them.

## The bus and core-owned trapping

[src/mmu.ts](src/mmu.ts) owns the memory map: RAM/ROM regions, the chip registers, cartridge mapping, XL/XE PORTB banking (including 130XE extended banks with optional separate CPU/ANTIC access), and PBI ([src/pbi.ts](src/pbi.ts)). Dispatch is a 256-page table (parallel arrays), one set of columns per bus master - CPU and ANTIC DMA can see different extended banks. Each page has fast read bytes, fast write bytes, and a slow-path `Memory` target: a non-null fast entry is a 256-byte view of the backing store and the access is a plain byte load/store (no virtual call, no bounds check, no trap check); ROM pages are just pages with no fast write entry. Chip-register pages and pages with registered traps have null fast entries and take the slow path, which runs the trap registries and the target's `read`/`write` - so registering a trap "de-fastens" its page and removing the last one re-fastens it. The tables are rebuilt (allocation-free; page views are cached per backing store) on every mapping event: a PORTB change, cartridge insertion/removal, any cartridge bank switch (the cart's `onMappingChanged` callback), reset, and trap-count edges. Unmapped regions (a 16K machine's `4000-7FFF`, a 10K OS's missing self-test window, absent cartridge areas) read a shared $FF page.

It also owns the **trap dispatch** - the machine-level generalization of sfotty's throw-a-sentinel idea. `Atari` exposes `interceptRead`/`interceptWrite`/`interceptExecute` (replace the access: return a substitute value/opcode, or `undefined` to pass through) and the `observe*` variants (watch without replacing), each returning a `TrapHandle` with `remove()`. Read/write traps take a `TrapMask` (`sync`/`dummy`/`dma`) to filter which access kinds fire; an execute trap is sugar for a read trap masked to `{ sync: true, dummy: false }` - i.e. committed opcode fetches only. This is what "core-owned trapping" means: hosts don't wrap the bus, they register traps with it.

Built-in machine features use the same public trap machinery: the SIO handler is an execute trap on `SIOV` ($E459), and the headless host's console HLE traps CIOV and friends.

## Chips

- **[src/antic-gtia.ts](src/antic-gtia.ts)** - ANTIC and GTIA fused into one `AnticGtia` class, because they share cycle timing; GTIA effectively runs a fixed color-clock skew behind ANTIC (see the delay-line comments in the source). It owns display-list DMA, player/missile graphics (latched across the full visible region), the NMI/RDY/HALT lines, console-key and trigger inputs, the per-cycle scanline render (`beforeCpu`/`busCycle`/`afterCpu`), and a display-list disassembler gated on the `log` config option.
- **[src/pokey.ts](src/pokey.ts)** - the four audio channels (an output level per cycle), keyboard scan, serial-port IRQs, SKSTAT.
- **[src/pia.ts](src/pia.ts)** - the 6520: PORTA (joysticks), PORTB (joysticks on the 400/800; memory banking on XL/XE), IRQ lines.
- The CPU is not in this package - it's the `Sfotty` core, driven through the bus.

Framebuffer: `frame` is one Atari color byte per pixel, `FRAME_BUFFER_WIDTH x FRAME_BUFFER_HEIGHT` (376x240 - the full overscan region). Palette decode is the host's job; [src/palette.ts](src/palette.ts) provides NTSC (YIQ) and PAL (YUV) palette builders returning 256-entry `Uint32Array`s of little-endian RGBA words, designed to be written straight through a `Uint32Array` view of canvas `ImageData`. NTSC/PAL timing (line counts, rates) lives in [src/timing-constants.ts](src/timing-constants.ts), re-exported wholesale from the index.

## Disk I/O: SIO high-level emulation

No serial hardware is emulated. `createSioHandler` ([src/sio.ts](src/sio.ts)) is a synchronous execute trap on the OS's SIOV vector: it reads the device control block from RAM, performs the request against the mounted `AtrImage` ([src/atr.ts](src/atr.ts)) in-process, writes the result back, and returns an RTS opcode to resume the caller. No throw, no await - a host that only serves disks never sees a suspend. `Atari.insertDisk`/`ejectDisk` manage the single D1: image; ejecting mid-run is safe (SIO then times out, like real hardware with no drive).

`AtrImage` wraps a whole `.atr` file (header + data) with sector read/write and `toBytes()` for write-back; 128- and 256-byte sectors are supported.

## XEX booting and the generated loader

`buildBootDisk` ([src/xex-boot.ts](src/xex-boot.ts)) wraps a XEX executable in a minimal bootable ATR: a three-boot-sector loader that reads and launches the executable over SIO. The loader binary is a **committed generated file**, [src/xex-loader-bytes.ts](src/xex-loader-bytes.ts), produced by [src/build-loader.ts](src/build-loader.ts) (`pnpm build:loader`, the first step of the package `build`): it assembles [atari-src/xex-loader.s](atari-src/xex-loader.s) with `@sfotty-pie/spasm`, enforces the 384-byte (3 x 128) budget, and pads. spasm must be built first - the workspace dependency orders that. `atari-src/` ships in the published package (it's the "corresponding source" for the baked loader bytes).

## Firmware identification and preferences

[src/detect-firmware.ts](src/detect-firmware.ts) matches ROM images (by size, then CRC-32 or a predicate) against a table of known OS/BASIC firmware, returning a stable `FirmwareKey`. [src/firmware-preferences.ts](src/firmware-preferences.ts) ranks keys best-first for a machine context (`preferredOsKeys({ model, tv })`, `preferredBasicKeys()`), which is how a host auto-picks the best available OS+BASIC for the configured machine. [src/canonicalize.ts](src/canonicalize.ts) normalizes container formats and splits combined dumps (e.g. an XEGS 32K ROM into its constituents); [src/detect-file-format.ts](src/detect-file-format.ts) classifies user files (ATR/XEX/CAR/raw ROM). [src/cartridge.ts](src/cartridge.ts) handles `.car` and raw cartridge images across the `CART_TYPES` mappers.

## The headless HLE host

[src/headless.ts](src/headless.ts) is a Node host used by the package's own tooling - deliberately **not exported** (browser hosts shouldn't pull in Node coupling; the export list in [src/index.ts](src/index.ts) is the browserable surface). `Headless` boots a machine and high-level-emulates the OS console: execute traps on E: PUTBYT/GETBYT, CIOV, and BLKBDV collect screen output as text and feed scripted or interactive input, suspending on empty input via an internal `NEED_INPUT` symbol - the package's one in-tree consumer of the suspend primitive. [src/boot.ts](src/boot.ts) is a small CLI over it (stdin/stdout); [src/screenshot.ts](src/screenshot.ts) renders `frame` to PNG.

## Conformance: Acid800

[src/acid800-tests.ts](src/acid800-tests.ts) (`pnpm --filter @sfotty-pie/a8 conformance`) boots `test/acid800/acid800.atr` on a 130XE inside `Headless`, scripts past the menu, parses the E: output, and diffs the per-test results against `test/acid800/baseline.json` - so CI fails on _regressions_ while known-failing tests are tracked explicitly in the baseline. The script runs twice, NTSC and `--pal` (the package `conformance` script), for the dual-region check. Firmware comes from the repo's `apps/a8-web/library/firmware/` (AltirraOS XL/XE + Altirra BASIC), located relative to `import.meta.dirname` - the harness only works inside the monorepo, which is fine: `test/` isn't published.

Unit tests (vitest, `*.test.ts` beside the sources) cover the chips, traps, ATR/SIO, cartridges, and input; they're the fast `pnpm test` tier, while Acid800 stays in the slow `conformance` tier.

## File map

| File                                                                | Role                                                                                   |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [src/machine.ts](src/machine.ts)                                    | `Atari`: config, the cycle/suspend phase machine, input methods, disk/trap delegation. |
| [src/mmu.ts](src/mmu.ts)                                            | `Mmu`: memory map, PORTB banking, trap registration and dispatch.                      |
| [src/antic-gtia.ts](src/antic-gtia.ts)                              | ANTIC+GTIA fused: display list, P/M graphics, NMI/RDY/HALT, scanline render.           |
| [src/pokey.ts](src/pokey.ts)                                        | POKEY: audio, keyboard scan, IRQs.                                                     |
| [src/pia.ts](src/pia.ts)                                            | PIA: joystick ports, XL/XE banking latch.                                              |
| [src/sio.ts](src/sio.ts)                                            | SIO high-level emulation (execute trap on SIOV).                                       |
| [src/atr.ts](src/atr.ts)                                            | `AtrImage`: sector-level `.atr` access.                                                |
| [src/cartridge.ts](src/cartridge.ts)                                | Cartridge formats and mappers (`CART_TYPES`).                                          |
| [src/xex-boot.ts](src/xex-boot.ts)                                  | `buildBootDisk`: XEX -> bootable ATR via the generated loader.                         |
| [src/build-loader.ts](src/build-loader.ts)                          | Dev-only: assembles the XEX loader with spasm -> `xex-loader-bytes.ts`.                |
| [src/detect-firmware.ts](src/detect-firmware.ts)                    | Known-firmware table and detection.                                                    |
| [src/firmware-preferences.ts](src/firmware-preferences.ts)          | OS/BASIC ranking per machine context.                                                  |
| [src/canonicalize.ts](src/canonicalize.ts)                          | Container normalization / combined-dump splitting.                                     |
| [src/detect-file-format.ts](src/detect-file-format.ts)              | ATR/XEX/CAR/ROM classification.                                                        |
| [src/palette.ts](src/palette.ts)                                    | NTSC/PAL palette builders.                                                             |
| [src/timing-constants.ts](src/timing-constants.ts)                  | Region timing and framebuffer dimensions (re-exported from the index).                 |
| [src/headless.ts](src/headless.ts)                                  | Node HLE host (not exported).                                                          |
| [src/boot.ts](src/boot.ts) / [src/screenshot.ts](src/screenshot.ts) | CLI over `Headless` / PNG rendering (not exported).                                    |
| [src/acid800-tests.ts](src/acid800-tests.ts)                        | The Acid800 conformance harness (baseline diffing, NTSC+PAL).                          |
