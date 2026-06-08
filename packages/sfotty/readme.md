# Sfotty Pie

**Sfotty Pie** is a cycle-accurate NMOS 6502 CPU core. It implements all 256 opcodes — documented and undocumented — and is verified cycle by cycle against Tom Harte's processor tests.

## Interrupting the CPU (memory-mapped I/O, breakpoints, execute traps)

The core has no built-in "trap" type — and doesn't need one. To stop the CPU mid-cycle, throw any sentinel from your `Memory.read`/`write` and catch it around `run()`:

```ts
const TRAP = Symbol("trap");

class Bus implements Memory {
  read(address: number, options: ReadOptions): number {
    if (address === 0xd000) throw TRAP; // a memory-mapped register, say
    return this.ram[address];
  }
  write(address: number, value: number): void {
    /* ... */
  }
}

try {
  cpu.run();
} catch (e) {
  if (e !== TRAP) throw e;
  // React (service the register, pause, log a breakpoint, …). The bus access is
  // the first thing a cycle does, before any register changes, so the CPU is
  // still in its exact pre-cycle state — call run() again to retry the cycle.
}
```

Every cycle does its single bus access first and writes its next state last, so a throw always unwinds with the CPU untouched. The thrown value can be anything; the host already knows the address and access kind from its own bus.

Contributors: see [design.md](./design.md) for how the core works internally.

## License and credits

MIT license.

- [Fatih Aygün](https://github.com/cyco130) and [contributors](https://github.com/cyco130/sfotty-pie/graphs/contributors).
