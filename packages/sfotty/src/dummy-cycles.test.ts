import { describe, test, expect } from "vitest";
import { Sfotty } from "./sfotty.ts";
import { DECODE } from "./microcode.ts";
import { type Memory, ReadOptions } from "./bus.ts";

// The DUMMY flag marks a bus access that doesn't commit anything — so traps can
// tell real reads from speculative/discarded ones. This file pins which cycles
// carry it. (Step 5a: implied/accumulator internal-operation reads. Stack, RMW,
// indexed and reset dummies are added in later steps.)

const NOP = 0xea;
const LDA_IMM = 0xa9;

function record(): {
	cpu: Sfotty;
	bytes: Uint8Array;
	reads: { address: number; options: number }[];
} {
	const bytes = new Uint8Array(0x10000).fill(NOP);
	const reads: { address: number; options: number }[] = [];
	const bus: Memory = {
		read(address, options) {
			reads.push({ address, options });
			return bytes[address]!;
		},
		write(address, value) {
			bytes[address] = value;
		},
	};
	const cpu = new Sfotty(bus);
	cpu.PC = 0x0200;
	cpu.S = 0xff;
	cpu.state = DECODE;
	return { cpu, bytes, reads };
}

function run(cpu: Sfotty, cycles: number): void {
	for (let i = 0; i < cycles; i++) cpu.run();
}

describe("dummy cycles", () => {
	test("an implied op's internal-operation read is DUMMY, the fetch is not", () => {
		const { cpu, reads } = record(); // $0200.. are NOPs (2 cycles each)
		run(cpu, 6);

		// The opcode fetch at $0200 commits: SYNC, not DUMMY.
		const fetch = reads.find(
			(r) => r.address === 0x0200 && r.options & ReadOptions.SYNC,
		);
		expect(fetch).toBeDefined();
		expect(fetch!.options & ReadOptions.DUMMY).toBe(0);

		// NOP's second cycle re-reads PC ($0201) and throws it away: DUMMY, no SYNC.
		const dummy = reads.find(
			(r) => r.address === 0x0201 && r.options & ReadOptions.DUMMY,
		);
		expect(dummy).toBeDefined();
		expect(dummy!.options & ReadOptions.SYNC).toBe(0);
	});

	test("a stack op's throwaway and increment-S reads are DUMMY, the pull isn't", () => {
		const { cpu, bytes, reads } = record();
		bytes[0x0200] = 0x68; // PLA: fetch, throwaway read PC, inc-S stack read, pull
		run(cpu, 4);

		// Cycle 2: "read next byte and throw it away" at $0201 — DUMMY, not SYNC.
		const throwaway = reads.find(
			(r) => r.address === 0x0201 && r.options & ReadOptions.DUMMY,
		);
		expect(throwaway).toBeDefined();
		expect(throwaway!.options & ReadOptions.SYNC).toBe(0);

		// Cycle 3: increment-S stack read at $01FF (S started $FF) — DUMMY.
		const incrementS = reads.find((r) => r.address === 0x01ff);
		expect(incrementS).toBeDefined();
		expect(incrementS!.options & ReadOptions.DUMMY).toBeTruthy();

		// Cycle 4: the actual pull at $0100 (S now $00) — a real read, not DUMMY.
		const pull = reads.find((r) => r.address === 0x0100);
		expect(pull).toBeDefined();
		expect(pull!.options & ReadOptions.DUMMY).toBe(0);
	});

	test("an indexed read is DUMMY only on a page cross (the speculative read)", () => {
		// LDA $12FF,X with X=1 → effective $1300, crossing the $12xx→$13xx page.
		const cross = record();
		cross.bytes[0x0200] = 0xbd; // LDA abs,X
		cross.bytes[0x0201] = 0xff;
		cross.bytes[0x0202] = 0x12;
		cross.cpu.X = 1;
		run(cross.cpu, 5);

		// The speculative read at the not-yet-fixed $1200 is a dummy.
		const speculative = cross.reads.find((r) => r.address === 0x1200);
		expect(speculative).toBeDefined();
		expect(speculative!.options & ReadOptions.DUMMY).toBeTruthy();

		// The fixed re-read at $1300 is the real one.
		const real = cross.reads.find((r) => r.address === 0x1300);
		expect(real).toBeDefined();
		expect(real!.options & ReadOptions.DUMMY).toBe(0);

		// No cross: LDA $1200,X with X=1 → $1201, a single real read, no dummy.
		const noCross = record();
		noCross.bytes[0x0200] = 0xbd;
		noCross.bytes[0x0201] = 0x00;
		noCross.bytes[0x0202] = 0x12;
		noCross.cpu.X = 1;
		run(noCross.cpu, 5);

		const single = noCross.reads.find((r) => r.address === 0x1201);
		expect(single).toBeDefined();
		expect(single!.options & ReadOptions.DUMMY).toBe(0);
	});

	test("an indexed store always reads-before-write, and that read is DUMMY", () => {
		// STA $12FF,X with X=1 → effective $1300. The 6502 can't undo a write to a
		// wrong address, so it always reads the unfixed address ($1200) first and
		// throws it away — a dummy read on every indexed store, cross or not.
		const cross = record();
		cross.bytes[0x0200] = 0x9d; // STA abs,X
		cross.bytes[0x0201] = 0xff;
		cross.bytes[0x0202] = 0x12;
		cross.cpu.X = 1;
		cross.cpu.A = 0x42;
		run(cross.cpu, 5);

		// The pre-write read at the unfixed $1200 is a dummy.
		const dummyRead = cross.reads.find((r) => r.address === 0x1200);
		expect(dummyRead).toBeDefined();
		expect(dummyRead!.options & ReadOptions.DUMMY).toBeTruthy();
		// And it didn't corrupt $1200 — only $1300 gets the store.
		expect(cross.bytes[0x1300]).toBe(0x42);

		// No cross either: STA $1200,X with X=1 → $1201, still a dummy read first.
		const noCross = record();
		noCross.bytes[0x0200] = 0x9d;
		noCross.bytes[0x0201] = 0x00;
		noCross.bytes[0x0202] = 0x12;
		noCross.cpu.X = 1;
		noCross.cpu.A = 0x42;
		run(noCross.cpu, 5);

		const read = noCross.reads.find((r) => r.address === 0x1201);
		expect(read).toBeDefined();
		expect(read!.options & ReadOptions.DUMMY).toBeTruthy();
		expect(noCross.bytes[0x1201]).toBe(0x42);
	});

	test("a real operand read is not DUMMY", () => {
		const { cpu, bytes, reads } = record();
		bytes[0x0200] = LDA_IMM; // LDA #$EA — operand read at $0201 is real
		run(cpu, 2);

		const operand = reads.find(
			(r) => r.address === 0x0201 && !(r.options & ReadOptions.SYNC),
		);
		expect(operand).toBeDefined();
		expect(operand!.options & ReadOptions.DUMMY).toBe(0);
	});
});
