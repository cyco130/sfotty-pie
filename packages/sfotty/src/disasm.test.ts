import { expect, test } from "vitest";
import { traceLine } from "./disasm.ts";
import type { Sfotty } from "./sfotty.ts";

/** A fake CPU with just what traceLine reads. */
function cpu(regs: Partial<{ A: number; X: number; Y: number }>): Sfotty {
	return {
		A: 0,
		X: 0,
		Y: 0,
		S: 0xff,
		PC: 0,
		getP: () => 0x34,
		...regs,
	} as Sfotty;
}

/** Memory as a sparse map; unset bytes read as 0. */
function memory(bytes: Record<number, number>) {
	return (address: number) => bytes[address] ?? 0;
}

const trail = (line: string) => /\[(.*)\]$/.exec(line)?.[1];

test("direct and indexed modes show the effective address and its byte", () => {
	// LDA $80 with $80 = $1F
	const zp = traceLine(cpu({}), memory({ 0: 0xa5, 1: 0x80, 0x80: 0x1f }), 0);
	expect(trail(zp)).toBe("$80=$1F");

	// LDA $1234,X with X = 2
	const abx = traceLine(
		cpu({ X: 2 }),
		memory({ 0: 0xbd, 1: 0x34, 2: 0x12, 0x1236: 0x56 }),
		0,
	);
	expect(trail(abx)).toBe("$1236=$56");

	// LDX $F0,Y wraps in the zero page: $F0 + $20 = $10
	const zpy = traceLine(
		cpu({ Y: 0x20 }),
		memory({ 0: 0xb6, 1: 0xf0, 0x10: 0x77 }),
		0,
	);
	expect(trail(zpy)).toBe("$10=$77");
});

test("($zp),Y shows the pointer word, then the indexed target", () => {
	// LDA ($80),Y with ($80) = $1234, Y = 5, $1239 = $56
	const line = traceLine(
		cpu({ Y: 5 }),
		memory({ 0: 0xb1, 1: 0x80, 0x80: 0x34, 0x81: 0x12, 0x1239: 0x56 }),
		0,
	);
	expect(trail(line)).toBe("$80=$1234; $1239=$56");
});

test("($zp,X) indexes the pointer, wrapping in the zero page", () => {
	// LDA ($FE,X) with X = 3: pointer at $01, both bytes in page zero. The
	// instruction sits at $0200 so it can't collide with the pointer bytes.
	const line = traceLine(
		cpu({ X: 3 }),
		memory({ 0x200: 0xa1, 0x201: 0xfe, 0x01: 0x00, 0x02: 0x20, 0x2000: 0x99 }),
		0x200,
	);
	expect(trail(line)).toBe("$01=$2000; $2000=$99");
});

test("a zero-page pointer at $FF wraps for its high byte", () => {
	// LDA ($FF),Y: low from $FF, high from $00 - never $100. The instruction
	// sits at $0200 so it can't collide with the pointer bytes.
	const line = traceLine(
		cpu({ Y: 0 }),
		memory({ 0x200: 0xb1, 0x201: 0xff, 0xff: 0x10, 0x00: 0x30, 0x3010: 0xab }),
		0x200,
	);
	expect(trail(line)).toBe("$FF=$3010; $3010=$AB");
});

test("JMP ($xxFF) shows the NMOS page-wrap fetch", () => {
	// Pointer at $12FF: low from $12FF, high from $1200.
	const line = traceLine(
		cpu({}),
		memory({ 0: 0x6c, 1: 0xff, 2: 0x12, 0x12ff: 0x00, 0x1200: 0x40 }),
		0,
	);
	expect(trail(line)).toBe("$12FF=$4000");
});

test("immediate, implied, and relative modes get no trail", () => {
	expect(trail(traceLine(cpu({}), memory({ 0: 0xa9, 1: 0x12 }), 0))).toBe(
		undefined,
	);
	expect(trail(traceLine(cpu({}), memory({ 0: 0xea }), 0))).toBe(undefined);
	expect(trail(traceLine(cpu({}), memory({ 0: 0xd0, 1: 0x10 }), 0))).toBe(
		undefined,
	);
});
