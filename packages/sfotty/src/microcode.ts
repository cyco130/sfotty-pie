import type { Opcode } from "./nmos-opcodes.ts";
import type { Sfotty } from "./sfotty.ts";

/**
 * A microstate is a single CPU cycle, encoded as `(opcode << 3) | cycle`, where
 * `cycle` is the 0-based index into the instruction's `code[]` array (the
 * longest instruction has 7 entries, so 3 bits suffice). The shared opcode
 * decode lives in its own reserved slot, {@link DECODE}, above every real state.
 */
export const DECODE = 0x800;

/**
 * First microstate of the reset sequence. `reset()` sets `state` here to launch
 * a dedicated seven-cycle sequence occupying {@link RESET}..`RESET + 6`, also
 * reserved above every real opcode state (and above {@link DECODE}). It is
 * separate from BRK so it can do its stack accesses as reads and vector from
 * `$FFFC` without runtime conditionals.
 */
export const RESET = 0x801;

/**
 * One CPU cycle. It performs the cycle's single bus access (which may throw to
 * interrupt the CPU), applies the internal register transfers, and writes the
 * next microstate last — so a throw unwinds with the CPU untouched and the cycle
 * is retried on the next `run()`. Lives in the {@link Sfotty}-indexed dispatch
 * table emitted by `generate-step.ts`.
 */
export type Step = (cpu: Sfotty) => void;

export type BusOp =
	| "r-t1" // IR = fetch(PC++); // First cycle of every instruction
	| "r-t1i" // IR = (fetch(PC), 0); // First cycle of interrupt handling
	| "r-pc++" // DR = read(PC++); // Second cycle of multi-byte instructions
	| "r-pc" // DR = read(PC++); // Second cycle of single-byte instructions
	| "r-brk" // DR = read(PC); advance PC only on a software BRK, not a hardware interrupt
	| "r-ar" // DR = read(AR); // Generic memory read
	| "r-ar++" // DR = read(AR++); // Generic memory read (no carry)
	| "r-dr++" // AL = read(DR++); // For indexing
	| "r-dr" // AH = read(DR); // For indexing
	| "w-ar" // write(AR, DR); // Generic memory write
	| "w-ar--"; // write(AR--, DR); // Generic memory write (no borrow)

export type InternalOp =
	| "decode"
	| "nop"
	| "cc--"
	| "?" // If page boundary was crossed, do the next micro-op and go to the next cycle, otherwise do the micro-op after next and skip the next cycle
	| "ar=fffe"
	| "ar=ffff"
	| "ar=vector"
	| "nmi-hold" // At the end of an interrupt sequence, drop a pending NMI if its line has gone inactive
	| "ar=sp"
	| "ar=dr"
	| "ar+=x"
	| "ar+=x?" // Set the internal page boundary crossed flag
	| "ar+=y"
	| "ar+=y?" // Set the internal page boundary crossed flag
	| "ah=dr"
	| "ah++"
	| "?ah++" // Only increment if page boundary was crossed
	| "dr=a"
	| "dr=x"
	| "dr=y"
	| "dr=pcl"
	| "dr=pch"
	| "dr=pi"
	| "dr=p"
	| "dr=al"
	| "a=dr"
	| "x=dr"
	| "y=dr"
	| "s=dr"
	| "s=al"
	| "pc+=dr?" // Add signed DR to PC, and, if a page boundary wasn't crossed, skip the next cycle
	| "pch=dr"
	| "pcl=dr"
	| "pcl=al"
	| "pcl=s"
	| "pch=fix" // Apply the deferred PCH adjustment after a branch page cross
	| "p=dr"

	// Read instructions
	| "ro-ora"
	| "ro-and"
	| "ro-eor"
	| "ro-bit"
	| "ro-adc"
	| "ro-sbc"
	| "ro-cmp"
	| "ro-cpx"
	| "ro-cpy"
	| "ro-anc"
	| "ro-asr"
	| "ro-arr"
	| "ro-ane"
	| "ro-lax"
	| "ro-lxa"
	| "ro-las"
	| "ro-sbx"

	// Conditional
	| "cc?"
	| "cs?"
	| "ne?"
	| "eq?"
	| "pl?"
	| "mi?"
	| "vc?"
	| "vs?"

	// Accumulator
	| "asla"
	| "lsra"
	| "rola"
	| "rora"

	// Read-modify-write instructions
	| "mo-dec"
	| "mo-inc"
	| "mo-asl"
	| "mo-lsr"
	| "mo-rol"
	| "mo-ror"
	| "mo-slo"
	| "mo-rla"
	| "mo-sre"
	| "mo-rra"
	| "mo-dcp"
	| "mo-isb"

	// Store instructions
	| "sta"
	| "stx"
	| "sty"
	| "sax"
	| "sha"
	| "shx"
	| "shy"
	| "shs"

	// Simple instructions
	| "cf=0"
	| "cf=1"
	| "if=0"
	| "if=1"
	| "of=0"
	| "df=0"
	| "df=1"
	| "x=a"
	| "y=a"
	| "a=y"
	| "a=x"
	| "s=x"
	| "x=s"
	| "x++"
	| "x--"
	| "y++"
	| "y--";

/**
 * A fully decoded instruction: opcode metadata plus its cycle-by-cycle
 * microcode. Each cycle is one bus operation followed by the internal
 * register transfers that happen during it.
 */
export interface Instruction extends Opcode {
	code: [BusOp, ...InternalOp[]][];
}
