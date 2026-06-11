import { expect, test } from "vitest";
import { ReadOptions } from "@sfotty-pie/sfotty";
import { Pia } from "./pia.ts";

const PORTA = 0;
const PORTB = 1;
const PACTL = 2;
const PBCTL = 3;

test("CA1 active edges latch status; the enable only gates the IRQ", () => {
	const pia = new Pia();

	// Edge select 0: falling is active. The IRQ is disabled.
	pia.ca1In.value = false;
	expect(pia.read(PACTL) & 0x80).toBe(0x80);
	expect(pia.irqA).toBe(false);

	// Enabling the IRQ with the status already pending asserts it...
	pia.write(PACTL, 0x01);
	expect(pia.irqA).toBe(true);
	// ...and disabling drops it without touching the status.
	pia.write(PACTL, 0x00);
	expect(pia.irqA).toBe(false);
	expect(pia.read(PACTL) & 0x80).toBe(0x80);
});

test("the CA1 edge select picks the active polarity", () => {
	const pia = new Pia();
	pia.write(PACTL, 0x02); // rising edge active

	pia.ca1In.value = false; // falling: inactive
	expect(pia.read(PACTL) & 0x80).toBe(0);
	pia.ca1In.value = true; // rising: active
	expect(pia.read(PACTL) & 0x80).toBe(0x80);
});

test("reading the data port clears the statuses and the IRQ", () => {
	const pia = new Pia();
	pia.write(PACTL, 0x05); // data register selected, CA1 IRQ enabled
	pia.ca1In.value = false;
	expect(pia.irqA).toBe(true);

	// A peek is not a read...
	pia.read(PORTA, ReadOptions.PEEK);
	expect(pia.irqA).toBe(true);

	pia.read(PORTA);
	expect(pia.irqA).toBe(false);
	expect(pia.read(PACTL) & 0xc0).toBe(0);
});

test("CA2 input transitions latch status bit 6 and obey the enable", () => {
	const pia = new Pia();

	pia.ca2In.value = false; // falling, IRQ2 disabled: status only
	expect(pia.read(PACTL) & 0x40).toBe(0x40);
	expect(pia.irqA).toBe(false);

	pia.write(PACTL, 0x08); // IRQ2 enabled: asserts immediately
	expect(pia.irqA).toBe(true);
});

test("CB2 transitions are judged by PBCTL, not PACTL", () => {
	const pia = new Pia();
	pia.write(PACTL, 0x38); // CA2 manual-high output — must not matter
	pia.write(PBCTL, 0x08); // CB2 input, falling active, IRQ2 enabled

	pia.cb2In.value = false;
	expect(pia.read(PBCTL) & 0x40).toBe(0x40);
	expect(pia.irqB).toBe(true);
	expect(pia.irqA).toBe(false);
});

test("the CA2 read strobes: handshake and one-cycle pulse", () => {
	const pia = new Pia();

	pia.write(PACTL, 0x26); // CA2 read handshake; CA1 rising active
	pia.read(PORTA);
	expect(pia.ca2Out.value).toBe(false);
	pia.ca1In.value = false; // falling: inactive — the handshake holds
	expect(pia.ca2Out.value).toBe(false);
	pia.ca1In.value = true; // rising: active — the handshake ends
	expect(pia.ca2Out.value).toBe(true);

	pia.write(PACTL, 0x2c); // pulse mode: low for one cycle after the read
	pia.read(PORTA);
	expect(pia.ca2Out.value).toBe(false);
	pia.cycle();
	expect(pia.ca2Out.value).toBe(true);
});

test("the CA2 manual output modes drive the line from PACTL writes", () => {
	const pia = new Pia();
	pia.write(PACTL, 0x30);
	expect(pia.ca2Out.value).toBe(false);
	pia.write(PACTL, 0x38);
	expect(pia.ca2Out.value).toBe(true);
});

test("the CB2 write strobe fires on PORTB data writes", () => {
	const pia = new Pia();
	pia.write(PBCTL, 0x26); // CB2 write handshake; CB1 rising active

	pia.write(PORTB, 0xff);
	expect(pia.cb2Out.value).toBe(false);
	pia.cb1In.value = false; // inactive
	expect(pia.cb2Out.value).toBe(false);
	pia.cb1In.value = true; // active
	expect(pia.cb2Out.value).toBe(true);
});

test("the port pin signals track DDR, latch, and external pulls", () => {
	const pia = new Pia();
	expect(pia.portaOut.value).toBe(0xff); // all inputs, pulled up

	pia.write(PORTA, 0x0f); // DDRA: low nibble output
	pia.write(PACTL, 0x04);
	pia.write(PORTA, 0xa5); // latch
	expect(pia.portaOut.value).toBe(0xf5); // outputs $5, inputs pulled up

	pia.portaIn.value = 0x7f; // an external pull drags an input bit low
	expect(pia.portaOut.value).toBe(0x75);
});

test("reset clears registers, IRQs, and strobes — but not the pins", () => {
	const pia = new Pia();
	pia.write(PACTL, 0x31); // CA1 IRQ enabled; CA2 manual low
	pia.ca1In.value = false;
	expect(pia.irqA).toBe(true);
	expect(pia.ca2Out.value).toBe(false);
	pia.portaIn.value = 0xfe;

	pia.reset(false);
	expect(pia.irqA).toBe(false);
	expect(pia.ca2Out.value).toBe(true);
	expect(pia.read(PACTL)).toBe(0);
	expect(pia.read(PORTA)).toBe(0); // DDRA selected after reset

	pia.write(PACTL, 0x04);
	expect(pia.read(PORTA)).toBe(0xfe); // the input pins survived
});

// Acid800 pia_irq's control-line transition tables, verbatim: four control
// writes, then the expected control value and IRQ line. State deliberately
// carries from row to row, as in the original test.
type Vector = [number, number, number, number, number, number];

const TESTVEC_B: Vector[] = [
	// A $34→$3C transition sets the pending flag, which turns into IRQB2 on
	// entering input mode; the choice of input mode doesn't matter.
	[0x34, 0x3c, 0x3c, 0x04, 0x44, 0],
	[0x34, 0x3c, 0x3c, 0x0c, 0x4c, 1],
	[0x34, 0x3c, 0x04, 0x04, 0x44, 0],
	// Any output mode clears IRQB2.
	[0x34, 0x3c, 0x04, 0x24, 0x24, 0],
	// Handshake mode can sit between the 34:3C sequence; pulse mode and
	// input modes cannot.
	[0x34, 0x24, 0x3c, 0x04, 0x44, 0],
	[0x34, 0x28, 0x3c, 0x04, 0x04, 0],
	[0x34, 0x04, 0x3c, 0x04, 0x04, 0],
	// A high-low-high sequence does not work; low-high does.
	[0x34, 0x3c, 0x34, 0x04, 0x04, 0],
	[0x3c, 0x34, 0x3c, 0x04, 0x44, 0],
];

const TESTVEC_A: Vector[] = [
	// IRQA2 sets if the line was forced low and the next input mode selects
	// rising edges; temporary highs don't matter.
	[0x3c, 0x3c, 0x3c, 0x14, 0x14, 0],
	[0x3c, 0x3c, 0x34, 0x14, 0x54, 0],
	[0x3c, 0x34, 0x3c, 0x14, 0x54, 0],
	[0x3c, 0x34, 0x3c, 0x1c, 0x5c, 1],
	[0x34, 0x34, 0x34, 0x04, 0x04, 0],
	// Pulse mode clears the pending transition; handshake does not.
	[0x34, 0x34, 0x2c, 0x14, 0x14, 0],
	[0x34, 0x34, 0x24, 0x14, 0x54, 0],
	// Any output mode clears IRQA2.
	[0x34, 0x34, 0x14, 0x34, 0x34, 0],
];

function runVectors(
	vectors: Vector[],
	ctl: number,
	irqOf: (pia: Pia) => boolean,
) {
	const pia = new Pia();
	pia.write(ctl, 0x3c); // the state the original test enters its loop with

	vectors.forEach(([w0, w1, w2, w3, expected, irq], index) => {
		pia.write(ctl, w0);
		pia.write(ctl, w1);
		pia.write(ctl, w2);
		pia.write(ctl, w3);
		expect(pia.read(ctl), `entry ${index} control`).toBe(expected);
		expect(irqOf(pia), `entry ${index} irq`).toBe(irq !== 0);
	});
}

test("the Acid800 pia_irq CA2 transition table", () => {
	runVectors(TESTVEC_A, PACTL, (pia) => pia.irqA);
});

test("the Acid800 pia_irq CB2 transition table", () => {
	runVectors(TESTVEC_B, PBCTL, (pia) => pia.irqB);
});
