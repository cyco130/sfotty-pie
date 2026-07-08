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

test("a mid-scanline color register write paints from color clock 2w+1", () => {
	// One mode E + LMS line of solid PF2 pixels, then JVB.
	const machine = new Atari({ os: new Uint8Array(10240) });
	const dl = [0x4e, 0x00, 0x30, 0x41, 0x00, 0x20];
	dl.forEach((b, i) => machine.write(0x2000 + i, b, ReadOptions.NONE));
	for (let i = 0; i < 40; i++) {
		machine.write(0x3000 + i, 0xff, ReadOptions.NONE);
	}
	machine.write(0xd402, 0x00, ReadOptions.NONE); // DLISTL
	machine.write(0xd403, 0x20, ReadOptions.NONE); // DLISTH
	machine.write(0xd400, 0x22, ReadOptions.NONE); // DMACTL: normal + DL
	machine.write(0xd018, 0x0e, ReadOptions.NONE); // COLPF2 white

	// Rewrite COLPF2 during machine cycle w of the mode line: the new
	// color must paint from color clock 2w+1 — frame x = 4(w-17)+2. One
	// color clock earlier than AHRM table 18's ladder relative to the
	// HPOS anchor; pinned pixel-exact by beam-racing kernels
	// (RastaConverter output) against a reference render.
	const w = 55;
	const { anticGtia } = machine;
	let guard = 0;
	while (
		!(anticGtia.vcount === 8 && anticGtia.hpos === w) &&
		guard++ < 200000
	) {
		machine.cycle();
	}
	machine.write(0xd018, 0x34, ReadOptions.NONE);
	while (anticGtia.vcount === 8 && guard++ < 300000) machine.cycle();

	const row = machine.frame.subarray(0, 376);
	const boundary = row.findIndex((v, x) => v === 0x34 && row[x - 1] === 0x0e);
	expect(boundary).toBe(4 * (w - 17) + 2);
});

test("color registers ignore luminance bit 0", () => {
	const machine = quietMachine();
	machine.write(0xd016, 0x35, ReadOptions.NONE); // COLPF0, odd luminance
	for (let i = 0; i < 8; i++) machine.cycle(); // let the write reach GTIA
	expect(machine.anticGtia.colorRegisters[4]).toBe(0x34);
});

test("repositioning an in-flight player onto the beam retriggers and merges", () => {
	// Player 2, quadruple width, %00111000, triggered at HPOS $22 = color
	// clock 34: pixels at clocks 42-53 (frame x 16-39). Rewriting HPOSP2
	// to $27 = 39 during machine cycle 17 lands the comparator value on
	// the very clock the beam reaches it (write effect from 2w+5) — a
	// match: the in-flight image shifts a step and the graphics latch
	// ORs in (the pmoverlap merge), stretching the player to clocks
	// 39-58 (x 10-49). One color clock later and the match is missed —
	// the truncated player is a visible drop-out under beam-racing
	// kernels (RastaConverter output).
	const spanFor = (rewrite: boolean) => {
		const machine = new Atari({ os: new Uint8Array(10240) });
		machine.write(0xd00a, 0x03, ReadOptions.NONE); // SIZEP2 quad
		machine.write(0xd002, 0x22, ReadOptions.NONE); // HPOSP2
		machine.write(0xd00f, 0x38, ReadOptions.NONE); // GRAFP2
		machine.write(0xd014, 0x46, ReadOptions.NONE); // COLPM2
		const { anticGtia } = machine;
		let guard = 0;
		while (
			!(anticGtia.vcount === 20 && anticGtia.hpos === 17) &&
			guard++ < 200000
		) {
			machine.cycle();
		}
		if (rewrite) machine.write(0xd002, 0x27, ReadOptions.NONE);
		while (anticGtia.vcount === 20 && guard++ < 300000) machine.cycle();
		const row = machine.frame.subarray(12 * 376, 13 * 376);
		const px = [];
		for (let x = 0; x < 376; x++) if (row[x] === 0x46) px.push(x);
		return `${px[0]}-${px[px.length - 1]}:${px.length}`;
	};
	expect(spanFor(false)).toBe("16-39:24");
	expect(spanFor(true)).toBe("10-49:40");
});
