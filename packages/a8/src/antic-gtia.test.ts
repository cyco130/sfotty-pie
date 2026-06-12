import { expect, test } from "vitest";
import { AnticGtia } from "./antic-gtia.ts";

// GTIA read registers at power-on, per the Altirra Hardware Reference
// Manual. (The write-only registers' contents are not covered by it.)
const POWER_ON_READS = [
	0x00,
	0x00,
	0x00,
	0x00,
	0x00,
	0x00,
	0x00,
	0x00, // M0PF-P3PF
	0x0f,
	0x0f,
	0x0f,
	0x0f,
	0x0e,
	0x0d,
	0x0b,
	0x07, // M0PL-P3PL
	0x01,
	0x01,
	0x01,
	0x01, // TRIG0-TRIG3
	0x0f, // PAL (NTSC)
	0x0f,
	0x0f,
	0x0f,
	0x0f,
	0x0f,
	0x0f,
	0x0f,
	0x0f,
	0x0f,
	0x0f, // unmapped
	0x00, // CONSOL (the written latch powers on pulling the lines low)
];

test("GTIA read registers match the documented power-on state", () => {
	const ag = new AnticGtia(
		{ dmaRead: () => 0, log: () => {} },
		{ anticTvSystem: "ntsc", gtiaTvSystem: "ntsc" },
	);

	for (let offset = 0; offset < 0x20; offset++) {
		expect(
			ag.read(0xd000 + offset),
			`$D0${offset.toString(16).padStart(2, "0").toUpperCase()}`,
		).toBe(POWER_ON_READS[offset]);
	}
});

test("writing CONSOL releases the switch lines", () => {
	const ag = new AnticGtia(
		{ dmaRead: () => 0, log: () => {} },
		{ anticTvSystem: "ntsc", gtiaTvSystem: "ntsc" },
	);

	expect(ag.read(0xd01f)).toBe(0); // latch pulls all lines low
	ag.write(0xd01f, 0x08); // what the OS writes every VBLANK
	expect(ag.read(0xd01f)).toBe(7); // no console keys pressed
	ag.console &= ~0x04; // hold Option
	expect(ag.read(0xd01f)).toBe(3);
});

function makeAnticGtia() {
	return new AnticGtia(
		{ dmaRead: () => 0, log: () => {} },
		{ anticTvSystem: "ntsc", gtiaTvSystem: "ntsc" },
	);
}

const NMIEN = 0xd40e;
const NMIRES_NMIST = 0xd40f;

// Run cycles 7 and 8 of the current line: the NMIST status latch (7) and
// the NMI line pull (8).
function latchAndPull(ag: AnticGtia): void {
	ag.hpos = 7;
	ag.beforeCpu();
	ag.beforeCpu();
}

test("NMIST latches the VBI bit even with NMIs disabled in NMIEN", () => {
	const ag = makeAnticGtia();
	ag.write(NMIRES_NMIST, 0); // clear the power-on reset status
	expect(ag.read(NMIRES_NMIST) & 0xe0).toBe(0);

	ag.vcount = 248;
	ag.hpos = 7;
	ag.beforeCpu();
	expect(ag.read(NMIRES_NMIST) & 0x40).toBe(0x40); // the status latches...

	// A same-cycle NMIRES loses to the latch; a later one clears it.
	ag.write(NMIRES_NMIST, 0);
	expect(ag.read(NMIRES_NMIST) & 0x40).toBe(0x40);
	ag.beforeCpu();
	ag.beforeCpu(); // ...and the cycle-8 pull leaves the line low
	expect(ag.nmi).toBe(false);
	ag.write(NMIRES_NMIST, 0);
	expect(ag.read(NMIRES_NMIST) & 0x40).toBe(0);
});

test("NMIST latches the DLI bit even with DLIs disabled in NMIEN", () => {
	const ag = makeAnticGtia();
	ag.write(NMIRES_NMIST, 0);

	// The last line of a DLI-flagged mode line, mid-frame.
	ag.instruction = 0x82;
	ag.modeLineHeight = 8;
	ag.modeLineNo = 7;
	ag.vcount = 100;
	latchAndPull(ag);
	expect(ag.nmi).toBe(false);
	expect(ag.read(NMIRES_NMIST) & 0x80).toBe(0x80);

	// With the DLI enabled, the same point also pulls the NMI line.
	ag.write(NMIRES_NMIST, 0);
	ag.write(NMIEN, 0x80);
	latchAndPull(ag);
	expect(ag.nmi).toBe(true);
	expect(ag.read(NMIRES_NMIST) & 0x80).toBe(0x80);
});

test("NMIEN gates the pull at the latch cycle, set-dominant", () => {
	const ag = makeAnticGtia();
	ag.write(NMIRES_NMIST, 0);
	ag.vcount = 248;

	// A disable landing before the latch cycle blocks the pull...
	ag.write(NMIEN, 0x40);
	ag.write(NMIEN, 0x00);
	latchAndPull(ag);
	expect(ag.nmi).toBe(false);
	expect(ag.read(NMIRES_NMIST) & 0x40).toBe(0x40); // status latches anyway

	// ...a disable after the latch cycle is too late to block...
	ag.write(NMIRES_NMIST, 0);
	ag.write(NMIEN, 0x40);
	ag.hpos = 7;
	ag.beforeCpu(); // cycle 7: latch and arm
	ag.write(NMIEN, 0x00); // too late
	ag.beforeCpu(); // cycle 8: the pull fires anyway
	expect(ag.nmi).toBe(true);

	ag.beforeCpu(); // cycle 9: still held
	expect(ag.nmi).toBe(true);
	ag.beforeCpu(); // cycle 10: the line drops
	expect(ag.nmi).toBe(false);

	// ...and an enable landing at cycle 7 — after the arm sampled — fires
	// a *delayed* NMI two cycles after the write, not at the cycle-8 pull.
	ag.write(NMIRES_NMIST, 0);
	ag.hpos = 7;
	ag.beforeCpu(); // cycle 7: latch with NMIs disabled
	ag.write(NMIEN, 0x40); // lands at cycle 7, after the arm
	ag.beforeCpu(); // cycle 8: the pull does not fire
	expect(ag.nmi).toBe(false);
	ag.beforeCpu(); // cycle 9: the delayed rise
	expect(ag.nmi).toBe(true);

	ag.beforeCpu(); // cycle 10: still held
	expect(ag.nmi).toBe(true);
	ag.beforeCpu(); // cycle 11: drops
	expect(ag.nmi).toBe(false);

	// An enable landing at cycle 8 or later is too late entirely.
	ag.write(NMIEN, 0x00);
	ag.write(NMIRES_NMIST, 0);
	ag.hpos = 7;
	ag.beforeCpu(); // cycle 7: latch with NMIs disabled
	ag.beforeCpu(); // cycle 8
	ag.write(NMIEN, 0x40); // lands at cycle 8
	for (let i = 0; i < 8; i++) {
		ag.beforeCpu();
		expect(ag.nmi).toBe(false);
	}
});

test("the VBI clears the DLI status bit", () => {
	const ag = makeAnticGtia();
	ag.write(NMIRES_NMIST, 0);

	ag.instruction = 0x82;
	ag.modeLineHeight = 8;
	ag.modeLineNo = 7;
	ag.vcount = 100;
	ag.hpos = 7;
	ag.beforeCpu();
	expect(ag.read(NMIRES_NMIST) & 0xc0).toBe(0x80);

	ag.vcount = 248;
	ag.hpos = 7;
	ag.beforeCpu();
	expect(ag.read(NMIRES_NMIST) & 0xc0).toBe(0x40);
});

test("a JVB display list reloads its target every frame", () => {
	const ram = new Uint8Array(0x10000);
	// Acid800's antic_nmist display list: three 8-blank lines, two
	// DLI-flagged 8-blank lines (ending at scan lines 39 and 47), JVB.
	const dlist = [0x70, 0x70, 0x70, 0xf0, 0xf0, 0x41, 0x00, 0x2c];
	dlist.forEach((b, i) => (ram[0x2c00 + i] = b));

	const ag = new AnticGtia(
		{ dmaRead: (address) => ram[address]!, log: () => {} },
		{ anticTvSystem: "ntsc", gtiaTvSystem: "ntsc" },
	);
	ag.write(0xd402, 0x00); // DLISTL
	ag.write(0xd403, 0x2c); // DLISTH
	ag.write(0xd400, 0x20); // DMACTL: display list DMA on, playfield off

	const frame = new Uint8Array(376 * 240);
	const latchLines: number[] = [];
	for (let cycle = 0; cycle < 262 * 114 * 3; cycle++) {
		ag.beforeCpu();
		if (ag.dli) {
			latchLines.push(ag.vcount);
			ag.dli = false; // observe each latch separately
		}
		ag.afterCpu(frame, 0xff);
	}

	// Both DLIs latch on every frame — the JVB jump target loads even
	// though the wait-for-VBI flag stops the rest of the line's DMA.
	expect(latchLines).toEqual([39, 47, 39, 47, 39, 47]);
});

test("VCOUNT increments at cycle 111 and rolls over a cycle late", () => {
	const ag = makeAnticGtia();

	// State as the CPU would see it while executing during `cycle`.
	const readDuring = (line: number, cycle: number) => {
		ag.vcount = line;
		ag.hpos = cycle;
		ag.beforeCpu();
		return ag.read(0xd40b);
	};

	// Mid-frame: the new line becomes readable during cycle 111.
	expect(readDuring(99, 110)).toBe(49);
	expect(readDuring(99, 111)).toBe(50);
	expect(readDuring(99, 113)).toBe(50);
	expect(readDuring(100, 0)).toBe(50);

	// Last line: one cycle of "overflow" before the late rollover.
	expect(readDuring(261, 110)).toBe(130);
	expect(readDuring(261, 111)).toBe(131); // $83 — the 262 window
	expect(readDuring(261, 112)).toBe(0);
	expect(readDuring(261, 113)).toBe(0);
	expect(readDuring(0, 0)).toBe(0);
});

test("the PAL VCOUNT overflow window reads $9C", () => {
	const ag = new AnticGtia(
		{ dmaRead: () => 0, log: () => {} },
		{ anticTvSystem: "pal", gtiaTvSystem: "pal" },
	);

	ag.vcount = 311;
	ag.hpos = 111;
	ag.beforeCpu();
	expect(ag.read(0xd40b)).toBe(156);
});

test("direct GRAF writes survive when GRACTL has latching off", () => {
	const ag = makeAnticGtia();
	const frame = new Uint8Array(376 * 240);

	ag.write(0xd00d, 0xff); // GRAFP0, written by the CPU — no P/M DMA
	for (let i = 0; i < 114 * 30; i++) {
		ag.beforeCpu();
		ag.afterCpu(frame, 0x20); // bus noise must not clobber it
	}
	expect(ag.grafP0).toBe(0xff);

	ag.write(0xd01d, 0x02); // GRACTL: latch player data
	for (let i = 0; i < 114 * 30; i++) {
		ag.beforeCpu();
		ag.afterCpu(frame, 0x20);
	}
	expect(ag.grafP0).toBe(0x20); // now the bus byte latches, like DMA
});
