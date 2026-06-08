/**
 * Why/how a read is happening — distinguishes a normal CPU read, the opcode
 * fetch (SYNC), a side-effect-free peek, and another chip's DMA.
 *
 * A const object rather than an `enum`: TypeScript enums emit runtime code,
 * which Node's strip-only type support (this repo's no-transpile execution
 * model) rejects. The values are bit flags, meant to be OR'd together.
 */
export const ReadOptions = {
	NONE: 0,
	PEEK: 1, // Don't cause side effects (debugger/disassembler inspection)
	OPCODE_FETCH: 2, // Opcode fetch (asserts the SYNC line)
	DMA: 4, // Read coming from another chip, not the CPU (e.g. ANTIC)
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
