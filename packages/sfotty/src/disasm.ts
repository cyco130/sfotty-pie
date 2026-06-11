import { NMOS_INSTRUCTIONS } from "./nmos-instructions.generated.ts";
import type { Sfotty } from "./sfotty.ts";

/** A side-effect-free byte reader (read with {@link ReadOptions.PEEK}). */
export type PeekReader = (address: number) => number;

interface Entry {
	mnemonic: string;
	mode: string;
}

// Opcode → mnemonic/mode, indexed by opcode for O(1) lookup.
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

export interface Disassembly {
	/** Rendered instruction, e.g. `LDA $0411,X`. */
	text: string;
	/** Number of bytes the instruction occupies (1–3). */
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
 * One register-annotated trace line for the instruction at the CPU's PC, e.g.
 * `E477  A2 FF     LDX #$FF      A=00 X=00 Y=00 S=FF P=34 nv-bdIzc`.
 *
 * Call it when the CPU is at an instruction boundary (`cpu.state === DECODE`).
 * `read` must be side-effect-free (peek), since it reads the instruction bytes.
 */
export function traceLine(cpu: Sfotty, read: PeekReader): string {
	const { text, bytes } = disassemble(read, cpu.PC);
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

	return (
		`${hex(cpu.PC, 4)}  ${byteText} ${text.padEnd(13)} ` +
		`A=${hex(cpu.A, 2)} X=${hex(cpu.X, 2)} Y=${hex(cpu.Y, 2)} ` +
		`S=${hex(cpu.S, 2)} P=${hex(p, 2)} ${flags}`
	);
}
