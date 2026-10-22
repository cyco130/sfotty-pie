# How `@sfotty-pie/rewind` works

Notes on the internals of the rewind layer, for contributors (and AI agents).

## What it is

Rewind turns a [Sfotty](../sfotty/readme.md) into a machine you can step backwards. It drives the CPU one whole instruction at a time and journals what that instruction changed, so `undo()` can put the machine back byte for byte.

It is deliberately **not** a savestate mechanism. Nothing is snapshotted wholesale. Each instruction records six bytes of register state plus the previous contents of whatever addresses it wrote, which on a 6502 is almost always zero or one byte. That makes history cheap enough to keep for every instruction of an interactive session, which is what a debugger's "undo the last instruction" needs.

Rewind owns no memory and no clock, the same way Sfotty does not. The host supplies the `Memory` bus and calls `step()`.

## Public API surface

Everything exported lives in [src/index.ts](src/index.ts):

- `RewindMachine` - the machine. Construct with a `Memory` bus and optional `RewindOptions`.
- `RewindOptions` - extends `SfottyOptions` with `historySize` and `devices`.
- `AddressRange` - an inclusive `{ start, end }` pair, for `devices`.

`RewindMachine` exposes `cpu` (the `Sfotty` itself, for reading and poking registers), `step()`, `undo()`, `canUndo()`, `clearHistory()`, and two counters: `depth` (how many instructions can still be undone) and `instructionsExecuted` (completed since construction, less those undone).

The CPU is reached through `cpu` rather than re-exported member by member, so everything Sfotty's facade offers - flags, lines, `onFetch`, `describeState()` - keeps working without rewind having to track its API.

## Wrapping the bus, not replacing it

The constructor hands Sfotty a bus that closes over the host's:

- **Reads pass straight through.** Memory-mapped I/O and the trap-by-throwing protocol ([Memory, reads, and traps](../sfotty/design.md#memory-reads-and-traps)) behave exactly as they would without rewind in the way.
- **Writes peek, then write, then journal.** The peek uses `ReadOptions.PEEK`, so reading the old value cannot itself trigger a device.

The order matters. Journalling _after_ the write means a write that throws records nothing, so when the host retries the suspended cycle the address is not journalled twice. The same reasoning drives the `try`/`catch` in `step()`, which clears the in-progress entry and rethrows: a bus that throws to suspend the CPU leaves no half-recorded instruction behind, and the retried cycle starts the instruction over cleanly.

## Device ranges

An address inside one of the `devices` ranges is written through without being journalled, and `undo()` therefore never replays it.

This is not an optimisation. Replaying a store into a memory-mapped register would make the device act a second time - print the character again, draw the shape again - because a device register is a command, not a value. A device that wants to be undoable rolls its own state back, which it can do properly because it knows what its registers mean.

## One instruction per `step()`

Sfotty runs one bus cycle per `cycle()` call, so `step()` loops until the CPU is back at an instruction boundary, which is the `DECODE` microstate:

```ts
do {
  cpu.cycle();
} while (cpu.state !== DECODE && !cpu.crashed);
```

Two guards sit around that loop:

- **A cycle cap.** The longest real instruction is 7 cycles, 8 for an interrupt sequence, so `MAX_CYCLES_PER_INSTRUCTION` is 32 and reaching it throws. In practice it means an RDY stall, which `step()` cannot support: it has no way to raise the line mid-instruction, because it never returns to the host between cycles.
- **A jam check.** A CIM repeats its last cycle forever, so `step()` returns immediately once `cpu.crashed` is set rather than spinning to the cap.

## The journal and the ring

`historySize` entries are allocated once at construction and reused as the ring wraps, so a long run allocates nothing. Each `Entry` holds the six register values from before the instruction (`a`, `x`, `y`, `s`, `p`, `pc`) and two parallel arrays, `addresses` and `oldValues`, truncated with `length = 0` rather than replaced.

`#head` is the next slot to write and `#count` how many are live, so the ring silently drops the oldest instruction once it is full. `historySize: 0` records nothing at all, for a run that will never be rewound.

## Undoing

`undo()` walks back one slot and replays the entry in reverse:

1. **Writes, newest first.** An address written twice during one instruction therefore ends on its oldest value, which is the one that was there before the instruction began. Read-modify-write instructions, which write twice, depend on this.
2. **Registers, then the microstate.** `A`, `X`, `Y`, `S`, `PC` and the status byte go back, and `state` is forced to `DECODE` so the CPU is at an instruction boundary rather than wherever the next `step()` left it.

A jam is not undone. `crashed` is set by the CPU and only a reset clears it, so a run that reached a CIM cannot be rewound past it.

## What is not covered

- **RDY stalls**, as above: `step()` is all-or-nothing within an instruction.
- **Interrupts asserted between steps** are journalled like any other instruction, since the whole sequence runs inside one `step()`. A host that lowers IRQ or NMI itself has to restore that line; rewind only knows about registers and memory.
- **`reset()`** is the CPU's, and rewind does not journal it. Call `clearHistory()` after one, or the history will claim to reach back past a machine that no longer exists.

## Correctness

[src/rewind.test.ts](src/rewind.test.ts) covers `step`, `undo`, `historySize`, jams and devices. The load-bearing one runs 300 instructions forward and 300 back and compares the whole 64 KB of RAM and every register against a snapshot taken before the run.

## File map

| File                                     | What it is                                |
| ---------------------------------------- | ----------------------------------------- |
| [src/index.ts](src/index.ts)             | The public exports                        |
| [src/rewind.ts](src/rewind.ts)           | `RewindMachine`, the journal and the ring |
| [src/rewind.test.ts](src/rewind.test.ts) | The tests                                 |
