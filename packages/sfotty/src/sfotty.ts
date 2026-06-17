import { type Memory } from "./bus.ts";
import { SfottyCore, type SfottyOptions } from "./sfotty-core.ts";

export { type SfottyOptions };

/**
 * A cycle-exact NMOS 6502 CPU.
 *
 * This is a thin facade over the internal core: it exposes the host-facing
 * contract — registers, flags, input lines, `run()`/`reset()` — and nothing
 * else. The micro-op machinery the generated microcode calls into lives on
 * the core, which is unreachable from here, so inspecting a `Sfotty` (in a
 * debugger, or from a browser console) shows only real 6502 state.
 */
export class Sfotty {
	readonly #core: SfottyCore;

	constructor(bus: Memory, options: SfottyOptions = {}) {
		this.#core = new SfottyCore(bus, options);
	}

	/** The accumulator. */
	get A(): number {
		return this.#core.A;
	}
	set A(value: number) {
		this.#core.A = value;
	}

	/** The X index register. */
	get X(): number {
		return this.#core.X;
	}
	set X(value: number) {
		this.#core.X = value;
	}

	/** The Y index register. */
	get Y(): number {
		return this.#core.Y;
	}
	set Y(value: number) {
		this.#core.Y = value;
	}

	/** The stack pointer (the low byte; the stack lives at $0100–$01FF). */
	get S(): number {
		return this.#core.S;
	}
	set S(value: number) {
		this.#core.S = value;
	}

	/** The 16-bit program counter. */
	get PC(): number {
		return this.#core.PC;
	}
	set PC(value: number) {
		this.#core.PC = value;
	}

	/** The carry flag. */
	get cFlag(): boolean {
		return this.#core.cFlag;
	}
	set cFlag(value: boolean) {
		this.#core.cFlag = value;
	}

	/** The zero flag. */
	get zFlag(): boolean {
		return this.#core.zFlag;
	}
	set zFlag(value: boolean) {
		this.#core.zFlag = value;
	}

	/** The interrupt-disable flag. */
	get iFlag(): boolean {
		return this.#core.iFlag;
	}
	set iFlag(value: boolean) {
		this.#core.iFlag = value;
	}

	/** The decimal flag (still present with `withoutDecimal`, just ignored). */
	get dFlag(): boolean {
		return this.#core.dFlag;
	}
	set dFlag(value: boolean) {
		this.#core.dFlag = value;
	}

	/** The overflow flag. */
	get vFlag(): boolean {
		return this.#core.vFlag;
	}
	set vFlag(value: boolean) {
		this.#core.vFlag = value;
	}

	/** The negative flag. */
	get nFlag(): boolean {
		return this.#core.nFlag;
	}
	set nFlag(value: boolean) {
		this.#core.nFlag = value;
	}

	/**
	 * The B flag. Not a real register bit — it only exists in the status byte
	 * pushed to the stack: 1 for a software push (BRK/PHP), 0 for a hardware
	 * interrupt. Read back via {@link getP}; {@link setP} ignores it.
	 */
	get bFlag(): boolean {
		return this.#core.bFlag;
	}
	set bFlag(value: boolean) {
		this.#core.bFlag = value;
	}

	/**
	 * Current microstate. A new CPU powers on into the cold-reset sequence
	 * (construction is equivalent to `reset(true)`), so the first seven run()
	 * calls carry out the reset and land at `DECODE`. Hosts that seed registers
	 * directly instead (savestates, test harnesses) should also set
	 * `state = DECODE` to skip it. `state === DECODE` means the next cycle
	 * fetches an opcode, i.e. the CPU is at an instruction boundary.
	 */
	get state(): number {
		return this.#core.state;
	}
	set state(value: number) {
		this.#core.state = value;
	}

	/**
	 * Set when the CPU crashes on a CIM (or, with `withoutUndocumented`, on any
	 * undocumented opcode). It then repeats that cycle forever until reset.
	 */
	get crashed(): boolean {
		return this.#core.crashed;
	}

	/**
	 * The RDY input line. When the host pulls it false before a read cycle, that
	 * cycle still issues its bus read but then stalls: nothing is mutated and
	 * the next `run()` repeats the same read until RDY is true again. NMOS
	 * quirk: only read cycles honor RDY — write cycles complete regardless.
	 */
	get RDY(): boolean {
		return this.#core.RDY;
	}
	set RDY(value: boolean) {
		this.#core.RDY = value;
	}

	/**
	 * The IRQ input line (positive logic here: `true` = asserted). Level-sensitive
	 * — while it is asserted and the I flag is clear, an IRQ is recognized at an
	 * instruction boundary. The host must wired-OR all its IRQ sources into this
	 * single boolean.
	 */
	get IRQ(): boolean {
		return this.#core.IRQ;
	}
	set IRQ(value: boolean) {
		this.#core.IRQ = value;
	}

	/**
	 * The NMI input line (positive logic here: `true` = asserted). Edge-triggered
	 * — a false→true transition latches a pending NMI, serviced at the next
	 * instruction boundary regardless of the I flag. The host must wired-OR all
	 * its NMI sources into this single boolean, and must hold the line asserted
	 * for several cycles until the CPU acknowledges it.
	 */
	get NMI(): boolean {
		return this.#core.NMI;
	}
	set NMI(value: boolean) {
		this.#core.NMI = value;
	}

	/**
	 * Optional hook fired at each committed opcode fetch (`SYNC & !DUMMY`), with
	 * the opcode's address, just after the fetch commits. Not fired on the dummy
	 * fetch before an interrupt or on RDY-stalled re-fetches, so it sees each
	 * executed instruction exactly once. For tracing / instruction-level
	 * debugging; it must not throw (use an execute interceptor to suspend at a
	 * fetch). Undefined by default (zero overhead).
	 */
	get onFetch(): ((pc: number) => void) | undefined {
		return this.#core.onFetch;
	}
	set onFetch(value: ((pc: number) => void) | undefined) {
		this.#core.onFetch = value;
	}

	/** Pack the status flags into a byte. Bit 5 (unused) reads as 1; bit 4 is B. */
	getP(): number {
		return this.#core.getP();
	}

	/** Unpack a status byte into the flags. Bits 4 and 5 are ignored. */
	setP(p: number): void {
		this.#core.setP(p);
	}

	/** Advance the CPU by exactly one clock cycle (one bus access). */
	run(): void {
		this.#core.run();
	}

	/**
	 * Start the seven-cycle reset sequence (emulates the RES line). When `cold`
	 * is true the registers, flags, and internal latches are first cleared to
	 * the power-on state; a warm reset leaves them as-is. Also clears a CIM
	 * crash. A new CPU already starts in this sequence (construction is a
	 * power-on); call this to model a RES pulse at runtime.
	 */
	reset(cold: boolean): void {
		this.#core.reset(cold);
	}

	/** Describe a microstate (defaults to the current one) for debugging. */
	describeState(state: number = this.state): string {
		return this.#core.describeState(state);
	}
}
