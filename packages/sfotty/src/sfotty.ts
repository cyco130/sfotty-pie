import { ReadOptions, type Memory } from "./interface.ts";
import { DECODE, type Step } from "./microcode.ts";
import { MICROCODE } from "./nmos-step.ts";
import { NMOS_INSTRUCTIONS } from "./nmos.ts";

function inc16(n: number): number {
	return (n + 1) & 0xffff;
}

/** Variant flags that change the instruction set/behavior. */
export interface SfottyOptions {
	/** Decimal mode is inert: the D flag exists but ADC/SBC stay binary (Ricoh 2A03). */
	withoutDecimal?: boolean;
	/** Undocumented opcodes crash the CPU like CIM/JAM instead of executing. */
	withoutUndocumented?: boolean;
}

/** opcode → whether it is undocumented, indexed by opcode value. */
const UNDOCUMENTED: boolean[] = NMOS_INSTRUCTIONS.map(
	(instruction) => instruction.undocumented === true,
);

/**
 * The unstable "magic constant" ORed into A by ANE/LXA (`A = (A | C) & X & imm`).
 * It is chip- and temperature-dependent on real hardware, so no value is
 * universally correct. We use $EE: it matches Harte's `8b` vectors exactly
 * (10000/10000) and is the value reported for the Atari 400/800. Measured
 * Harte failures for other choices: $FF → 2379, $00 → 5462. Note the Atari
 * XL/XE (SALLY) is reported as $00 (Hias), so this differs there. See
 * notes.local/unstable-opcodes.md.
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
	 * When true, the next run() should run the reset sequence instead of a
	 * normal decode. Not yet honored by run() — the test harness clears it and
	 * seeds the registers directly. TODO: implement the reset sequence.
	 */
	resetPending = true;

	/**
	 * Set when the CPU jams on a CIM/JAM (or, with `withoutUndocumented`, on any
	 * undocumented opcode). It then repeats that cycle forever until reset.
	 */
	crashed = false;

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

	/** Pack the status flags into a byte. Bits 4 (B) and 5 (unused) read as 1. */
	getP(): number {
		return (
			(this.nFlag ? 0x80 : 0) |
			(this.vFlag ? 0x40 : 0) |
			0x30 |
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
	}

	/**
	 * The decode cycle (the implicit `r-t1`): read the next opcode while
	 * asserting the SYNC line, advance PC, and jump to the opcode's microcode.
	 * @internal
	 */
	decode(): void {
		const opcode = this.#bus.read(this.PC, ReadOptions.OPCODE_FETCH);
		this.PC = inc16(this.PC);
		this.state = opcode << 3;
	}

	/**
	 * Human-readable description of a microstate, for logging/debugging — e.g.
	 * `"LDA abs · cycle 3"` or `"decode"`. Cycles are numbered from 1 (decode).
	 */
	describeState(state: number = this.state): string {
		if (state === DECODE) return "decode";
		const instruction = NMOS_INSTRUCTIONS[state >> 3];
		const cycle = state & 7;
		if (!instruction || cycle >= instruction.code.length) {
			return `<invalid state ${state}>`;
		}
		return `${instruction.mnemonic} ${instruction.mode} · cycle ${cycle + 2}`;
	}

	// --- Micro-op implementations (called by the microcode table) -------------
	// One method per microcode token, all prefixed `op` so they stand apart from
	// the public CPU API. The generator maps each token to one of these (e.g.
	// "r-pc++" → opReadOperand). Bus ops perform the single read/write and bump
	// pointers *after* the access returns (so a trap leaves state intact);
	// internal ops are pure register transfers.

	/** `r-pc++`: read the operand byte at PC into DR, then advance PC. @internal */
	opReadOperand(): void {
		this.#dr = this.#bus.read(this.PC, ReadOptions.NONE);
		this.PC = inc16(this.PC);
	}

	/** `r-ar`: read from the effective address (AR) into DR. @internal */
	opReadAddr(): void {
		this.#dr = this.#bus.read(this.#addr, ReadOptions.NONE);
	}

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

	// Bus ops ------------------------------------------------------------------

	/** `r-pc`: read at PC into DR without advancing PC (dummy/operand read). @internal */
	opReadPc(): void {
		this.#dr = this.#bus.read(this.PC, ReadOptions.NONE);
	}

	/** `r-ar++`: read from AR into DR, then increment AR's low byte only (no carry). @internal */
	opReadAddrInc(): void {
		this.#dr = this.#bus.read(this.#addr, ReadOptions.NONE);
		this.#al = (this.#al + 1) & 0xff;
	}

	/** `r-dr++`: read from the zero-page pointer DR into AL, then advance DR (wraps). @internal */
	opReadPointerInc(): void {
		this.#al = this.#bus.read(this.#dr, ReadOptions.NONE);
		this.#dr = (this.#dr + 1) & 0xff;
	}

	/** `r-dr`: read from the zero-page pointer DR into AH. @internal */
	opReadPointer(): void {
		this.#ah = this.#bus.read(this.#dr, ReadOptions.NONE);
	}

	/** `w-ar`: write DR to the effective address. @internal */
	opWriteAddr(): void {
		this.#bus.write(this.#addr, this.#dr);
	}

	/** `w-ar--`: write DR to AR, then decrement AR's low byte only (no borrow). @internal */
	opWriteAddrDec(): void {
		this.#bus.write(this.#addr, this.#dr);
		this.#al = (this.#al - 1) & 0xff;
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

	/** `dr=p` / `dr=pi`: DR = status byte (B set). @internal */
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

	/** `ar=vector`: address latch = the IRQ/BRK vector ($FFFE). @internal */
	opAddrVector(): void {
		this.#al = 0xfe;
		this.#ah = 0xff;
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

	/** `cc--`: jam — flag the crash; the microcode repeats this cycle forever. @internal */
	opJam(): void {
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

/** Jam: flag the crash and repeat this cycle forever (the state is left as-is). */
function jamStep(cpu: Sfotty): void {
	cpu.crashed = true;
}

/**
 * The default microcode table, with every undocumented opcode patched to jam at
 * its first cycle. `decode` still sets `state = opcode << 3`, so the crashed
 * opcode is preserved in `state` (and reported by `describeState`); only the
 * step it lands on changes. Built once by copying the base table and patching.
 */
const MICROCODE_CRASH_UNDOCUMENTED: Step[] = MICROCODE.slice();
for (let opcode = 0; opcode < 0x100; opcode++) {
	if (UNDOCUMENTED[opcode]) MICROCODE_CRASH_UNDOCUMENTED[opcode << 3] = jamStep;
}
