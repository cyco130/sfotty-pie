import { expect, test } from "vitest";
import { DECODE, ReadOptions } from "@sfotty-pie/sfotty";
import { Atari } from "./machine.ts";

// A machine poised to execute a single NOP at $0600, with ANTIC parked in a
// quiet slot — no DMA fetch, no DRAM refresh, off a visible line — so the CPU
// actually runs this cycle (halt stays false).
function quietMachine(): Atari {
	const machine = new Atari({ os: new Uint8Array(10240) });
	machine.write(0x0600, 0xea, ReadOptions.NONE); // NOP
	machine.cpu.PC = 0x0600;
	machine.cpu.state = DECODE;
	machine.anticGtia.vcount = 0; // not a visible display line
	machine.anticGtia.hpos = 10; // not a P/M, display-list, or refresh slot
	return machine;
}

test("cycle runs a whole cycle and fires onInstruction once", () => {
	const machine = quietMachine();
	const fetched: number[] = [];
	machine.onInstruction = (pc) => fetched.push(pc);

	machine.cycle();

	expect(machine.cpu.PC).toBe(0x0601); // committed the NOP fetch
	expect(fetched).toEqual([0x0600]); // exactly once, at the opcode address
});

test("a bus-phase throw suspends the cycle; resume finishes it without re-advancing ANTIC", () => {
	const machine = quietMachine();

	// The core is agnostic about the thrown value — any object propagates.
	const suspend = { reason: "test-suspend" };
	let armed = true;
	machine.interceptExecute(0x0600, () => {
		if (armed) {
			armed = false; // disarm so the resumed fetch goes through
			throw suspend;
		}
		return undefined;
	});

	const hposBefore = machine.anticGtia.hpos;

	// The fetch interceptor throws straight out of cycle — not caught.
	let caught: unknown;
	try {
		machine.cycle();
	} catch (error) {
		caught = error;
	}
	expect(caught).toBe(suspend);

	// Frozen mid-cycle: starting a fresh cycle is rejected (the host must resume).
	expect(() => machine.cycle()).toThrow(/mid-cycle/);

	// The fetch didn't commit: PC is untouched and the interrupt-free retry is clean.
	expect(machine.cpu.PC).toBe(0x0600);

	machine.resumeCycle();

	// beforeCpu ran exactly once across the suspend — ANTIC advanced one cycle.
	expect(machine.anticGtia.hpos).toBe(hposBefore + 1);
	// And the CPU committed the fetch on the retry.
	expect(machine.cpu.PC).toBe(0x0601);
});
