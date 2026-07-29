import { NMOS_INSTRUCTIONS } from "./nmos-instructions.generated.ts";
import type { Sfotty } from "./sfotty.ts";

/** A side-effect-free byte reader (read with {@link ReadOptions.PEEK}). */
export type PeekReader = (address: number) => number;

export interface Disassembly {
	/** Rendered instruction, e.g. `LDA $0411,X`. */
	text: string;
	/** Number of bytes the instruction occupies (1-3). */
	length: number;
	/** The instruction's raw bytes (opcode followed by operands). */
	bytes: number[];
}

/** Disassemble a single instruction at `pc`, reading bytes via `read`. */
export function disassemble(read: PeekReader, pc: number): Disassembly {
	const opcode = read(pc & 0xffff);
	const entry = TABLE[opcode];
	const mnemonic = entry?.mnemonic ?? "???";
	const mode = entry?.mode ?? "imp";
	const n = OPERAND_BYTES[mode] ?? 0;

	const b1 = n >= 1 ? read((pc + 1) & 0xffff) : 0;
	const b2 = n >= 2 ? read((pc + 2) & 0xffff) : 0;
	const word = (b2 << 8) | b1;

	const bytes = [opcode];
	if (n >= 1) bytes.push(b1);
	if (n >= 2) bytes.push(b2);

	let operand: string;
	switch (mode) {
		case "acc":
			operand = "A";
			break;
		case "imm":
			operand = `#$${hex(b1, 2)}`;
			break;
		case "zpg":
			operand = `$${hex(b1, 2)}`;
			break;
		case "zpx":
			operand = `$${hex(b1, 2)},X`;
			break;
		case "zpy":
			operand = `$${hex(b1, 2)},Y`;
			break;
		case "inx":
			operand = `($${hex(b1, 2)},X)`;
			break;
		case "iny":
			operand = `($${hex(b1, 2)}),Y`;
			break;
		case "rel":
			// Branch target: PC after the instruction plus the signed offset.
			operand = `$${hex((pc + 2 + ((b1 << 24) >> 24)) & 0xffff, 4)}`;
			break;
		case "abs":
			operand = `$${hex(word, 4)}`;
			break;
		case "abx":
			operand = `$${hex(word, 4)},X`;
			break;
		case "aby":
			operand = `$${hex(word, 4)},Y`;
			break;
		case "ind":
			operand = `($${hex(word, 4)})`;
			break;
		default: // imp
			operand = "";
			break;
	}

	return {
		text: operand ? `${mnemonic} ${operand}` : mnemonic,
		length: 1 + n,
		bytes,
	};
}

/**
 * The memory addresses an instruction's operand resolves through, with the
 * bytes there - computed from the current registers, so it shows what the
 * CPU is about to read. Indirect modes show the pointer fetch first
 * (`$80=$1234; $1239=$56` for `($80),Y` with Y=5), direct and indexed modes
 * the effective address and its byte. Pointer fetches wrap the way the NMOS
 * does: zero-page pointers stay in page zero, and `JMP ($xxFF)` reads its
 * high byte from the start of the same page. For stores the byte shown is
 * what the location held *before* the write. Empty for immediate, implied,
 * accumulator, and relative modes.
 */
export function operandTrail(
	cpu: Sfotty,
	read: PeekReader,
	mode: string,
	b1: number,
	word: number,
): string {
	const at = (address: number, width: number): string =>
		`$${hex(address, width)}=$${hex(read(address & 0xffff), 2)}`;
	// A zero-page pointer: both bytes from page zero, wrapping at $FF.
	const zpWord = (zp: number): number =>
		read(zp & 0xff) | (read((zp + 1) & 0xff) << 8);

	switch (mode) {
		case "zpg":
			return at(b1, 2);
		case "zpx":
			return at((b1 + cpu.X) & 0xff, 2);
		case "zpy":
			return at((b1 + cpu.Y) & 0xff, 2);
		case "abs":
			return at(word, 4);
		case "abx":
			return at((word + cpu.X) & 0xffff, 4);
		case "aby":
			return at((word + cpu.Y) & 0xffff, 4);
		case "inx": {
			const pointer = (b1 + cpu.X) & 0xff;
			const target = zpWord(pointer);
			return `$${hex(pointer, 2)}=$${hex(target, 4)}; ${at(target, 4)}`;
		}
		case "iny": {
			const target = zpWord(b1);
			return (
				`$${hex(b1, 2)}=$${hex(target, 4)}; ` + at((target + cpu.Y) & 0xffff, 4)
			);
		}
		case "ind": {
			// The NMOS page-wrap bug: the high byte comes from the start of
			// the pointer's page when the pointer sits at $xxFF.
			const target =
				read(word) | (read((word & 0xff00) | ((word + 1) & 0xff)) << 8);
			return `$${hex(word, 4)}=$${hex(target, 4)}`;
		}
		default:
			return ""; // imm, imp, acc, rel
	}
}

/**
 * One register-annotated trace line for the instruction at `pc`, e.g.
 * `E477  B1 80     LDA ($80),Y   A=00 X=00 Y=05 S=FF P=34 nv-bdIzc  [$80=$1234; $1239=$56]`.
 *
 * The bracketed tail is the operand's memory trail (see {@link operandTrail});
 * registers and trail both reflect the state *before* the instruction runs.
 *
 * `pc` defaults to the CPU's PC - correct when called at an instruction
 * boundary (`cpu.state === DECODE`). Pass it explicitly from `onFetch`, which
 * fires just after PC has advanced past the opcode: hand it the opcode address.
 * `read` must be side-effect-free (peek), since it reads the instruction bytes.
 */
export function traceLine(cpu: Sfotty, read: PeekReader, pc = cpu.PC): string {
	const { text, bytes } = disassemble(read, pc);
	const byteText = bytes
		.map((b) => hex(b, 2))
		.join(" ")
		.padEnd(8);

	const p = cpu.getP();
	const flags =
		(p & 0x80 ? "N" : "n") +
		(p & 0x40 ? "V" : "v") +
		"-" +
		(p & 0x10 ? "B" : "b") +
		(p & 0x08 ? "D" : "d") +
		(p & 0x04 ? "I" : "i") +
		(p & 0x02 ? "Z" : "z") +
		(p & 0x01 ? "C" : "c");

	const opcode = bytes[0]!;
	const mode = TABLE[opcode]?.mode ?? "imp";
	const b1 = bytes[1] ?? 0;
	const word = ((bytes[2] ?? 0) << 8) | b1;
	const trail = operandTrail(cpu, read, mode, b1, word);

	return (
		`${hex(pc, 4)}  ${byteText} ${text.padEnd(13)} ` +
		`A=${hex(cpu.A, 2)} X=${hex(cpu.X, 2)} Y=${hex(cpu.Y, 2)} ` +
		`S=${hex(cpu.S, 2)} P=${hex(p, 2)} ${flags}` +
		(trail ? `  [${trail}]` : "")
	);
}

interface Entry {
	mnemonic: string;
	mode: string;
}

// Opcode -> mnemonic/mode, indexed by opcode for O(1) lookup.
const TABLE: Entry[] = [];
for (const inst of NMOS_INSTRUCTIONS) {
	TABLE[inst.opcode] = { mnemonic: inst.mnemonic, mode: inst.mode };
}

// Operand byte count per addressing mode.
const OPERAND_BYTES: Record<string, number> = {
	imp: 0,
	acc: 0,
	imm: 1,
	zpg: 1,
	zpx: 1,
	zpy: 1,
	inx: 1,
	iny: 1,
	rel: 1,
	abs: 2,
	abx: 2,
	aby: 2,
	ind: 2,
};

function hex(value: number, width: number): string {
	return value.toString(16).toUpperCase().padStart(width, "0");
}
