import { describe, test, expect } from "vitest";
import { parse, type Instruction } from "./parser.ts";
import { SourceFile } from "./source-file.ts";
import { encodeInstruction } from "./encode.ts";
import type { Value } from "./value.ts";

// Parse one instruction, encode it with an explicitly supplied operand value
// (so the encoder is tested in isolation from the evaluator).
function encodeSrc(
	src: string,
	opts: { value?: Value; location?: bigint } = {},
): { bytes: number[]; reports: string[] } {
	const { module, errors } = parse(new SourceFile("t", src));
	expect(errors).toEqual([]);
	const content = module.statements[0]!.content as Instruction;
	const reports: string[] = [];
	const bytes = encodeInstruction(content, opts.value, {
		location: opts.location,
		report: (message) => reports.push(message),
	});
	return { bytes, reports };
}

function enc(src: string, value?: Value, location?: bigint): number[] {
	const { bytes, reports } = encodeSrc(src, { value, location });
	expect(reports).toEqual([]);
	return bytes;
}

describe("addressing modes", () => {
	test("implied and accumulator", () => {
		expect(enc("nop")).toEqual([0xea]);
		expect(enc("brk")).toEqual([0x00]);
		expect(enc("asl a")).toEqual([0x0a]);
		expect(enc("asl")).toEqual([0x0a]); // bare shift = accumulator
	});

	test("immediate", () => {
		expect(enc("lda #$10", 0x10n)).toEqual([0xa9, 0x10]);
	});

	test("zero page vs absolute, auto-sized by value", () => {
		expect(enc("lda $80", 0x80n)).toEqual([0xa5, 0x80]);
		expect(enc("lda $1234", 0x1234n)).toEqual([0xad, 0x34, 0x12]);
		expect(enc("lda $100", 0x100n)).toEqual([0xad, 0x00, 0x01]); // 256 -> abs
		expect(enc("jmp $80", 0x80n)).toEqual([0x4c, 0x80, 0x00]); // JMP has no zp
	});

	test("indexed", () => {
		expect(enc("lda $80,x", 0x80n)).toEqual([0xb5, 0x80]);
		expect(enc("lda $1234,x", 0x1234n)).toEqual([0xbd, 0x34, 0x12]);
		expect(enc("lda $80,y", 0x80n)).toEqual([0xb9, 0x80, 0x00]); // LDA has no zp,Y
		expect(enc("ldx $80,y", 0x80n)).toEqual([0xb6, 0x80]); // LDX has zp,Y
	});

	test("indirect family", () => {
		expect(enc("jmp ($1234)", 0x1234n)).toEqual([0x6c, 0x34, 0x12]);
		expect(enc("lda ($80,x)", 0x80n)).toEqual([0xa1, 0x80]);
		expect(enc("lda ($80),y", 0x80n)).toEqual([0xb1, 0x80]);
	});

	test("relative branches", () => {
		expect(enc("beq $1010", 0x1010n, 0x1000n)).toEqual([0xf0, 0x0e]); // +14
		expect(enc("beq $1000", 0x1000n, 0x1000n)).toEqual([0xf0, 0xfe]); // -2
	});
});

describe("unresolved operands", () => {
	test("placeholder bytes at the pessimistic (absolute) size", () => {
		expect(encodeSrc("lda foo")).toEqual({ bytes: [0xad, 0, 0], reports: [] });
	});
});

describe("errors", () => {
	test("unknown mnemonic", () => {
		expect(encodeSrc("foo $10", { value: 0x10n })).toEqual({
			bytes: [],
			reports: ['Unknown mnemonic "foo"'],
		});
	});

	test("unsupported addressing mode", () => {
		expect(encodeSrc("nop $1234", { value: 0x1234n })).toEqual({
			bytes: [],
			reports: ["NOP has no absolute addressing mode"],
		});
		expect(encodeSrc("lda")).toEqual({
			bytes: [],
			reports: ["LDA has no implied addressing mode"],
		});
	});

	test("byte out of range is reported but masked", () => {
		expect(encodeSrc("lda #0", { value: 300n })).toEqual({
			bytes: [0xa9, 0x2c],
			reports: ["Byte value out of range: 300"],
		});
	});

	test("byte range boundaries are accepted (-128..255)", () => {
		expect(enc("lda #0", 255n)).toEqual([0xa9, 0xff]);
		expect(enc("lda #0", -128n)).toEqual([0xa9, 0x80]);
	});

	test("string operand is a type error", () => {
		expect(encodeSrc("lda #foo", { value: "x" })).toEqual({
			bytes: [0xa9, 0],
			reports: ["Operand must be a number, not a string"],
		});
	});

	test("branch out of range", () => {
		expect(
			encodeSrc("beq $2000", { value: 0x2000n, location: 0x1000n }),
		).toEqual({
			bytes: [0xf0, 0],
			reports: ["Branch target out of range (4094 bytes)"],
		});
	});
});
