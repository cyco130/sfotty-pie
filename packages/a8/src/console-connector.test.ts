import { expect, test } from "vitest";
import { ReadOptions } from "@sfotty-pie/sfotty";
import { ConsolePanel } from "./console-panel.ts";
import { Atari } from "./machine.ts";

const CONSOL = 0xd01f;
const PORTB = 0xd301;
const PBCTL = 0xd303;

function makeMachine(model: "800" | "800XL") {
	// On the 800, BASIC goes through cartridge image sniffing: give the dummy
	// ROM a valid $A000 cart trailer (init address $A000, start unused).
	const basic = new Uint8Array(8192);
	basic[8191] = 0xa0;

	return new Atari({
		xl: model !== "800",
		os: new Uint8Array(model === "800" ? 10240 : 16384),
		basic,
	});
}

test("console buttons drive CONSOL reads, active low", () => {
	const machine = makeMachine("800");
	// The written latch powers on all-set: CONSOL reads 0 until written.
	expect(machine.read(CONSOL, ReadOptions.NONE)).toBe(0);
	machine.write(CONSOL, 0x08, ReadOptions.NONE);
	expect(machine.read(CONSOL, ReadOptions.NONE)).toBe(7);

	machine.console.startIn.value = false;
	expect(machine.read(CONSOL, ReadOptions.NONE)).toBe(6);

	// The ConsolePanel device drives the same wires.
	const panel = new ConsolePanel(machine.console);
	panel.option = true;
	expect(machine.read(CONSOL, ReadOptions.NONE)).toBe(2);

	machine.console.startIn.value = true;
	panel.option = false;
	expect(machine.read(CONSOL, ReadOptions.NONE)).toBe(7);
});

test("the written CONSOL latch shows on the switch Out lines", () => {
	const machine = makeMachine("800");
	const console = machine.console;

	// Power-on: the latch pulls S0-S2 low, the speaker line is high.
	expect(console.startOut.value).toBe(false);
	expect(console.speakerOut.value).toBe(true);

	machine.write(CONSOL, 0x08, ReadOptions.NONE); // release S0-S2, speaker off
	expect(console.startOut.value).toBe(true);
	expect(console.selectOut.value).toBe(true);
	expect(console.optionOut.value).toBe(true);
	expect(console.speakerOut.value).toBe(true);

	machine.write(CONSOL, 0x00, ReadOptions.NONE); // speaker drive pulls S3 low
	expect(console.speakerOut.value).toBe(false);

	// A held button shows on the resolved line too.
	machine.write(CONSOL, 0x08, ReadOptions.NONE);
	console.selectIn.value = false;
	expect(console.selectOut.value).toBe(false);
});

test("the Reset key holds the XL system reset line", () => {
	const machine = makeMachine("800XL");
	expect(machine.resetAsserted).toBe(false);

	machine.console.reset.value = true;
	expect(machine.resetAsserted).toBe(true);
	machine.console.reset.value = false;
	expect(machine.resetAsserted).toBe(false);

	// The ConsolePanel device drives the same wire.
	const panel = new ConsolePanel(machine.console);
	panel.reset = true;
	expect(machine.resetAsserted).toBe(true);
	panel.reset = false;
	expect(machine.resetAsserted).toBe(false);
});

test("the Reset key is ANTIC's RNMI on the 400/800", () => {
	const machine = makeMachine("800");

	machine.console.reset.value = true;
	expect(machine.anticGtia.rnmi).toBe(true);
	expect(machine.resetAsserted).toBe(false); // nothing is hardware-reset

	machine.console.reset.value = false;
	expect(machine.anticGtia.rnmi).toBe(false);
});

test("the power switch cold-resets the components", () => {
	const machine = makeMachine("800");
	machine.write(CONSOL, 0x08, ReadOptions.NONE);
	expect(machine.read(CONSOL, ReadOptions.NONE)).toBe(7);

	// GTIA has no reset line, so only a power cycle restores the written
	// latch (CONSOL reads 0 again).
	machine.console.power.emit();
	expect(machine.read(CONSOL, ReadOptions.NONE)).toBe(0);
});

test("the LED lines follow PIA PB2/PB3 on the XL", () => {
	const machine = makeMachine("800XL");
	const console = machine.console;
	expect(console.led1Out.value).toBe(true); // high = LED off

	machine.write(PORTB, 0xff, ReadOptions.NONE); // PBCTL bit 2 is 0: DDRB
	machine.write(PBCTL, 0x04, ReadOptions.NONE);
	machine.write(PORTB, 0xfb, ReadOptions.NONE); // PB2 low: LED 1 lit
	expect(console.led1Out.value).toBe(false);
	expect(console.led2Out.value).toBe(true);
});
