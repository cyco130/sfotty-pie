# Rewind

Instruction-level reversible execution over a [Sfotty](../sfotty/readme.md) 6502: step a program forward one instruction at a time, then step it back and get the machine you had before, byte for byte.

This exists for debuggers and teaching tools, where "undo the last instruction" is a thing a person asks for. It is not a savestate mechanism - nothing is snapshotted wholesale. Each instruction records six bytes of register state plus the previous contents of whatever addresses it wrote, which for the 6502 is almost always zero or one byte, so history is cheap and bounded by a ring of a configurable size.

> Contributors: see [design.md](./design.md) for how it works internally.

## Usage

```ts
import { RewindMachine } from "@sfotty-pie/rewind";

const ram = new Uint8Array(0x10000);
const bus = {
  read: (address: number) => ram[address]!,
  write: (address: number, value: number) => {
    ram[address] = value;
  },
};

const machine = new RewindMachine(bus, { historySize: 1024 });
machine.cpu.PC = 0x0200;
machine.cpu.state = DECODE;

machine.step(); // run one whole instruction
machine.undo(); // and put everything back
```

The host's bus is wrapped rather than replaced: reads pass straight through, so memory-mapped I/O and Sfotty's trap-by-throwing protocol keep working. Writes are peeked before they land, and only journaled once they succeed, so a trapped and retried cycle records nothing twice.

Construction options are Sfotty's own plus `historySize`, the number of instructions to keep (older instructions fall off the end; 0 records nothing), and `devices`, the address ranges the journal leaves alone.

## Devices

Replaying a store into a memory-mapped register would make the device act a second time - print the character again, draw the shape again - so ranges listed in `devices` are not journaled and undo does not touch them. A device rolls its own state back, which is what a peripheral with a visible history has to do anyway.

```ts
const machine = new RewindMachine(bus, {
  devices: [{ start: 0xd000, end: 0xd0ff }],
});
```

Everything else about the instruction still undoes normally: registers, flags, and the writes it made outside those ranges, the stack included.

## What it does not restore

- A jam. `crashed` is set by the CPU and only a reset clears it, so a run that reached a `CIM` cannot be rewound past it.
- A pending NMI edge, or a stalled `RDY`. Neither is readable from outside the CPU, so neither is journaled; `step` rejects an instruction that outlives 32 cycles rather than pretending otherwise.
- A device's own state. Declare it in `devices` and roll it back where it lives.

## License and credits

MIT license.

- [Fatih Aygün](https://github.com/cyco130) and [contributors](https://github.com/cyco130/sfotty-pie/graphs/contributors).
