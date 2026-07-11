import { expect, test } from "vitest";
import { AnticGtia, prioritySelector } from "./antic-gtia.ts";

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
		{ bus: { read: () => 0 }, log: () => {} },
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
		{ bus: { read: () => 0 }, log: () => {} },
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
		{ bus: { read: () => 0 }, log: () => {} },
		{ anticTvSystem: "ntsc", gtiaTvSystem: "ntsc" },
	);
}

const NMIEN = 0xd40e;
const NMIRES_NMIST = 0xd40f;

// Run cycles 5 through 8 of the current line: the last-line arm (5), the
// NMIST status latch (7), and the NMI line pull (8).
function latchAndPull(ag: AnticGtia): void {
	ag.hpos = 5;
	ag.beforeCpu();
	ag.beforeCpu();
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

	// ...and an enable landing at cycle 7 - after the arm sampled - fires
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
	ag.hpos = 5;
	ag.beforeCpu(); // arm the last-line decision
	ag.beforeCpu();
	ag.beforeCpu(); // cycle 7: the latch
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
		{ bus: { read: (address) => ram[address]! }, log: () => {} },
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
		ag.busPhase();
		ag.afterCpu(frame, 0xff);
	}

	// Both DLIs latch on every frame - the JVB jump target loads even
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
	expect(readDuring(261, 111)).toBe(131); // $83 - the 262 window
	expect(readDuring(261, 112)).toBe(0);
	expect(readDuring(261, 113)).toBe(0);
	expect(readDuring(0, 0)).toBe(0);
});

test("the PAL VCOUNT overflow window reads $9C", () => {
	const ag = new AnticGtia(
		{ bus: { read: () => 0 }, log: () => {} },
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

	ag.write(0xd400, 0x0c); // DMACTL: P/M DMA - the fetch slots halt
	ag.write(0xd00d, 0xff); // GRAFP0, written by the CPU
	for (let i = 0; i < 114 * 30; i++) {
		ag.beforeCpu();
		ag.busPhase();
		ag.afterCpu(frame, 0x20); // with GRACTL off, the slots must not clobber it
	}
	expect(ag.grafP0).toBe(0xff);

	ag.write(0xd01d, 0x02); // GRACTL: latch player data
	for (let i = 0; i < 114 * 30; i++) {
		ag.beforeCpu();
		ag.busPhase();
		ag.afterCpu(frame, 0x20);
	}
	expect(ag.grafP0).toBe(0x20); // now the bus byte latches, like DMA
});

test("with all DMA off, GRACTL latching finds no fetch slot and loads nothing", () => {
	// GTIA locates the P/M fetch slots by watching HALT: the first halted
	// cycle within horizontal blank is taken as the missile fetch. With DMA
	// entirely off there is no halted HBLANK cycle (DRAM refresh halts land
	// later in the line), so GRACTL-enabled latching never fires.
	const ag = makeAnticGtia();
	const frame = new Uint8Array(376 * 240);

	ag.write(0xd00d, 0xff); // GRAFP0, written by the CPU
	ag.write(0xd01d, 0x03); // GRACTL: latch players + missiles
	for (let i = 0; i < 114 * 30; i++) {
		ag.beforeCpu();
		ag.busPhase();
		ag.afterCpu(frame, 0x20);
	}
	expect(ag.grafP0).toBe(0xff);
	expect(ag.grafM).toBe(0x00);
});

test("P/M graphics latch across the whole visible region, including the bottom band", () => {
	// Regression: the latch was gated at y < 224, freezing player graphics over
	// scan lines 232-247. Invisible on NTSC, but it corrupted River Raid's lower
	// HUD on PAL (taller frame), leaking a stale P2<->P3 collision and crashing
	// the plane. The latch must run for the full collision region (lines 8-247).
	const ag = makeAnticGtia();
	const frame = new Uint8Array(376 * 240);
	ag.write(0xd400, 0x0c); // DMACTL: P/M DMA - the fetch slots halt
	ag.write(0xd01d, 0x02); // GRACTL: enable player-graphics latching

	const latchOnLine = (vcount: number, busByte: number): number => {
		ag.vcount = vcount;
		ag.hpos = 0;
		ag.grafP0 = 0x00;
		for (let i = 0; i < 114; i++) {
			ag.beforeCpu();
			ag.busPhase();
			ag.afterCpu(frame, busByte);
		}
		return ag.grafP0;
	};

	// Bottom of the visible region (scan line 240): latches (used to freeze).
	expect(latchOnLine(240, 0x5a)).toBe(0x5a);
	// Vertical blank (scan line 248): no latch - graphics are off, per the AHRM.
	expect(latchOnLine(248, 0x5a)).toBe(0x00);
});

// The priority selector masks: bit n = colorRegisters[n].
const PM0 = 1 << 0;
const PM1 = 1 << 1;
const PM2 = 1 << 2;
const PF0 = 1 << 4;
const PF2 = 1 << 6;
const PF3 = 1 << 7;
const BAK = 1 << 8;

test("priority selectors match the official PRIOR modes", () => {
	// Players above playfields (%0001), playfields above players (%0100).
	expect(prioritySelector(0b0001, 1, 0b0001, false)).toBe(PM0);
	expect(prioritySelector(0b0100, 1, 0b0001, false)).toBe(PF0);
	// Split mode %1000: PF01 above players above PF23.
	expect(prioritySelector(0b1000, 1, 0b0001, false)).toBe(PF0);
	expect(prioritySelector(0b1000, 3, 0b0001, false)).toBe(PM0);
	// Mode 0 mixes: PF01 with P01 (OR), but P01 still covers PF23.
	expect(prioritySelector(0b0000, 1, 0b0001, false)).toBe(PM0 | PF0);
	expect(prioritySelector(0b0000, 3, 0b0001, false)).toBe(PM0);
	// Multicolor ORs the player pairs.
	expect(prioritySelector(0b100001, 0, 0b0011, false)).toBe(PM0 | PM1);
	// Nothing active: background.
	expect(prioritySelector(0b0001, 0, 0, false)).toBe(BAK);
	// The fifth player rides PF3's slot but beats other playfields.
	expect(prioritySelector(0b0100, 1, 0, true)).toBe(PF3);
	// The %1000 fifth-player cascade (AHRM 6.7 prose): PF01 covers the
	// players, then the fifth player's PF3 covers PF01 - but with PF01
	// absent, the players show.
	expect(prioritySelector(0b1000, 1, 0b0001, true)).toBe(PF3);
	expect(prioritySelector(0b1000, 0, 0b0001, true)).toBe(PM0);
});

test("priority conflicts match AHRM 6.7 table 16", () => {
	// The complete table. Inputs: P01 = player 0, P23 = player 2,
	// PF01 = playfield 0 (class 1), PF23 = playfield 2 (class 3), P5 = the
	// fifth player. Expected output per conflicting PRIOR[3:0] value;
	// 0 = black. Shared table rows are asserted under both layer sets.
	const priors = [3, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
	const expectRow = (
		pfClass: number,
		p: number,
		p5: boolean,
		expected: number[],
	) => {
		priors.forEach((prior, i) => {
			expect(
				prioritySelector(prior, pfClass, p, p5),
				`pf ${pfClass} p ${p} p5 ${p5} PRIOR %${prior.toString(2).padStart(4, "0")}`,
			).toBe(expected[i]);
		});
	};
	// PF01+P01 and PF01+P01+P23 (shared row)
	const row1 = [PM0, 0, 0, 0, 0, 0, 0, PF0, 0, 0, 0];
	expectRow(1, 0b0001, false, row1);
	expectRow(1, 0b0101, false, row1);
	// PF01+P23
	expectRow(1, 0b0100, false, [
		PM2,
		PM2,
		PF0,
		PM2,
		PM2,
		PF0,
		PM2,
		PF0,
		PM2,
		PF0,
		PM2,
	]);
	// PF23+P01
	expectRow(3, 0b0001, false, [
		PM0,
		PF2,
		PF2,
		PF2,
		PM0,
		PM0,
		PM0,
		PF2,
		PF2,
		PF2,
		PF2,
	]);
	// PF23+P23
	expectRow(3, 0b0100, false, [0, 0, PF2, 0, PM2, 0, 0, 0, 0, 0, 0]);
	// PF23+P01+P23
	expectRow(3, 0b0101, false, [PM0, 0, PF2, 0, PM0, PM0, PM0, 0, 0, 0, 0]);
	// P5+P01 and P5+PF23+P01 (shared row)
	const row6 = [PM0, PF3, PF3, PF3, PM0, PM0, PM0, PF3, PF3, PF3, PF3];
	expectRow(0, 0b0001, true, row6);
	expectRow(3, 0b0001, true, row6);
	// P5+P23
	expectRow(0, 0b0100, true, [0, PM2, PF3, 0, PM2, 0, 0, PM2, 0, 0, 0]);
	// P5+P01+P23
	expectRow(0, 0b0101, true, [PM0, 0, PF3, 0, PM0, PM0, PM0, PM0, 0, 0, 0]);
	// P5+PF01+P01
	expectRow(1, 0b0001, true, [PM0, PF3, PF3, PF3, 0, 0, 0, PF3, PF3, PF3, PF3]);
	// P5+PF01+P23 and P5+PF23+P23 (shared row)
	const row10 = [0, 0, PF3, 0, PM2, 0, 0, 0, 0, 0, 0];
	expectRow(1, 0b0100, true, row10);
	expectRow(3, 0b0100, true, row10);
	// P5+PF01+P01+P23
	expectRow(1, 0b0101, true, [PM0, 0, PF3, 0, 0, 0, 0, 0, 0, 0, 0]);
	// P5+PF23+P01+P23
	expectRow(3, 0b0101, true, [PM0, 0, PF3, 0, PM0, PM0, PM0, 0, 0, 0, 0]);
});

// The halt line over cycles 0-7 of the current line (the P/M and display
// list DMA slots; DRAM refresh doesn't request until cycle 25).
function haltPattern(ag: AnticGtia, vcount: number): boolean[] {
	ag.vcount = vcount;
	ag.hpos = 0;
	const halts: boolean[] = [];
	for (let i = 0; i < 8; i++) {
		ag.beforeCpu();
		ag.busPhase();
		halts.push(ag.halt);
	}
	return halts;
}

test("P/M DMA fetches only within the visible region, lines 8-247", () => {
	const ag = makeAnticGtia();
	ag.write(0xd400, 0x0c); // DMACTL: player + missile DMA, no playfield/DL

	// A display line: the missile slot at cycle 0 and players at 2-5. A
	// free-running cycle-counted kernel (RastaConverter) counts on the
	// vertical-blank lines NOT having them - five phantom steals on the
	// line between its WSYNC anchor and the display skewed every write.
	const pm = [true, false, true, true, true, true, false, false];
	expect(haltPattern(ag, 100)).toEqual(pm);
	expect(haltPattern(ag, 8)).toEqual(pm);
	expect(haltPattern(ag, 247)).toEqual(pm);

	const off = new Array(8).fill(false);
	expect(haltPattern(ag, 7)).toEqual(off);
	expect(haltPattern(ag, 3)).toEqual(off);
	expect(haltPattern(ag, 248)).toEqual(off);
	expect(haltPattern(ag, 300)).toEqual(off);
});
