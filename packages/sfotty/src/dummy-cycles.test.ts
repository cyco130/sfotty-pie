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
