/**
 * Why/how a read is happening — drives trap routing and the SYNC line.
 *
 * A const object rather than an `enum`: TypeScript enums emit runtime code,
 * which Node's strip-only type support (this repo's no-transpile execution
 * model) rejects. The values are bit flags, meant to be OR'd together.
 */
export const ReadOptions = {
	NONE: 0,
	PEEK: 1, // Don't cause side effects (debugger/disassembler inspection)
	OPCODE_FETCH: 2, // Opcode fetch (SYNC line); fires execute traps
	DMA: 4, // Read coming from another chip, not the CPU (e.g. ANTIC)
} as const;

/** A bit mask of {@link ReadOptions} flags. */
export type ReadOptions = number;

/**
 * Thrown by a bus implementation to interrupt the CPU at a trapped address.
 *
 * It's an opaque signal, not a payload: it only means "stop and unwind." The
 * throw happens during the cycle's bus access — before any register is mutated
 * — so the CPU is left in its pre-cycle state and the access can be retried.
 * The bus that threw it already knows the address and access kind, so the host
 * sources those from the bus (or from CPU state, e.g. PC at an execute trap)
 * rather than from the thrown value.
 *
 * Caught around run() with `e === TRAP`; rethrow anything else.
 */
export const TRAP = Symbol("trap");

export interface Memory {
	/**
	 * Read a byte from the address.
	 *
	 * Throws {@link TRAP} at a trapped address. The throw unwinds before any
	 * register is mutated, so the CPU is left in its pre-cycle state and the
	 * access can be retried after the host handles the trap.
	 *
	 * @returns The byte read
	 */
	read(address: number, options: ReadOptions): number;

	/**
	 * Write a byte to the address.
	 *
	 * Throws {@link TRAP} at a trapped address (the byte is NOT written). State
	 * is left pre-cycle so the write can be retried after the host handles it.
	 */
	write(address: number, value: number): void;
}
