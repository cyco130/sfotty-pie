/**
 * Why/how a read is happening — distinguishes a normal CPU read, an opcode
 * fetch (the SYNC pin), a non-committing dummy access, a side-effect-free peek,
 * and another chip's DMA.
 *
 * A const object rather than an `enum`: TypeScript enums emit runtime code,
 * which Node's strip-only type support (this repo's no-transpile execution
 * model) rejects. The values are bit flags, meant to be OR'd together.
 *
 * `SYNC` is the physical pin — asserted on *every* opcode-fetch cycle, including
 * the dummy fetch the CPU does just before servicing a pending NMI/IRQ and the
 * re-fetch of an RDY-stalled cycle (verified against a Visual6502 trace). `DUMMY`
 * marks a *non-committing* CPU access — the interrupt dummy fetch and the
 * RDY-stalled re-fetch today (other dummy reads/writes are not marked yet). So a
 * **committed opcode fetch is `SYNC & !DUMMY`**, which is what execute traps want:
 * fire once on the real fetch, never on the dummy (which would otherwise
 * double-fire after the interrupt returns and re-fetches).
 */
export const ReadOptions = {
	NONE: 0,
	PEEK: 1, // Don't cause side effects (debugger/disassembler inspection)
	SYNC: 2, // The SYNC pin: any opcode-fetch cycle, including dummy/stalled fetches
	DUMMY: 4, // A non-committing CPU access (interrupt dummy fetch, RDY-stalled re-fetch)
	DMA: 8, // Access coming from another chip, not the CPU (e.g. ANTIC)
} as const;

/** A bit mask of {@link ReadOptions} flags. */
export type ReadOptions = number;

export interface Memory {
	/**
	 * Read a byte from the address.
	 *
	 * May throw to interrupt the CPU (for memory-mapped I/O, breakpoints, or
	 * execute traps). The bus access is the first thing a cycle does, before any
	 * register is mutated, so a throw unwinds with the CPU in its exact pre-cycle
	 * state — the host can catch it around `run()`, react, and re-`run()` to retry
	 * the same cycle. See the readme.
	 *
	 * @returns The byte read
	 */
	read(address: number, options: ReadOptions): number;

	/**
	 * Write a byte to the address.
	 *
	 * May throw to interrupt the CPU like {@link Memory.read}; the byte is not
	 * written and the cycle can be retried.
	 */
	write(address: number, value: number): void;
}
