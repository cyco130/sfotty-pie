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

	pia.setInputA(0x7f); // an external pull drags an input bit low
	expect(pia.portaOut.value).toBe(0x75);
});

test("reset clears registers, IRQs, and strobes — but not the pins", () => {
	const pia = new Pia();
	pia.write(PACTL, 0x31); // CA1 IRQ enabled; CA2 manual low
	pia.ca1In.value = false;
	expect(pia.irqA).toBe(true);
	expect(pia.ca2Out.value).toBe(false);
	pia.setInputA(0xfe);

	pia.reset(false);
	expect(pia.irqA).toBe(false);
	expect(pia.ca2Out.value).toBe(true);
	expect(pia.read(PACTL)).toBe(0);
	expect(pia.read(PORTA)).toBe(0); // DDRA selected after reset

	pia.write(PACTL, 0x04);
	expect(pia.read(PORTA)).toBe(0xfe); // the input pins survived
});
