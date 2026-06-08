import { OPCODES, type Mode } from "./opcodes.ts";
import {
	getOperandLocation,
	type Instruction,
	type Operand,
} from "./parser.ts";
import type { Value } from "./value.ts";

export interface EncodeContext {
	/** Address of this instruction's first byte, for relative branch offsets. */
	location: bigint | undefined;
	report(message: string, span: readonly [number, number]): void;
}

const OPERAND_BYTES: Record<Mode, number> = {
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

const MODE_NAMES: Record<Mode, string> = {
	imp: "implied",
	acc: "accumulator",
	imm: "immediate",
	zpg: "zero page",
	zpx: "zero page,X",
	zpy: "zero page,Y",
	inx: "(indirect,X)",
	iny: "(indirect),Y",
	rel: "relative",
	abs: "absolute",
	abx: "absolute,X",
	aby: "absolute,Y",
	ind: "indirect",
};

type Modes = Partial<Record<Mode, number>>;

/**
 * Encode one instruction to its bytes. `operandValue` is the pre-evaluated
 * operand expression (undefined when there's no operand, or it's unresolved
 * this pass). An unresolved operand yields zero placeholders of the correct
 * (pessimistic) length so the size is stable across passes; hard errors are
 * reported and yield `[]` or best-effort bytes.
 */
export function encodeInstruction(
	instruction: Instruction,
	operandValue: Value | undefined,
	context: EncodeContext,
): number[] {
	const { mnemonic, operand } = instruction;
	const name = mnemonic.text.toUpperCase();
	const modes = OPCODES[name];
	const nameSpan: readonly [number, number] = [mnemonic.start, mnemonic.end];

	if (!modes) {
		context.report(`Unknown mnemonic "${mnemonic.text}"`, nameSpan);
		return [];
	}

	const mode = resolveMode(operand, operandValue, modes);
	const opcode = modes[mode];
	if (opcode === undefined) {
		context.report(
			`${name} has no ${MODE_NAMES[mode]} addressing mode`,
			nameSpan,
		);
		return [];
	}

	const span = operand ? getOperandLocation(operand) : nameSpan;
	return [opcode, ...encodeOperand(mode, operandValue, span, context)];
}

function resolveMode(
	operand: Operand | null,
	value: Value | undefined,
	modes: Modes,
): Mode {
	if (operand === null) {
		// A bare shift (ASL/LSR/ROL/ROR) with no operand means accumulator.
		if (modes.imp !== undefined) return "imp";
		if (modes.acc !== undefined) return "acc";
		return "imp"; // no implied form — reported by the caller
	}

	switch (operand.type) {
		case "accumulator-operand":
			return "acc";
		case "immediate-operand":
			return "imm";
		case "indirect-operand":
			return "ind";
		case "indexed-indirect-operand":
			return "inx";
		case "indirect-indexed-operand":
			return "iny";
		case "simple-operand":
			if (modes.rel !== undefined) return "rel"; // a branch
			return sized(value, "zpg", "abs", modes);
		case "indexed-operand":
			return operand.register.text.toLowerCase() === "x"
				? sized(value, "zpx", "abx", modes)
				: sized(value, "zpy", "aby", modes);
	}
}

/** Pick the zero-page mode if the value provably fits it, else absolute. */
function sized(
	value: Value | undefined,
	zp: Mode,
	abs: Mode,
	modes: Modes,
): Mode {
	if (
		typeof value === "bigint" &&
		value >= 0n &&
		value <= 0xffn &&
		modes[zp] !== undefined
	) {
		return zp;
	}
	return abs;
}

function encodeOperand(
	mode: Mode,
	value: Value | undefined,
	span: readonly [number, number],
	context: EncodeContext,
): number[] {
	const size = OPERAND_BYTES[mode];
	if (size === 0) return [];

	if (value === undefined) return new Array<number>(size).fill(0); // unresolved
	if (typeof value === "string") {
		context.report("Operand must be a number, not a string", span);
		return new Array<number>(size).fill(0);
	}

	if (mode === "rel") return [branchByte(value, span, context)];
	if (size === 1) return [byte(value, span, context)];
	const w = word(value, span, context);
	return [w & 0xff, (w >> 8) & 0xff];
}

function byte(
	value: bigint,
	span: readonly [number, number],
	context: EncodeContext,
): number {
	if (value < -128n || value > 255n) {
		context.report(`Byte value out of range: ${value}`, span);
	}
	return Number(value & 0xffn);
}

function word(
	value: bigint,
	span: readonly [number, number],
	context: EncodeContext,
): number {
	if (value < -32768n || value > 65535n) {
		context.report(`Word value out of range: ${value}`, span);
	}
	return Number(value & 0xffffn);
}

function branchByte(
	target: bigint,
	span: readonly [number, number],
	context: EncodeContext,
): number {
	if (context.location === undefined) return 0; // offset not computable yet
	const offset = target - (context.location + 2n);
	if (offset < -128n || offset > 127n) {
		context.report(`Branch target out of range (${offset} bytes)`, span);
		return 0;
	}
	return Number(offset & 0xffn);
}
