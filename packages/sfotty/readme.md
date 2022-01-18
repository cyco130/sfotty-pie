# `@sfotty-pie/sfotty`

**Sfotty** is a cycle-exact 6502 (**S**ixty **F**ive **O**h **T**wo) emulator that can run on Node.js or in the browser.

## Usage

Import `Sfotty` from the `@sfotty-pie/sfotty` package and create a new instance with `new Sfotty(memory)` where `memory` is an object implementing the `Memory` interface:

```ts
interface Memory {
	read(address: number): number;
	write(address: number, value: number): void;
}
```

The CPU starts with a pending reset interrupt. You can execute instructions by repeatedly calling `run()`. The `crashed` property returns `true` if the CPU crashes (by executing an undefined opcode).

## Ideas for future versions

-   Serialize/deserialize CPU state
-   Implement undocumented NMOS instructions
-   Implement CMOS (65C02) instruction set
