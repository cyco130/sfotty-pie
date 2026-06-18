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
	writes: { address: number; value: number; options: number }[];
} {
	const bytes = new Uint8Array(0x10000).fill(NOP);
	const reads: { address: number; options: number }[] = [];
	const writes: { address: number; value: number; options: number }[] = [];
	const bus: Memory = {
		read(address, options) {
			reads.push({ address, options });
			return bytes[address]!;
		},
		write(address, value, options) {
			writes.push({ address, value, options });
			bytes[address] = value;
		},
	};
	const cpu = new Sfotty(bus);
	cpu.PC = 0x0200;
	cpu.S = 0xff;
	cpu.state = DECODE;
	return { cpu, bytes, reads, writes };
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

	test("a taken branch's internal PC re-reads are DUMMY", () => {
		// BNE +$0E from $0200, Z clear → taken, same page. After fetching opcode and
		// operand PC=$0202; cycle 3 re-reads $0202 to add the offset and throws it
		// away — the real opcode fetch is the following DECODE at $0210.
		const noCross = record();
		noCross.bytes[0x0200] = 0xd0; // BNE
		noCross.bytes[0x0201] = 0x0e;
		noCross.cpu.zFlag = false;
		run(noCross.cpu, 4);

		const dummy = noCross.reads.find((r) => r.address === 0x0202);
		expect(dummy).toBeDefined();
		expect(dummy!.options & ReadOptions.DUMMY).toBeTruthy();
		expect(dummy!.options & ReadOptions.SYNC).toBe(0);

		const real = noCross.reads.find(
			(r) => r.address === 0x0210 && r.options & ReadOptions.SYNC,
		);
		expect(real).toBeDefined();
		expect(real!.options & ReadOptions.DUMMY).toBe(0);

		// Page cross adds a second dummy: BNE +$40 from $02F0 → $0332. Cycle 3
		// re-reads $02F2 (dummy), cycle 4 re-reads $0232 at the unfixed PCH (dummy),
		// then DECODE fetches the real opcode at the fixed $0332.
		const cross = record();
		cross.cpu.PC = 0x02f0;
		cross.bytes[0x02f0] = 0xd0;
		cross.bytes[0x02f1] = 0x40;
		cross.cpu.zFlag = false;
		run(cross.cpu, 5);

		for (const addr of [0x02f2, 0x0232]) {
			const d = cross.reads.find((r) => r.address === addr);
			expect(d, `dummy read at ${addr.toString(16)}`).toBeDefined();
			expect(d!.options & ReadOptions.DUMMY).toBeTruthy();
		}
		const crossReal = cross.reads.find(
			(r) => r.address === 0x0332 && r.options & ReadOptions.SYNC,
		);
		expect(crossReal).toBeDefined();
		expect(crossReal!.options & ReadOptions.DUMMY).toBe(0);
	});

	test("a read-modify-write writes the old value back as a DUMMY, the new value for real", () => {
		// INC $80 (zero page): read, write the old value back (dummy), write old+1.
		// The 6502 always does that throwaway write-back — traps key on DUMMY to
		// tell it from the committed store.
		const { cpu, bytes, writes } = record();
		bytes[0x0200] = 0xe6; // INC zp
		bytes[0x0201] = 0x80;
		bytes[0x0080] = 0x41;
		run(cpu, 5);

		const toTarget = writes.filter((w) => w.address === 0x0080);
		expect(toTarget).toHaveLength(2);

		// First write: the old value, flagged DUMMY.
		expect(toTarget[0]!.value).toBe(0x41);
		expect(toTarget[0]!.options & ReadOptions.DUMMY).toBeTruthy();

		// Second write: the incremented value, committed (not DUMMY).
		expect(toTarget[1]!.value).toBe(0x42);
		expect(toTarget[1]!.options & ReadOptions.DUMMY).toBe(0);
	});

	test("a plain store's write is not DUMMY", () => {
		const { cpu, bytes, writes } = record();
		bytes[0x0200] = 0x85; // STA zp
		bytes[0x0201] = 0x90;
		cpu.A = 0x37;
		run(cpu, 3);

		const store = writes.find((w) => w.address === 0x0090);
		expect(store).toBeDefined();
		expect(store!.value).toBe(0x37);
		expect(store!.options & ReadOptions.DUMMY).toBe(0);
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
