import { expect, test } from "vitest";
import { ReadOptions } from "@sfotty-pie/sfotty";
import { AnticGtia } from "./antic-gtia.ts";
import { Atari, type AtariModel } from "./machine.ts";
import { Pokey } from "./pokey.ts";

const KBCODE = 0xd209;
const IRQEN_IRQST = 0xd20e;
const SKSTAT = 0xd20f;
const NMIEN = 0xd40e;
const NMIRES_NMIST = 0xd40f;

test("keyboard IRQ latches while enabled and clears via IRQEN", () => {
	const pokey = new Pokey();
	pokey.write(IRQEN_IRQST, 0x40);

	pokey.keyDown(0x3f);
	expect(pokey.read(KBCODE)).toBe(0x3f);
	expect(pokey.read(IRQEN_IRQST)).toBe(0xbf);
	expect(pokey.irq).toBe(true);

	// Re-writing the enable bit as 1 does not clear the latch...
	pokey.write(IRQEN_IRQST, 0xc0);
	expect(pokey.irq).toBe(true);

	// ...writing it as 0 does.
	pokey.write(IRQEN_IRQST, 0x80);
	expect(pokey.read(IRQEN_IRQST)).toBe(0xff);
	expect(pokey.irq).toBe(false);
});

test("key events are lost while the keyboard IRQ is disabled", () => {
	const pokey = new Pokey();

	pokey.keyDown(0x3f);
	expect(pokey.irq).toBe(false);
	expect(pokey.read(IRQEN_IRQST)).toBe(0xff);

	// ...but KBCODE and the key sense still update.
	expect(pokey.read(KBCODE)).toBe(0x3f);
	expect(pokey.read(SKSTAT) & 0x04).toBe(0);
});

test("SKSTAT key and Shift senses are active low", () => {
	const pokey = new Pokey();
	expect(pokey.read(SKSTAT) & 0x0c).toBe(0x0c);

	pokey.keyDown(0x3f);
	pokey.shiftKeyDown();
	expect(pokey.read(SKSTAT) & 0x0c).toBe(0);

	pokey.keyUp();
	pokey.shiftKeyUp();
	expect(pokey.read(SKSTAT) & 0x0c).toBe(0x0c);
});

test("Break IRQ latches while enabled and clears via IRQEN", () => {
	const pokey = new Pokey();
	pokey.write(IRQEN_IRQST, 0x80);

	pokey.breakKeyDown();
	expect(pokey.read(IRQEN_IRQST)).toBe(0x7f);
	expect(pokey.irq).toBe(true);

	pokey.write(IRQEN_IRQST, 0x00);
	expect(pokey.irq).toBe(false);
});

test("Ctrl+Shift combos on the unscannable columns are refused", () => {
	const pokey = new Pokey();
	pokey.write(IRQEN_IRQST, 0x40);

	pokey.keyDown(0xc5); // Ctrl+Shift+K: scan code $05, first dead column
	pokey.keyDown(0xd1); // Ctrl+Shift+Help: scan code $11, second dead column
	expect(pokey.irq).toBe(false);
	expect(pokey.read(KBCODE)).toBe(0xff);
	expect(pokey.read(SKSTAT) & 0x04).toBe(0x04);

	pokey.keyDown(0xc8); // Ctrl+Shift+O: scan code $08, scannable
	expect(pokey.irq).toBe(true);
	expect(pokey.read(KBCODE)).toBe(0xc8);
});

test("only a power cycle clears POKEY", () => {
	const pokey = new Pokey();
	pokey.write(IRQEN_IRQST, 0x40);
	pokey.keyDown(0x3f);

	pokey.reset(false);
	expect(pokey.irq).toBe(true);

	pokey.reset(true);
	expect(pokey.irq).toBe(false);
	expect(pokey.read(IRQEN_IRQST)).toBe(0xff);
});

function makeAnticGtia() {
	return new AnticGtia(
		{ dmaRead: () => 0, log: () => {} },
		{ anticTvSystem: "ntsc", gtiaTvSystem: "ntsc" },
	);
}

test("the Reset key NMI fires at the VBLANK point and ignores NMIEN", () => {
	const ag = makeAnticGtia();
	ag.write(NMIRES_NMIST, 0); // clear the power-on reset status
	expect(ag.res).toBe(false);

	ag.rnmi = true;

	// Run the status latch (cycle 7) through the NMI pull (cycle 8).
	const latchAndPull = () => {
		ag.hpos = 7;
		ag.beforeCpu();
		ag.beforeCpu();
		ag.beforeCpu();
	};

	// Mid-frame: nothing happens, even at the NMI cycles.
	ag.vcount = 100;
	latchAndPull();
	expect(ag.nmi).toBe(false);
	expect(ag.res).toBe(false);

	// VBLANK point: fires with NMIEN fully disabled.
	ag.vcount = 248;
	latchAndPull();
	expect(ag.nmi).toBe(true);
	expect(ag.res).toBe(true);
	// The VBI NMI stays masked, but its NMIST status bit latches anyway.
	expect(ag.vbi).toBe(true);
	expect(ag.read(NMIRES_NMIST) & 0x20).toBe(0x20);
});

function makeMachine(model: AtariModel) {
	// On the 800, BASIC goes through cartridge image sniffing: give the dummy
	// ROM a valid $A000 cart trailer (init address $A000, start unused).
	const basic = new Uint8Array(8192);
	basic[8191] = 0xa0;

	return new Atari({
		model,
		os: new Uint8Array(model === "800XL" ? 16384 : 10240),
		basic,
	});
}

test("the 800 Reset key drives the RNMI line, not the reset line", () => {
	const machine = makeMachine("800");

	machine.resetButtonDown();
	expect(machine.anticGtia.rnmi).toBe(true);
	expect(machine.resetAsserted).toBe(false);

	machine.resetButtonUp();
	expect(machine.anticGtia.rnmi).toBe(false);
});

test("the XL Reset button resets components and holds the reset line", () => {
	const machine = makeMachine("800XL");
	machine.write(NMIEN, 0xc0);
	expect(machine.anticGtia.vbiEnabled).toBe(true);

	// Bank the OS ROM out (DDRB all outputs, then PORTB bit 0 low) and put a
	// marker in the RAM underneath.
	machine.write(0xd303, 0x00);
	machine.write(0xd301, 0xff);
	machine.write(0xd303, 0x04);
	machine.write(0xd301, 0xfe);
	machine.write(0xe000, 0x55);
	expect(machine.read(0xe000, ReadOptions.NONE)).toBe(0x55);

	machine.resetButtonDown();
	expect(machine.resetAsserted).toBe(true);
	expect(machine.anticGtia.rnmi).toBe(false);
	// ANTIC sits on the system reset line.
	expect(machine.anticGtia.vbiEnabled).toBe(false);
	// So does the PIA: PORTB floats back to all-inputs ($FF), banking the OS
	// ROM back in over the marker. The RAM itself survives the warm reset.
	expect(machine.read(0xe000, ReadOptions.NONE)).toBe(0x00);

	machine.resetButtonUp();
	expect(machine.resetAsserted).toBe(false);
});

test("console keys drive the CONSOL register (active low)", () => {
	const machine = makeMachine("800");
	const CONSOL = 0xd01f;
	// Release the power-on written latch first, like the OS does.
	machine.write(CONSOL, 0x08);
	expect(machine.read(CONSOL, ReadOptions.NONE)).toBe(7);

	machine.consoleKeyDown(4); // Option
	machine.consoleKeyDown(1); // Start
	expect(machine.read(CONSOL, ReadOptions.NONE)).toBe(2);

	machine.consoleKeyUp(4);
	expect(machine.read(CONSOL, ReadOptions.NONE)).toBe(6);
});

test("the keyboard facade reaches POKEY through the bus", () => {
	const machine = makeMachine("800");
	machine.write(IRQEN_IRQST, 0x40);

	machine.pokeyKeyDown(0x3f);
	machine.shiftKeyDown();
	expect(machine.irq).toBe(true);
	expect(machine.read(KBCODE, ReadOptions.NONE)).toBe(0x3f);
	expect(machine.read(SKSTAT, ReadOptions.NONE) & 0x0c).toBe(0);

	machine.pokeyKeyUp();
	machine.shiftKeyUp();
	machine.breakKeyDown(); // Break enable is off: lost, like real hardware
	expect(machine.read(SKSTAT, ReadOptions.NONE) & 0x0c).toBe(0x0c);
	expect(machine.read(IRQEN_IRQST, ReadOptions.NONE)).toBe(0xbf);
});
