import { ReadOptions, type Memory } from "./interface.ts";
import { DECODE, RESET, type Step } from "./microcode.ts";
import { MICROCODE } from "./nmos-step.ts";
import { NMOS_INSTRUCTIONS } from "./nmos.ts";

/** Variant flags that change the instruction set/behavior. */
export interface SfottyOptions {
	/**
	 * Specifies whether the CPU should disable decimal mode.
	 *
	 * Some variants of the 6502, such as the Ricoh 2A03/2A07 used in the NES,
	 * do not support decimal mode. The flag is still present and its value can
	 * be changed and observed, but instructions will always operate in binary
	 * mode.
	 *
	 * @default false
	 */
	withoutDecimal?: boolean;
	/**
	 * Specifies whether the CPU should support undocumented opcodes.
	 *
	 * Undocumented opcodes are not part of the official 6502 specification and
	 * their behavior may vary between different implementations. If this
	 * option is set to `false`, all undocumented opcodes will crash the CPU
	 * similar to the `CIM` (also called `KIL`, `JAM`, or `HLT`) instruction.
	 *
	 * @default false
	 */
	withoutUndocumented?: boolean;
}

/**
 * The unstable "magic constant" ORed into A by ANE/LXA (`A = (A | C) & X & imm`).
 * It is chip- and temperature-dependent on real hardware, so no value is
 * universally correct. We use $EE: it matches Harte's `8b` vectors exactly
 * (10000/10000) and is the value reported for the Atari 400/800. Measured
 * Harte failures for other choices: $FF → 2379, $00 → 5462. Note the Atari
 * XL/XE (SALLY) is reported as $00 (Hias), so this differs there.
 */
const ANE_MAGIC = 0xee;

export class Sfotty {
	// Programmer-visible registers (8-bit, except the 16-bit PC).
	A = 0;
	X = 0;
	Y = 0;
	S = 0;
	PC = 0;

	// Status flags, stored discretely and assembled in getP()/setP().
	cFlag = false;
	zFlag = false;
	iFlag = false;
	dFlag = false;
	vFlag = false;
	nFlag = false;
	// The B flag. Unlike the others it isn't a real register bit — it only exists
	// in the status byte pushed to the stack, where it's 1 for a software push
	// (BRK/PHP) and 0 for a hardware interrupt (IRQ/NMI). `decode` sets it: true on
	// a normal fetch, false when it forces the interrupt sequence. setP() ignores
	// it (B is discarded on a pull), so it's read back only via getP().
	bFlag = true;

	// Internal latches.
	#dr = 0; // Data latch; also the zero-page pointer for indirect modes.
	#al = 0; // Address latch, low byte.
	#ah = 0; // Address latch, high byte.
	#crossed = false; // Page-boundary-crossed flag, set by ar+=x?/ar+=y?.
	#offset = 0; // Branch offset, stashed before the fetch cycle clobbers DR.
	#branchFixup = 0; // PCH adjustment (-1/0/+1) pending after a branch page cross.

	/** Current microstate. Starts at DECODE so the first run() reads an opcode. */
	state = DECODE;

	/**
	 * Set when the CPU crashes on a CIM (or, with `withoutUndocumented`, on any
	 * undocumented opcode). It then repeats that cycle forever until reset.
	 */
	crashed = false;

	/**
	 * The RDY input line. When the host pulls it false before a read cycle, that
	 * cycle still issues its bus read but then stalls: no register is mutated and
	 * `state` does not advance, so the next `run()` repeats the same read until
	 * RDY is true again. NMOS quirk: only read cycles honor RDY — write cycles
	 * complete regardless.
	 */
	RDY = true;

	/**
	 * The IRQ input line (positive logic here: `true` = asserted). Level-sensitive
	 * — while it is asserted and the I flag is clear, an IRQ is recognized at an
	 * instruction boundary. The host must wired-OR all its IRQ sources into this
	 * single boolean. Not yet honored by run().
	 */
	IRQ = false;

	/**
	 * The NMI input line (positive logic here: `true` = asserted). Edge-triggered
	 * — a false→true transition latches a pending NMI, serviced at the next
	 * instruction boundary regardless of the I flag. The host must wired-OR all
	 * its NMI sources into this single boolean. Not yet honored by run().
	 */
	NMI = false;

	#nmiPrev = false; // For edge detection of NMI.
	#nmiPending = false; // Set when an NMI is latched, cleared when serviced.
	#interruptDetected = false; // Combined NMI/IRQ detect, recomputed each cycle; opPoll latches it one cycle later (the two-cycles-before-decode delay).
	#interruptPending = false; // When set, decode will enter the interrupt sequence instead of the opcode's normal microcode.

	readonly #bus: Memory;
	readonly #withoutDecimal: boolean;
	readonly #microcode: Step[];

	constructor(bus: Memory, options: SfottyOptions = {}) {
		this.#bus = bus;
		this.#withoutDecimal = options.withoutDecimal ?? false;
		this.#microcode =
			(options.withoutUndocumented ?? true)
				? MICROCODE_CRASH_UNDOCUMENTED
				: MICROCODE;
	}

	/** Pack the status flags into a byte. Bit 5 (unused) reads as 1; bit 4 is B. */
	getP(): number {
		return (
			(this.nFlag ? 0x80 : 0) |
			(this.vFlag ? 0x40 : 0) |
			0x20 |
			(this.bFlag ? 0x10 : 0) |
			(this.dFlag ? 0x08 : 0) |
			(this.iFlag ? 0x04 : 0) |
			(this.zFlag ? 0x02 : 0) |
			(this.cFlag ? 0x01 : 0)
		);
	}

	/** Unpack a status byte into the flags. Bits 4 and 5 are ignored. */
	setP(p: number): void {
		this.nFlag = (p & 0x80) !== 0;
		this.vFlag = (p & 0x40) !== 0;
		this.dFlag = (p & 0x08) !== 0;
		this.iFlag = (p & 0x04) !== 0;
		this.zFlag = (p & 0x02) !== 0;
		this.cFlag = (p & 0x01) !== 0;
	}

	/** Advance the CPU by exactly one clock cycle (one bus access). */
	run(): void {
		this.#microcode[this.state]!(this);

		// Interrupt detection: Checking it here introduces a one-cycle delay.
		// The real hardware has a half-cycle delay but we only model full cycles.
		if (this.NMI && !this.#nmiPrev) {
			this.#nmiPending = true;
		}
		this.#nmiPrev = this.NMI;
		this.#interruptDetected = this.#nmiPending || (this.IRQ && !this.iFlag);
	}

	/**
	 * Start the reset sequence (emulates the RES line). Puts the CPU into a
	 * dedicated seven-cycle sequence that decrements S three times, sets I, and
	 * reads the reset vector at $FFFC/$FFFD into PC — so the next seven run()
	 * calls carry out the reset and land back at DECODE. Timing is not exact (no
	 * reset-pulse-too-short modeling). When `cold` is true (power-on) the
	 * registers, flags, and internal latches are first cleared to a known state
	 * (S = 0, so the sequence's three decrements leave it at the usual $FD); a
	 * warm reset leaves them as-is. Also clears a CIM crash. The host calls this;
	 * nothing arms it automatically.
	 */
	reset(cold: boolean): void {
		if (cold) {
			this.A = 0;
			this.X = 0;
			this.Y = 0;
			this.S = 0;
			this.PC = 0;
			this.cFlag = false;
			this.zFlag = false;
			this.iFlag = false;
			this.dFlag = false;
			this.vFlag = false;
			this.nFlag = false;
			this.#dr = 0;
			this.#al = 0;
			this.#ah = 0;
			this.#crossed = false;
			this.#offset = 0;
			this.#branchFixup = 0;
			this.#nmiPending = false;
			this.#interruptDetected = false;
			// Baseline the edge detector to the current line so a held NMI doesn't
			// register a phantom false→true edge on the first post-reset cycle.
			this.#nmiPrev = this.NMI;
		}
		this.crashed = false;
		this.state = RESET;
	}

	/**
	 * The bus read choke point — issues the single read. RDY is not handled here:
	 * each read op issues the read through this method and then, if RDY is low,
	 * bails without mutating state (so the bus still sees the read every stalled
	 * cycle). A throw from the bus propagates out, before any register changes.
	 * @internal
	 */
	#read(address: number, options: ReadOptions): number {
		return this.#bus.read(address, options);
	}

	/**
	 * The bus write choke point. Writes ignore RDY entirely (NMOS quirk), so this
	 * is a straight passthrough — it never stalls. @internal
	 */
	#write(address: number, value: number): void {
		this.#bus.write(address, value);
	}

	/**
	 * Human-readable description of a microstate, for logging/debugging — e.g.
	 * `"LDA abs · cycle 3"` or `"decode"`. Cycles count the opcode fetch as cycle
	 * 0 (`decode`), so `code[i]` is cycle `i + 1`, matching the generated step
	 * names.
	 */
	describeState(state: number = this.state): string {
		if (state === DECODE) return "decode";
		if (state >= RESET && state <= RESET + 6) {
			return `reset · cycle ${state - RESET + 1}`;
		}
		const instruction = NMOS_INSTRUCTIONS[state >> 3];
		const cycle = state & 7;
		if (!instruction || cycle >= instruction.code.length) {
			return `<invalid state ${state}>`;
		}
		return `${instruction.mnemonic} ${instruction.mode} · cycle ${cycle + 1}`;
	}

	// --- Micro-op implementations (called by the microcode table) -------------
	// One method per microcode token, all prefixed `op` so they stand apart from
	// the public CPU API. The generator maps each token to one of these (e.g.
	// "r-pc++" → opReadOperand). They are grouped below as bus reads, then bus
	// writes, then internal ops: bus ops perform the single read/write and bump
	// pointers *after* the access returns (so a bus throw leaves state intact); internal
	// ops are pure register transfers.
	//
	// Bus reads return a boolean: `false` means RDY was low, so the read was issued
	// to the bus but no register changed — the generated step must bail without
	// advancing `state`, leaving the cycle to repeat (and re-read) until RDY rises.
	// Writes ignore RDY and internal ops never stall, so both return void.

	// Bus reads ----------------------------------------------------------------

	/**
	 * `opReadDecode` — the decode cycle (the implicit `r-t1`): read the next opcode
	 * while asserting the SYNC line. Normally it advances PC and jumps to the
	 * opcode's microcode. But if a poll latched a pending interrupt, the read is a
	 * dummy: PC is *not* advanced and the CPU runs the BRK/interrupt sequence
	 * (`state = 0`) instead of the fetched opcode, with `bFlag` cleared so the
	 * pushed status has B = 0. The pending flag is consumed here — the sequence
	 * itself never polls, so without this the next decode would re-enter it.
	 * Unlike the other bus reads it is a whole step — it sets `state` itself — and
	 * the generator wires it into the DECODE slot rather than mapping it from a
	 * token. @internal
	 */
	opReadDecode(): boolean {
		const value = this.#read(this.PC, ReadOptions.OPCODE_FETCH);
		if (!this.RDY) {
			return false;
		}

		if (this.#interruptPending) {
			this.#interruptPending = false;
			this.bFlag = false;
			this.state = 0; // BRK / interrupt sequence
		} else {
			this.bFlag = true;
			this.PC = inc16(this.PC);
			this.state = value << 3;
		}

		return true;
	}

	/** `r-pc++`: read the operand byte at PC into DR, then advance PC. @internal */
	opReadOperand(): boolean {
		const value = this.#read(this.PC, ReadOptions.NONE);
		if (!this.RDY) {
			return false;
		}

		this.#dr = value;
		this.PC = inc16(this.PC);
		return true;
	}

	/**
	 * `r-brk`: BRK/interrupt second-cycle read. Reads at PC (the value is a dummy —
	 * it gets overwritten by the following `dr=pch`) and advances PC *only* on a
	 * software BRK (`bFlag`); a hardware interrupt leaves PC put, so the pushed
	 * return address is the interrupted instruction rather than skipping a byte.
	 * @internal
	 */
	opReadBreakByte(): boolean {
		const value = this.#read(this.PC, ReadOptions.NONE);
		if (!this.RDY) {
			return false;
		}

		this.#dr = value;
		if (this.bFlag) this.PC = inc16(this.PC);
		return true;
	}

	/** `r-ar`: read from the effective address (AR) into DR. @internal */
	opReadAddr(): boolean {
		const value = this.#read(this.#addr, ReadOptions.NONE);
		if (!this.RDY) {
			return false;
		}

		this.#dr = value;
		return true;
	}

	/** `r-pc`: read at PC into DR without advancing PC (dummy/operand read). @internal */
	opReadPc(): boolean {
		const value = this.#read(this.PC, ReadOptions.NONE);
		if (!this.RDY) {
			return false;
		}

		this.#dr = value;
		return true;
	}

	/** `r-ar++`: read from AR into DR, then increment AR's low byte only (no carry). @internal */
	opReadAddrInc(): boolean {
		const value = this.#read(this.#addr, ReadOptions.NONE);
		if (!this.RDY) {
			return false;
		}

		this.#dr = value;
		this.#al = (this.#al + 1) & 0xff;
		return true;
	}

	/** `r-dr++`: read from the zero-page pointer DR into AL, then advance DR (wraps). @internal */
	opReadPointerInc(): boolean {
		const value = this.#read(this.#dr, ReadOptions.NONE);
		if (!this.RDY) {
			return false;
		}

		this.#al = value;
		this.#dr = (this.#dr + 1) & 0xff;
		return true;
	}

	/** `r-dr`: read from the zero-page pointer DR into AH. @internal */
	opReadPointer(): boolean {
		const value = this.#read(this.#dr, ReadOptions.NONE);
		if (!this.RDY) {
			return false;
		}

		this.#ah = value;
		return true;
	}

	// Bus writes ---------------------------------------------------------------

	/** `w-ar`: write DR to the effective address. @internal */
	opWriteAddr(): void {
		this.#write(this.#addr, this.#dr);
	}

	/** `w-ar--`: write DR to AR, then decrement AR's low byte only (no borrow). @internal */
	opWriteAddrDec(): void {
		this.#write(this.#addr, this.#dr);
		this.#al = (this.#al - 1) & 0xff;
	}

	// Internal ops -------------------------------------------------------------

	/** `ar=dr`: set the effective address to DR (zero page: high byte 0). @internal */
	opAddrFromDr(): void {
		this.#al = this.#dr;
		this.#ah = 0;
	}

	/** `ah=dr`: set the high byte of the effective address to DR. @internal */
	opAddrHighFromDr(): void {
		this.#ah = this.#dr;
	}

	/** `ar+=x`: add X to the low address byte, wrapping within the zero page. @internal */
	opAddX(): void {
		this.#al = (this.#al + this.X) & 0xff;
	}

	/** `ar+=y`: add Y to the low address byte, wrapping within the zero page. @internal */
	opAddY(): void {
		this.#al = (this.#al + this.Y) & 0xff;
	}

	/** `ar+=x?`: add X to AL (8-bit), flagging a page cross; high byte fixed later. @internal */
	opAddXCarry(): void {
		const sum = this.#al + this.X;
		this.#crossed = sum > 0xff;
		this.#al = sum & 0xff;
	}

	/** `ar+=y?`: add Y to AL (8-bit), flagging a page cross; high byte fixed later. @internal */
	opAddYCarry(): void {
		const sum = this.#al + this.Y;
		this.#crossed = sum > 0xff;
		this.#al = sum & 0xff;
	}

	/** `ah++`: increment the high byte of the effective address. @internal */
	opIncAddrHigh(): void {
		this.#ah = (this.#ah + 1) & 0xff;
	}

	/** `?ah++`: increment AH only if a page boundary was crossed. @internal */
	opFixAddrHigh(): void {
		if (this.#crossed) this.#ah = (this.#ah + 1) & 0xff;
	}

	/** Whether the last indexed address calculation crossed a page boundary. @internal */
	get crossed(): boolean {
		return this.#crossed;
	}

	/** `a=dr`: load A from DR, updating the N and Z flags. @internal */
	opLoadA(): void {
		this.A = this.#dr;
		this.#setNZ(this.#dr);
	}

	/** `x=dr`: load X from DR, updating the N and Z flags. @internal */
	opLoadX(): void {
		this.X = this.#dr;
		this.#setNZ(this.#dr);
	}

	/** `y=dr`: load Y from DR, updating the N and Z flags. @internal */
	opLoadY(): void {
		this.Y = this.#dr;
		this.#setNZ(this.#dr);
	}

	/** `ro-lax` (LAX): load both A and X from DR, updating N and Z. @internal */
	opLax(): void {
		this.A = this.#dr;
		this.X = this.#dr;
		this.#setNZ(this.#dr);
	}

	// Data latch loads (stores stage DR for a later w-ar) ----------------------

	/** `dr=a` / `sta`: copy A into DR. @internal */
	opDrFromA(): void {
		this.#dr = this.A;
	}

	/** `dr=x` / `stx`: copy X into DR. @internal */
	opDrFromX(): void {
		this.#dr = this.X;
	}

	/** `dr=y` / `sty`: copy Y into DR. @internal */
	opDrFromY(): void {
		this.#dr = this.Y;
	}

	/** `sax` (SAX): stage A & X for the write; does not affect flags. @internal */
	opSax(): void {
		this.#dr = this.A & this.X;
	}

	/**
	 * Shared store-high logic for the unstable SHA/SHX/SHY/SHS group: the value
	 * written is `reg & (baseHigh + 1)`, and on a page cross the store address's
	 * high byte is corrupted to that value. Runs after `?ah++`, so on a cross AH
	 * already holds `baseHigh + 1`.
	 */
	#storeHigh(reg: number): void {
		if (this.#crossed) {
			const value = reg & this.#ah;
			this.#ah = value;
			this.#dr = value;
		} else {
			this.#dr = reg & ((this.#ah + 1) & 0xff);
		}
	}

	/** `sha` (SHA/AHX): store A & X & (H+1) — unstable. @internal */
	opSha(): void {
		this.#storeHigh(this.A & this.X);
	}

	/** `shx` (SHX/SXA): store X & (H+1) — unstable. @internal */
	opShx(): void {
		this.#storeHigh(this.X);
	}

	/** `shy` (SHY/SYA): store Y & (H+1) — unstable. @internal */
	opShy(): void {
		this.#storeHigh(this.Y);
	}

	/** `shs` (TAS/SHS): SP = A & X, then store A & X & (H+1) — unstable. @internal */
	opShs(): void {
		this.S = this.A & this.X;
		this.#storeHigh(this.A & this.X);
	}

	// ALU read ops -------------------------------------------------------------

	/** `ro-ora`: A |= DR. @internal */
	opOra(): void {
		this.A |= this.#dr;
		this.#setNZ(this.A);
	}

	/** `ro-and`: A &= DR. @internal */
	opAnd(): void {
		this.A &= this.#dr;
		this.#setNZ(this.A);
	}

	/** `ro-eor`: A ^= DR. @internal */
	opEor(): void {
		this.A ^= this.#dr;
		this.#setNZ(this.A);
	}

	/** `ro-bit`: Z from A&DR; N, V from DR bits 7, 6. @internal */
	opBit(): void {
		this.zFlag = (this.A & this.#dr) === 0;
		this.nFlag = (this.#dr & 0x80) !== 0;
		this.vFlag = (this.#dr & 0x40) !== 0;
	}

	/** `ro-adc`: A += DR + C, binary or BCD per the D flag (NMOS). @internal */
	opAdc(): void {
		const a = this.A;
		const b = this.#dr;
		const carry = this.cFlag ? 1 : 0;
		if (this.dFlag && !this.#withoutDecimal) {
			let lo = (a & 0x0f) + (b & 0x0f) + carry;
			if (lo > 0x09) lo += 0x06;
			let hi = (a >> 4) + (b >> 4) + (lo > 0x0f ? 1 : 0);
			this.zFlag = ((a + b + carry) & 0xff) === 0;
			this.nFlag = (hi & 0x08) !== 0;
			this.vFlag = (~(a ^ b) & (a ^ (hi << 4)) & 0x80) !== 0;
			if (hi > 0x09) hi += 0x06;
			this.cFlag = hi > 0x0f;
			this.A = ((hi << 4) | (lo & 0x0f)) & 0xff;
		} else {
			const sum = a + b + carry;
			this.cFlag = sum > 0xff;
			this.A = sum & 0xff;
			this.vFlag = (~(a ^ b) & (a ^ this.A) & 0x80) !== 0;
			this.#setNZ(this.A);
		}
	}

	/** `ro-sbc`: A -= DR + !C, binary or BCD per the D flag (NMOS). @internal */
	opSbc(): void {
		const a = this.A;
		const b = this.#dr;
		const carry = this.cFlag ? 1 : 0;
		// All flags come from the binary subtraction, even in decimal mode.
		const bin = a + (b ^ 0xff) + carry;
		this.cFlag = bin > 0xff;
		this.vFlag = ((a ^ b) & (a ^ (bin & 0xff)) & 0x80) !== 0;
		this.#setNZ(bin & 0xff);
		if (this.dFlag && !this.#withoutDecimal) {
			let lo = (a & 0x0f) - (b & 0x0f) + carry - 1;
			if (lo < 0) lo = ((lo - 0x06) & 0x0f) - 0x10;
			let res = (a & 0xf0) - (b & 0xf0) + lo;
			if (res < 0) res -= 0x60;
			this.A = res & 0xff;
		} else {
			this.A = bin & 0xff;
		}
	}

	/** `ro-cmp`: compare A with DR. @internal */
	opCmp(): void {
		this.#compare(this.A);
	}

	/** `ro-cpx`: compare X with DR. @internal */
	opCpx(): void {
		this.#compare(this.X);
	}

	/** `ro-cpy`: compare Y with DR. @internal */
	opCpy(): void {
		this.#compare(this.Y);
	}

	/** `ro-anc` (ANC): AND imm into A; carry copies bit 7. @internal */
	opAnc(): void {
		this.A &= this.#dr;
		this.#setNZ(this.A);
		this.cFlag = (this.A & 0x80) !== 0;
	}

	/** `ro-asr` (ASR/ALR): AND imm into A, then LSR A. @internal */
	opAsr(): void {
		this.A &= this.#dr;
		this.cFlag = (this.A & 0x01) !== 0;
		this.A = this.A >> 1;
		this.#setNZ(this.A);
	}

	/** `ro-arr` (ARR): AND imm, then ROR A, with adder-derived V/C (BCD-aware). @internal */
	opArr(): void {
		const t = this.A & this.#dr;
		const carryIn = this.cFlag;
		let result = (t >> 1) | (carryIn ? 0x80 : 0);
		if (this.dFlag && !this.#withoutDecimal) {
			this.nFlag = carryIn;
			this.zFlag = result === 0;
			this.vFlag = ((t ^ result) & 0x40) !== 0;
			if ((t & 0x0f) + (t & 0x01) > 5) {
				result = (result & 0xf0) | ((result + 0x06) & 0x0f);
			}
			if ((t & 0xf0) + (t & 0x10) > 0x50) {
				result = (result + 0x60) & 0xff;
				this.cFlag = true;
			} else {
				this.cFlag = false;
			}
			this.A = result;
		} else {
			this.A = result;
			this.#setNZ(result);
			this.cFlag = (result & 0x40) !== 0;
			this.vFlag = (((result >> 6) ^ (result >> 5)) & 0x01) !== 0;
		}
	}

	/** `ro-sbx` (SBX/AXS): X ← (A & X) − imm; carry set on no borrow. @internal */
	opSbx(): void {
		const diff = (this.A & this.X) - this.#dr;
		this.cFlag = diff >= 0;
		this.X = diff & 0xff;
		this.#setNZ(this.X);
	}

	/** `ro-ane` (ANE/XAA): A ← (A | magic) & X & imm — unstable. @internal */
	opAne(): void {
		this.A = (this.A | ANE_MAGIC) & this.X & this.#dr;
		this.#setNZ(this.A);
	}

	/** `ro-lxa` (LXA/LAX imm): A = X ← (A | magic) & imm — unstable. @internal */
	opLxa(): void {
		const value = (this.A | ANE_MAGIC) & this.#dr;
		this.A = value;
		this.X = value;
		this.#setNZ(value);
	}

	/** `ro-las` (LAS/LAR): A = X = S ← memory & S. @internal */
	opLas(): void {
		const value = this.#dr & this.S;
		this.A = value;
		this.X = value;
		this.S = value;
		this.#setNZ(value);
	}

	// Accumulator shifts/rotates -----------------------------------------------

	/** `asla`: shift A left, C from bit 7. @internal */
	opAslA(): void {
		this.cFlag = (this.A & 0x80) !== 0;
		this.A = (this.A << 1) & 0xff;
		this.#setNZ(this.A);
	}

	/** `lsra`: shift A right, C from bit 0. @internal */
	opLsrA(): void {
		this.cFlag = (this.A & 0x01) !== 0;
		this.A = this.A >> 1;
		this.#setNZ(this.A);
	}

	/** `rola`: rotate A left through C. @internal */
	opRolA(): void {
		const carry = this.cFlag ? 1 : 0;
		this.cFlag = (this.A & 0x80) !== 0;
		this.A = ((this.A << 1) | carry) & 0xff;
		this.#setNZ(this.A);
	}

	/** `rora`: rotate A right through C. @internal */
	opRorA(): void {
		const carry = this.cFlag ? 0x80 : 0;
		this.cFlag = (this.A & 0x01) !== 0;
		this.A = (this.A >> 1) | carry;
		this.#setNZ(this.A);
	}

	// Read-modify-write ops (operate on DR) ------------------------------------

	/** `mo-asl`: shift DR left, C from bit 7. @internal */
	opAsl(): void {
		this.cFlag = (this.#dr & 0x80) !== 0;
		this.#dr = (this.#dr << 1) & 0xff;
		this.#setNZ(this.#dr);
	}

	/** `mo-lsr`: shift DR right, C from bit 0. @internal */
	opLsr(): void {
		this.cFlag = (this.#dr & 0x01) !== 0;
		this.#dr = this.#dr >> 1;
		this.#setNZ(this.#dr);
	}

	/** `mo-rol`: rotate DR left through C. @internal */
	opRol(): void {
		const carry = this.cFlag ? 1 : 0;
		this.cFlag = (this.#dr & 0x80) !== 0;
		this.#dr = ((this.#dr << 1) | carry) & 0xff;
		this.#setNZ(this.#dr);
	}

	/** `mo-ror`: rotate DR right through C. @internal */
	opRor(): void {
		const carry = this.cFlag ? 0x80 : 0;
		this.cFlag = (this.#dr & 0x01) !== 0;
		this.#dr = (this.#dr >> 1) | carry;
		this.#setNZ(this.#dr);
	}

	/** `mo-inc`: DR += 1. @internal */
	opInc(): void {
		this.#dr = (this.#dr + 1) & 0xff;
		this.#setNZ(this.#dr);
	}

	/** `mo-dec`: DR -= 1. @internal */
	opDec(): void {
		this.#dr = (this.#dr - 1) & 0xff;
		this.#setNZ(this.#dr);
	}

	/** `mo-slo` (SLO): ASL the memory value, then ORA it into A. @internal */
	opSlo(): void {
		this.cFlag = (this.#dr & 0x80) !== 0;
		this.#dr = (this.#dr << 1) & 0xff;
		this.A |= this.#dr;
		this.#setNZ(this.A);
	}

	/** `mo-rla` (RLA): ROL the memory value, then AND it into A. @internal */
	opRla(): void {
		const carry = this.cFlag ? 1 : 0;
		this.cFlag = (this.#dr & 0x80) !== 0;
		this.#dr = ((this.#dr << 1) | carry) & 0xff;
		this.A &= this.#dr;
		this.#setNZ(this.A);
	}

	/** `mo-sre` (SRE): LSR the memory value, then EOR it into A. @internal */
	opSre(): void {
		this.cFlag = (this.#dr & 0x01) !== 0;
		this.#dr = this.#dr >> 1;
		this.A ^= this.#dr;
		this.#setNZ(this.A);
	}

	/** `mo-rra` (RRA): ROR the memory value, then ADC it into A. @internal */
	opRra(): void {
		const carryIn = this.cFlag ? 0x80 : 0;
		this.cFlag = (this.#dr & 0x01) !== 0;
		this.#dr = (this.#dr >> 1) | carryIn;
		this.opAdc();
	}

	/** `mo-dcp` (DCP): DEC the memory value, then CMP it against A. @internal */
	opDcp(): void {
		this.#dr = (this.#dr - 1) & 0xff;
		this.#compare(this.A);
	}

	/** `mo-isb` (ISB/ISC): INC the memory value, then SBC it from A. @internal */
	opIsb(): void {
		this.#dr = (this.#dr + 1) & 0xff;
		this.opSbc();
	}

	// Register transfers and inc/dec -------------------------------------------

	/** `x=a` (TAX). @internal */
	opXFromA(): void {
		this.X = this.A;
		this.#setNZ(this.X);
	}

	/** `y=a` (TAY). @internal */
	opYFromA(): void {
		this.Y = this.A;
		this.#setNZ(this.Y);
	}

	/** `a=x` (TXA). @internal */
	opAFromX(): void {
		this.A = this.X;
		this.#setNZ(this.A);
	}

	/** `a=y` (TYA). @internal */
	opAFromY(): void {
		this.A = this.Y;
		this.#setNZ(this.A);
	}

	/** `x=s` (TSX). @internal */
	opXFromS(): void {
		this.X = this.S;
		this.#setNZ(this.X);
	}

	/** `s=x` (TXS) — does not affect flags. @internal */
	opSFromX(): void {
		this.S = this.X;
	}

	/** `x++` (INX). @internal */
	opIncX(): void {
		this.X = (this.X + 1) & 0xff;
		this.#setNZ(this.X);
	}

	/** `x--` (DEX). @internal */
	opDecX(): void {
		this.X = (this.X - 1) & 0xff;
		this.#setNZ(this.X);
	}

	/** `y++` (INY). @internal */
	opIncY(): void {
		this.Y = (this.Y + 1) & 0xff;
		this.#setNZ(this.Y);
	}

	/** `y--` (DEY). @internal */
	opDecY(): void {
		this.Y = (this.Y - 1) & 0xff;
		this.#setNZ(this.Y);
	}

	// Flag ops -----------------------------------------------------------------

	/** `cf=0` (CLC). @internal */
	opClearCarry(): void {
		this.cFlag = false;
	}

	/** `cf=1` (SEC). @internal */
	opSetCarry(): void {
		this.cFlag = true;
	}

	/** `if=0` (CLI). @internal */
	opClearInterrupt(): void {
		this.iFlag = false;
	}

	/** `if=1` (SEI). @internal */
	opSetInterrupt(): void {
		this.iFlag = true;
	}

	/**
	 * `poll`: latch the interrupt-detect signal into `#interruptPending` for the
	 * next decode to act on. The generator places it on every cycle that can end
	 * an instruction (except BRK and a taken branch's PCL-add cycle), right after
	 * the bus op so it runs before any I-flag change in the same cycle. It reads
	 * `#interruptDetected`, which is recomputed at the end of the *previous* cycle,
	 * giving the two-cycles-before-decode timing (and the CLI/SEI/PLP delays). It
	 * overwrites rather than accumulates, so a later poll in the same instruction
	 * (e.g. a branch's fix-up cycle) wins. @internal
	 */
	opPoll(): void {
		this.#interruptPending = this.#interruptDetected;
	}

	/** `of=0` (CLV). @internal */
	opClearOverflow(): void {
		this.vFlag = false;
	}

	/** `df=0` (CLD). @internal */
	opClearDecimal(): void {
		this.dFlag = false;
	}

	/** `df=1` (SED). @internal */
	opSetDecimal(): void {
		this.dFlag = true;
	}

	/** `nop`: do nothing. @internal */
	opNop(): void {}

	// Stack and program-counter plumbing ---------------------------------------

	/** `ar=sp`: address latch = the stack pointer ($0100 + S). @internal */
	opAddrFromSp(): void {
		this.#al = this.S;
		this.#ah = 0x01;
	}

	/** `dr=p` / `dr=pi`: DR = status byte (B = bFlag, per getP). @internal */
	opDrFromP(): void {
		this.#dr = this.getP();
	}

	/** `dr=pch`: DR = high byte of PC. @internal */
	opDrFromPch(): void {
		this.#dr = (this.PC >> 8) & 0xff;
	}

	/** `dr=pcl`: DR = low byte of PC. @internal */
	opDrFromPcl(): void {
		this.#dr = this.PC & 0xff;
	}

	/** `dr=al`: DR = address latch low (stash the zero-page pointer). @internal */
	opDrFromAl(): void {
		this.#dr = this.#al;
	}

	/** `pcl=dr`: low byte of PC = DR. @internal */
	opPclFromDr(): void {
		this.PC = (this.PC & 0xff00) | this.#dr;
	}

	/** `pch=dr`: high byte of PC = DR. @internal */
	opPchFromDr(): void {
		this.PC = (this.PC & 0x00ff) | (this.#dr << 8);
	}

	/** `pcl=al`: low byte of PC = address latch low. @internal */
	opPclFromAl(): void {
		this.PC = (this.PC & 0xff00) | this.#al;
	}

	/** `pcl=s`: low byte of PC = S (JSR's stashed address byte). @internal */
	opPclFromS(): void {
		this.PC = (this.PC & 0xff00) | this.S;
	}

	/** `s=dr`: S = DR (JSR stashes the low address byte here). @internal */
	opSFromDr(): void {
		this.S = this.#dr;
	}

	/** `s=al`: S = address latch low (commit the adjusted stack pointer). @internal */
	opSFromAl(): void {
		this.S = this.#al;
	}

	/** `p=dr`: status = DR (bits 4, 5 ignored). @internal */
	opPFromDr(): void {
		this.setP(this.#dr);
	}

	/**
	 * `ar=vector`: select the interrupt vector at the push-P cycle. If an NMI is
	 * latched it takes priority — address latch = `$FFFA` and the NMI is
	 * acknowledged (`#nmiPending` cleared) — so an NMI asserted early enough in a
	 * BRK/IRQ sequence hijacks it. Otherwise it's the IRQ/BRK vector `$FFFE`.
	 * @internal
	 */
	opAddrVector(): void {
		if (this.#nmiPending) {
			this.#nmiPending = false;
			this.#al = 0xfa;
			this.#ah = 0xff;
		} else {
			this.#al = 0xfe;
			this.#ah = 0xff;
		}
	}

	/**
	 * `nmi-hold`: the interrupt sequence's last cycle. Drop a still-pending NMI if
	 * its line has gone inactive. An NMI latched too late to hijack the vector (at
	 * the push-P cycle) is only serviced if it outlasts the sequence; a shorter
	 * pulse is lost here. It only clears — never sets — so an NMI already consumed
	 * by the vector selection (a hijack) is unaffected. @internal
	 */
	opNmiHold(): void {
		if (!this.NMI) this.#nmiPending = false;
	}

	/** `ar=ffff`: address latch = $FFFF. @internal */
	opAddrFFFF(): void {
		this.#al = 0xff;
		this.#ah = 0xff;
	}

	/** `ar=fffe`: address latch = $FFFE. @internal */
	opAddrFFFE(): void {
		this.#al = 0xfe;
		this.#ah = 0xff;
	}

	/** `ar=fffc`: address latch = the reset vector ($FFFC). @internal */
	opAddrFFFC(): void {
		this.#al = 0xfc;
		this.#ah = 0xff;
	}

	/** `s--`: decrement the stack pointer (the reset sequence's fake pushes). @internal */
	opDecS(): void {
		this.S = (this.S - 1) & 0xff;
	}

	// TODO(fatih): CIM should set this on its first cycle so we know early.
	/** `cc--`: crash — flag it; the microcode repeats this cycle forever. @internal */
	opCrash(): void {
		this.crashed = true;
	}

	// Branches -----------------------------------------------------------------

	/**
	 * `pc+=dr?`: add the signed branch offset to PCL (8-bit), leaving PCH for the
	 * fix-up cycle. Returns whether a page boundary was crossed (so the caller
	 * takes that extra cycle, whose dummy read sees the un-fixed address). The
	 * offset comes from {@link opStashOffset}, since the fetch in this cycle has
	 * already overwritten DR.
	 * @internal
	 */
	opBranchOffset(): boolean {
		const offset = this.#offset < 0x80 ? this.#offset : this.#offset - 0x100;
		const lo = (this.PC & 0xff) + offset;
		this.PC = (this.PC & 0xff00) | (lo & 0xff);
		this.#branchFixup = lo < 0 ? -1 : lo > 0xff ? 1 : 0;
		return this.#branchFixup !== 0;
	}

	/** `pch=fix`: apply the pending PCH adjustment after a branch page cross. @internal */
	opFixPch(): void {
		this.PC = (this.PC + (this.#branchFixup << 8)) & 0xffff;
	}

	/** Stash DR as the branch offset before the next cycle's fetch overwrites it. */
	#stashOffset(): void {
		this.#offset = this.#dr;
	}

	/** `cc?` (BCC): branch taken if carry clear. @internal */
	opCondCc(): boolean {
		this.#stashOffset();
		return !this.cFlag;
	}

	/** `cs?` (BCS): branch taken if carry set. @internal */
	opCondCs(): boolean {
		this.#stashOffset();
		return this.cFlag;
	}

	/** `ne?` (BNE): branch taken if zero clear. @internal */
	opCondNe(): boolean {
		this.#stashOffset();
		return !this.zFlag;
	}

	/** `eq?` (BEQ): branch taken if zero set. @internal */
	opCondEq(): boolean {
		this.#stashOffset();
		return this.zFlag;
	}

	/** `pl?` (BPL): branch taken if negative clear. @internal */
	opCondPl(): boolean {
		this.#stashOffset();
		return !this.nFlag;
	}

	/** `mi?` (BMI): branch taken if negative set. @internal */
	opCondMi(): boolean {
		this.#stashOffset();
		return this.nFlag;
	}

	/** `vc?` (BVC): branch taken if overflow clear. @internal */
	opCondVc(): boolean {
		this.#stashOffset();
		return !this.vFlag;
	}

	/** `vs?` (BVS): branch taken if overflow set. @internal */
	opCondVs(): boolean {
		this.#stashOffset();
		return this.vFlag;
	}

	/** Compare a register with DR, setting C, Z, N. */
	#compare(register: number): void {
		const diff = register - this.#dr;
		this.cFlag = diff >= 0;
		this.#setNZ(diff & 0xff);
	}

	/** Set the N and Z flags from a byte result. */
	#setNZ(value: number): void {
		this.zFlag = value === 0;
		this.nFlag = (value & 0x80) !== 0;
	}

	/** The effective address latch, AR = (AH:AL). */
	get #addr(): number {
		return (this.#ah << 8) | this.#al;
	}
}

/** Crash: flag it and repeat this cycle forever (the state is left as-is). */
function crashStep(cpu: Sfotty): void {
	cpu.crashed = true;
}

function inc16(n: number): number {
	return (n + 1) & 0xffff;
}

// TODO(fatih): We should just copy CIM behavior.

/**
 * The default microcode table, with every undocumented opcode patched to crash
 * at its first cycle. `decode` still sets `state = opcode << 3`, so the crashed
 * opcode is preserved in `state` (and reported by `describeState`); only the
 * step it lands on changes. Built once by copying the base table and patching.
 */
const MICROCODE_CRASH_UNDOCUMENTED: Step[] = MICROCODE.slice();
for (let opcode = 0; opcode < 0x100; opcode++) {
	if (NMOS_INSTRUCTIONS[opcode]!.undocumented) {
		MICROCODE_CRASH_UNDOCUMENTED[opcode << 3] = crashStep;
	}
}
