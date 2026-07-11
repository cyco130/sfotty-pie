# Sfotty Pie A8

**Sfotty Pie A8** is a headless Atari 8-bit emulator, built on the [Sfotty Pie](https://github.com/cyco130/sfotty-pie/tree/main/packages/sfotty) 6502 core. Headless by design: the machine is complete - video, audio, input, and disk I/O all exist - but every interface is a socket for the host to plug into. The framebuffer is a byte array to render, the audio output is a level to sample, and input goes through devices: joystick ports you plug a `Joystick` into, a keyboard matrix POKEY scans like the real chip, the console panel's switches. See [apps/a8-web](https://github.com/cyco130/sfotty-pie/tree/main/apps/a8-web) in the repository for a browser host that wires them all.

> Contributors: see [design.md](./design.md) for how it works internally.

## Usage

```sh
npm install @sfotty-pie/a8
```

Construct an `Atari` with a `MachineConfig` - only the `os` ROM image is required; the other options (`xl`, `tvSystem`, RAM sizes, built-in `basic`, ...) select the machine variant. Media attach through the machine: the `cartridge` accessor for carts (on the 400/800, BASIC is just a cartridge), `insertDisk` for ATR images. Then drive it one machine cycle at a time:

```ts
import { Atari, AtrImage, paletteFor } from "@sfotty-pie/a8";

const machine = new Atari({ os }); // os: Uint8Array ROM image
machine.insertDisk(new AtrImage(atrFileBytes));

try {
  machine.cycle(); // one machine cycle
} catch (signal) {
  // a trap suspended the cycle - resolve it; the next cycle() call picks
  // the same cycle up where it left off:
  machine.cycle();
}
// video: machine.frame holds one Atari color byte per pixel
// (FRAME_BUFFER_WIDTH x FRAME_BUFFER_HEIGHT); map it through
// paletteFor(tvSystem) to get RGBA pixels.
// audio: sample machine.audio (0-2) after each cycle.
```

A bus access may **throw** to suspend the machine mid-cycle (the same host-defined-sentinel model as the underlying CPU core); an ordinary host that just boots software never triggers this - disk I/O is served internally by a high-level SIO handler, no serial hardware emulation involved.

The rest of the surface - the input devices (`machine.keyboard`, `machine.joysticks` + the `Joystick` class, `machine.console`), the memory-trap API (`interceptRead`/`observeWrite`/`interceptExecute`/...), firmware detection and ranking helpers, cartridge and disk-image types, boot-disk building for XEX files, and the timing constants - is documented in the JSDoc comments on the exported types.

## License and credits

MIT license.

- [Fatih Aygün](https://github.com/cyco130) and [contributors](https://github.com/cyco130/sfotty-pie/graphs/contributors).

The repository includes the **Altirra Acid800** hardware-conformance test suite (`test/acid800/acid800.atr`) to drive CI conformance tests. It lives in the sources only - the published npm package ships just `dist/` and `atari-src/`, not the test data. Acid800 is by Avery Lee and separately MIT-licensed - see [test/acid800/LICENSE](https://github.com/cyco130/sfotty-pie/blob/main/packages/a8/test/acid800/LICENSE). This project is independent and not affiliated with or endorsed by the Acid800 or Altirra projects.
