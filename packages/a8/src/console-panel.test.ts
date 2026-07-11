import { expect, test } from "vitest";
import { ReadOptions } from "@sfotty-pie/sfotty";
import { Atari } from "./machine.ts";

const CONSOL = 0xd01f;
const PORTB = 0xd301;
const PBCTL = 0xd303;

function makeMachine(model: "800" | "800XL") {
	return new Atari({
		xl: model !== "800",
		os: new Uint8Array(model === "800" ? 10240 : 16384),
	});
}

test("console buttons drive CONSOL reads, active low", () => {
	const machine = makeMachine("800");
	// The written latch powers on all-set: CONSOL reads 0 until written.
	expect(machine.mmu.read(CONSOL, ReadOptions.NONE)).toBe(0);
	machine.mmu.write(CONSOL, 0x08, ReadOptions.NONE);
	expect(machine.mmu.read(CONSOL, ReadOptions.NONE)).toBe(7);

	machine.console.start = true;
	expect(machine.mmu.read(CONSOL, ReadOptions.NONE)).toBe(6);
	expect(machine.console.start).toBe(true);

	machine.console.option = true;
	expect(machine.mmu.read(CONSOL, ReadOptions.NONE)).toBe(2);

	machine.console.start = false;
	machine.console.option = false;
	expect(machine.mmu.read(CONSOL, ReadOptions.NONE)).toBe(7);
});

test("the written CONSOL latch shows on GTIA's switch Out lines", () => {
	const machine = makeMachine("800");
	const gtia = machine.anticGtia;

	// Power-on: the latch pulls S0-S2 low, the speaker line is high.
	expect(gtia.switchesOut.value).toBe(0x08);

	machine.mmu.write(CONSOL, 0x08, ReadOptions.NONE); // release S0-S2
	expect(gtia.switchesOut.value).toBe(0x0f);

	machine.mmu.write(CONSOL, 0x00, ReadOptions.NONE); // speaker pulls S3 low
	expect(gtia.switchesOut.value).toBe(0x07);

	// A held button shows on the resolved line too.
	machine.mmu.write(CONSOL, 0x08, ReadOptions.NONE);
	machine.console.select = true;
	expect(gtia.switchesOut.value).toBe(0x0d);
});

test("the Reset key holds the XL system reset line", () => {
	const machine = makeMachine("800XL");
	expect(machine.resetAsserted).toBe(false);

	machine.console.reset = true;
	expect(machine.resetAsserted).toBe(true);
	machine.console.reset = false;
	expect(machine.resetAsserted).toBe(false);
});

test("the Reset key is ANTIC's RNMI on the 400/800", () => {
	const machine = makeMachine("800");

	machine.console.reset = true;
	expect(machine.anticGtia.rnmi).toBe(true);
	expect(machine.resetAsserted).toBe(false); // nothing is hardware-reset

	machine.console.reset = false;
	expect(machine.anticGtia.rnmi).toBe(false);
});

test("the power switch cold-resets the components", () => {
	const machine = makeMachine("800");
	machine.mmu.write(CONSOL, 0x08, ReadOptions.NONE);
	expect(machine.mmu.read(CONSOL, ReadOptions.NONE)).toBe(7);

	// GTIA has no reset line, so only a power cycle restores the written
	// latch (CONSOL reads 0 again).
	machine.console.powerCycle();
	expect(machine.mmu.read(CONSOL, ReadOptions.NONE)).toBe(0);
});

test("the LEDs follow PIA PB2/PB3 on the XL, without bank-switch noise", () => {
	const machine = makeMachine("800XL");
	const panel = machine.console;
	expect(panel.led1).toBe(false); // line high = LED off

	const changes: [boolean, boolean][] = [];
	panel.watchLeds((led1, led2) => changes.push([led1, led2]));

	// DDRB all-outputs drives the zeroed output latch onto the pins: both
	// LEDs light for the moment until the data write - like the hardware.
	machine.mmu.write(PORTB, 0xff, ReadOptions.NONE); // PBCTL bit 2 is 0: DDRB
	expect(changes).toEqual([[true, true]]);

	machine.mmu.write(PBCTL, 0x04, ReadOptions.NONE);
	machine.mmu.write(PORTB, 0xfb, ReadOptions.NONE); // PB2 low: LED 1 lit
	expect(panel.led1).toBe(true);
	expect(panel.led2).toBe(false);
	expect(changes).toEqual([
		[true, true],
		[true, false],
	]);

	// A bank switch that leaves the LED bits alone reaches no watcher.
	machine.mmu.write(PORTB, 0xfa, ReadOptions.NONE); // PB0 low too
	expect(changes.length).toBe(2);
});

test("the 400/800 panel has no LEDs", () => {
	const machine = makeMachine("800");
	expect(machine.console.led1).toBe(false);
	expect(machine.console.led2).toBe(false);
	expect(machine.console.watchLeds(() => {})).toBeTypeOf("function");
});
