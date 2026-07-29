import { Codes } from "./codes.ts";
import { OPCODES, type Mode } from "./opcodes.ts";
import {
	getExpressionLocation,
	getExpressionOrigin,
	getOperandLocation,
	type Expression,
	type Instruction,
	type Operand,
} from "./parser.ts";
import type { OperandShape, OperandValue, Value } from "./value.ts";

export interface EncodeContext {
	/** Address of this instruction's first byte, for relative branch offsets. */
	location: bigint | undefined;
	report(
		code: string,
		message: string,
		span: readonly [number, number],
		file?: string,
	): void;
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
	const { mnemonic, operands } = instruction;
	const name = mnemonic.text.toUpperCase();
	const modes = OPCODES[name];
	const nameSpan: readonly [number, number] = [mnemonic.start, mnemonic.end];

	if (!modes) {
		context.report(
			Codes.UnknownMnemonic,
			`Unknown mnemonic "${mnemonic.text}"`,
			nameSpan,
			mnemonic.origin,
		);
		return [];
	}

	// Keyword arguments are macro-call syntax.
	const keyword = instruction.argNames?.find((name) => name !== undefined);
	if (keyword) {
		context.report(
			Codes.KeywordArgsOnInstruction,
			"Keyword arguments are for macro calls",
			[keyword.start, keyword.end],
			keyword.origin ?? mnemonic.origin,
		);
		return [];
	}

	// Operand lists exist for macro calls; a real instruction takes at most one.
	if (operands.length > 1) {
		const second = expressionOf(operands[1]!);
		context.report(
			Codes.TooManyOperands,
			`Too many operands for ${name}`,
			getOperandLocation(operands[1]!),
			second ? getExpressionOrigin(second) : mnemonic.origin,
		);
		return [];
	}
	const operand = operands[0] ?? null;

	// Value errors span the operand's *expression* and attribute to the file
	// its tokens come from: in a macro-expanded instruction the expression may
	// be a spliced call-site argument (caller's file) or a body expression
	// (macro's file) - either way, span and file must come from the same
	// tokens, and the surrounding operand punctuation (`#`, `(`) may not.
	const expression = expressionOf(operand);
	const span = expression
		? getExpressionLocation(expression)
		: operand
			? getOperandLocation(operand)
			: nameSpan;
	const file = expression ? getExpressionOrigin(expression) : mnemonic.origin;

	// A bare `x`/`y` never encodes - registers are macro-argument currency.
	if (operand?.type === "register-operand") {
		context.report(
			Codes.NoRegisterOperand,
			"No instruction takes a register operand",
			getOperandLocation(operand),
			operand.registerToken.origin ?? mnemonic.origin,
		);
		return [];
	}

	// Operand-value coercion: a *simple* operand whose value is an operand
	// value becomes that operand, shape and all - `lda foo` with
	// `foo = .immediate_operand(3)` is `lda #3`. Inside a shaped operand
	// (`lda #foo`) an operand value cannot nest.
	let mode: Mode;
	let value = operandValue;
	const coerced =
		operand?.type === "simple-operand" && isOperandValue(operandValue)
			? operandValue
			: null;
	if (coerced) {
		if (coerced.shape === "x" || coerced.shape === "y") {
			context.report(
				Codes.NoRegisterOperand,
				"No instruction takes a register operand",
				span,
				file,
			);
			return [];
		}
		value = coerced.value;
		mode = modeForShape(coerced.shape, value, modes);
	} else {
		if (
			operand &&
			operand.type !== "simple-operand" &&
			isOperandValue(operandValue)
		) {
			context.report(
				Codes.OperandWholeOnly,
				"An operand value can only be used as a whole operand",
				span,
				file,
			);
			return [];
		}
		mode = resolveMode(operand, operandValue, modes);
	}

	const opcode = modes[mode];
	if (opcode === undefined) {
		context.report(
			Codes.NoSuchAddressingMode,
			`${name} has no ${MODE_NAMES[mode]} addressing mode`,
			nameSpan,
			mnemonic.origin,
		);
		return [];
	}

	return [opcode, ...encodeOperand(mode, value, span, file, context)];
}

function isOperandValue(value: Value | undefined): value is OperandValue {
	return (
		typeof value === "object" && value !== null && value.type === "operand"
	);
}

/** The mode a coerced operand value selects (register shapes are handled by
 * the caller; `a` maps to the accumulator mode). */
function modeForShape(
	shape: OperandShape,
	value: Value | undefined,
	modes: Modes,
): Mode {
	switch (shape) {
		case "a":
			return "acc";
		case "immediate":
			return "imm";
		case "x_indexed":
			return sized(value, "zpx", "abx", modes);
		case "y_indexed":
			return sized(value, "zpy", "aby", modes);
		case "indirect":
			return "ind";
		case "x_indexed_indirect":
			return "inx";
		case "indirect_y_indexed":
			return "iny";
		default:
			return "imp"; // x/y - unreachable, rejected by the caller
	}
}

function expressionOf(operand: Operand | null): Expression | null {
	if (operand === null) return null;
	if (operand.type === "accumulator-operand") return null;
	if (operand.type === "register-operand") return null;
	return operand.expression;
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
		return "imp"; // no implied form - reported by the caller
	}

	switch (operand.type) {
		case "accumulator-operand":
			return "acc";
		case "register-operand":
			return "imp"; // unreachable - rejected before mode resolution
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
	file: string | undefined,
	context: EncodeContext,
): number[] {
	const size = OPERAND_BYTES[mode];
	if (size === 0) return [];

	if (value === undefined) return new Array<number>(size).fill(0); // unresolved
	if (typeof value !== "bigint") {
		const kind =
			typeof value === "string"
				? "a string"
				: value.type === "dict"
					? "a dictionary"
					: value.type === "operand"
						? "an operand value"
						: value.type === "null"
							? "null"
							: "a function";
		context.report(
			Codes.OperandType,
			`Operand must be a number, not ${kind}`,
			span,
			file,
		);
		return new Array<number>(size).fill(0);
	}

	if (mode === "rel") return [branchByte(value, span, file, context)];
	if (size === 1) return [byte(value, span, file, context)];
	const w = word(value, span, file, context);
	return [w & 0xff, (w >> 8) & 0xff];
}

function byte(
	value: bigint,
	span: readonly [number, number],
	file: string | undefined,
	context: EncodeContext,
): number {
	if (value < -128n || value > 255n) {
		context.report(
			Codes.ByteOutOfRange,
			`Byte value out of range: ${value}`,
			span,
			file,
		);
	}
	return Number(value & 0xffn);
}

function word(
	value: bigint,
	span: readonly [number, number],
	file: string | undefined,
	context: EncodeContext,
): number {
	if (value < -32768n || value > 65535n) {
		context.report(
			Codes.WordOutOfRange,
			`Word value out of range: ${value}`,
			span,
			file,
		);
	}
	return Number(value & 0xffffn);
}

function branchByte(
	target: bigint,
	span: readonly [number, number],
	file: string | undefined,
	context: EncodeContext,
): number {
	if (context.location === undefined) return 0; // offset not computable yet
	const offset = target - (context.location + 2n);
	if (offset < -128n || offset > 127n) {
		context.report(
			Codes.BranchOutOfRange,
			`Branch target out of range (${offset} bytes)`,
			span,
			file,
		);
		return 0;
	}
	return Number(offset & 0xffn);
}
