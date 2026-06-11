# `@sfotty-pie/sfotty`

**Sfotty** is a cycle-exact 6502 (**S**ixty **F**ive **O**h **T**wo) emulator that can run on Node.js or in the browser. [MOS Technology 6502](https://en.wikipedia.org/wiki/MOS_Technology_6502) is an 8-bit microprocessor introduced in 1975 that powered many classic consoles and home computers such as Atari 2600, Atari 8-bit family, Apple II, Nintendo Entertainment System, Commodore 64, Atari Lynx, and BBC Micro.

Sfotty implements all documented and undocumented opcodes, and is verified cycle by cycle against the [SingleStepTests/65x02](https://github.com/SingleStepTests/65x02) test suite.

> Contributors: see [design.md](./design.md) for how it works internally.

## Usage

```sh
npm install @sfotty-pie/sfotty
```

The CPU must be provided with a `Memory` implementation during construction, and then you can drive it by calling `run()` in a loop. The CPU will call the bus's `read` and `write` methods on every cycle, and you can react to those calls to implement memory-mapped I/O, breakpoints, execute traps, or whatever else your system needs.

```ts
import { Sfotty, type Memory } from "@sfotty-pie/sfotty";

const ram = new Uint8Array(0x10000);

const bus: Memory = {
  read: (address) => ram[address]!,
  write: (address, value) => {
    ram[address] = value;
  },
};

// LDA #$2A; STA $00 at $0600, with the reset vector pointing at it.
ram.set([0xa9, 0x2a, 0x85, 0x00], 0x0600);
ram.set([0x00, 0x06], 0xfffc);

// A new CPU powers on into the 7-cycle reset sequence, like the real chip.
const cpu = new Sfotty(bus);

for (let i = 0; i < 12; i++) cpu.run(); // 7 reset cycles + LDA (2) + STA (3)

console.log(cpu.A); // 42
console.log(ram[0x00]); // 42
```

### Traps and asynchronous behavior

`run()` is synchronous, so the bus can't return a promise — but it can **throw**. Throwing from `read` or `write` is the supported way to suspend the CPU for anything that can't be answered inline: asynchronous I/O behind a memory-mapped register, a debugger pausing on a breakpoint or watchpoint, an execute trap on a magic address, and so on.

This is safe because the first thing every cycle does is its single bus access — no register or internal state is touched before it. A throw therefore unwinds with the CPU in its exact pre-cycle state, and once the host has reacted it calls `run()` again to retry the same cycle from scratch.

```ts
const TRAP = Symbol("trap");

class Bus implements Memory {
  read(address: number, options: ReadOptions): number {
    if (address === 0xd000) throw TRAP; // a memory-mapped register, say
    return this.ram[address]!;
  }
  write(address: number, value: number): void {
    /* ... */
  }
}

try {
  cpu.run();
} catch (e) {
  if (e !== TRAP) throw e;
  await serviceRegister(); // react: do async I/O, pause in a debugger, etc.
  cpu.run(); // retries the exact same cycle
}
```

The thrown value can be anything; the host already knows the address and access kind from its own bus, so a sentinel like the symbol above is usually enough.

## License and credits

MIT license.

- [Fatih Aygün](https://github.com/cyco130) and [contributors](https://github.com/cyco130/sfotty-pie/graphs/contributors).
