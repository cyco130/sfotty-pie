import { expect, test } from "vitest";
import { ReadOptions } from "@sfotty-pie/sfotty";
import { AnticGtia } from "./antic-gtia.ts";
import { KEYBOARD_LINES, Keyboard } from "./keyboard.ts";
import { Atari } from "./machine.ts";
import { Pokey } from "./pokey.ts";

const KBCODE = 0xd209;
const SKRES = 0xd20a;
const IRQEN_IRQST = 0xd20e;
const SKSTAT_SKCTL = 0xd20f;
const NMIEN = 0xd40e;
const NMIRES_NMIST = 0xd40f;

// A POKEY with a keyboard plugged in, out of init mode with the scan and
// debounce enabled (SKCTL=$03), the way the OS runs it.
function makeScanner() {
	const pokey = new Pokey();
	const keyboard = new Keyboard();
	pokey.keyboard = keyboard;
	pokey.write(SKSTAT_SKCTL, 0x03);
	return { pokey, keyboard };
}

// Run `ticks` of the 15KHz scan clock (114 machine cycles each). The default
// covers three full sweeps - enough for any debounced transition.
function scan(pokey: Pokey, ticks = 200) {
	for (let i = 0; i < ticks * 114; i++) pokey.cycle();
}

test("keyboard IRQ latches while enabled and clears via IRQEN", () => {
	const { pokey, keyboard } = makeScanner();
	pokey.write(IRQEN_IRQST, 0x40);

	keyboard.pressKey(0x3f);
	scan(pokey);
	expect(pokey.read(KBCODE)).toBe(0x3f);
	// Bit 3 (SEROC) always reads pending while the transmitter is idle.
	expect(pokey.read(IRQEN_IRQST)).toBe(0xb7);
	expect(pokey.irq).toBe(true);

	// Re-writing the enable bit as 1 does not clear the latch...
	pokey.write(IRQEN_IRQST, 0xc0);
	expect(pokey.irq).toBe(true);

	// ...writing it as 0 does.
	pokey.write(IRQEN_IRQST, 0x80);
	expect(pokey.read(IRQEN_IRQST)).toBe(0xf7);
	expect(pokey.irq).toBe(false);
});

test("key events are lost while the keyboard IRQ is disabled", () => {
	const { pokey, keyboard } = makeScanner();

	keyboard.pressKey(0x3f);
	scan(pokey);
	expect(pokey.irq).toBe(false);
	expect(pokey.read(IRQEN_IRQST)).toBe(0xf7);

	// ...but KBCODE and the key sense still update.
	expect(pokey.read(KBCODE)).toBe(0x3f);
	expect(pokey.read(SKSTAT_SKCTL) & 0x04).toBe(0);
});

test("SKSTAT key and Shift senses are active low", () => {
	const { pokey, keyboard } = makeScanner();
	expect(pokey.read(SKSTAT_SKCTL) & 0x0c).toBe(0x0c);

	keyboard.pressKey(0x3f);
	keyboard.pressMetaKey(KEYBOARD_LINES.SHIFT);
	scan(pokey);
	expect(pokey.read(SKSTAT_SKCTL) & 0x0c).toBe(0);

	keyboard.releaseAll();
	scan(pokey);
	expect(pokey.read(SKSTAT_SKCTL) & 0x0c).toBe(0x0c);
});

test("Break IRQ fires on the down edge and never retriggers while held", () => {
	const { pokey, keyboard } = makeScanner();
	pokey.write(IRQEN_IRQST, 0x80);

	keyboard.pressMetaKey(KEYBOARD_LINES.BREAK);
	scan(pokey);
	expect(pokey.read(IRQEN_IRQST)).toBe(0x77);
	expect(pokey.irq).toBe(true);

	pokey.write(IRQEN_IRQST, 0x00);
	expect(pokey.irq).toBe(false);

	// Still held: re-enabling does not retrigger - the press is lost.
	pokey.write(IRQEN_IRQST, 0x80);
	scan(pokey);
	expect(pokey.irq).toBe(false);
});

test("Ctrl+Shift combos on the unscannable columns are refused", () => {
	const { pokey, keyboard } = makeScanner();
	pokey.write(IRQEN_IRQST, 0x40);

	keyboard.pressMetaKey(KEYBOARD_LINES.SHIFT);
	keyboard.pressMetaKey(KEYBOARD_LINES.CONTROL);
	keyboard.pressKey(0x05); // K - the first dead column
	scan(pokey);
	expect(pokey.irq).toBe(false);
	expect(pokey.read(KBCODE)).toBe(0xff);
	expect(pokey.read(SKSTAT_SKCTL) & 0x04).toBe(0x04);

	keyboard.releaseKey(0x05);
	keyboard.pressKey(0x08); // O - scannable
	scan(pokey);
	expect(pokey.irq).toBe(true);
	expect(pokey.read(KBCODE)).toBe(0xc8);
});

test("debounce never registers two keys held at once", () => {
	const { pokey, keyboard } = makeScanner();
	pokey.write(IRQEN_IRQST, 0x40);

	keyboard.pressKey(0x05);
	keyboard.pressKey(0x2a);
	scan(pokey, 400);
	expect(pokey.irq).toBe(false);
	expect(pokey.read(KBCODE)).toBe(0xff);

	// Releasing one lets the survivor register.
	keyboard.releaseKey(0x05);
	scan(pokey);
	expect(pokey.read(KBCODE)).toBe(0x2a);
});

test("disabling the scan releases the key sense, keeps KBCODE and the IRQ", () => {
	const { pokey, keyboard } = makeScanner();
	pokey.write(IRQEN_IRQST, 0x40);
	keyboard.pressKey(0x3f);
	scan(pokey);
	expect(pokey.read(SKSTAT_SKCTL) & 0x04).toBe(0);

	pokey.write(SKSTAT_SKCTL, 0x01); // scan off (not init: bit 0 still set)
	scan(pokey);
	expect(pokey.read(SKSTAT_SKCTL) & 0x04).toBe(0x04);
	expect(pokey.read(KBCODE)).toBe(0x3f);
	expect(pokey.irq).toBe(true);
});

test("a second key while the IRQ is pending is an overrun; SKRES clears it", () => {
	const { pokey, keyboard } = makeScanner();
	pokey.write(IRQEN_IRQST, 0x40);

	keyboard.pressKey(0x05);
	scan(pokey);
	expect(pokey.read(SKSTAT_SKCTL) & 0x40).toBe(0x40); // no overrun yet

	// The IRQ is never acknowledged; the next registered key overruns.
	keyboard.releaseKey(0x05);
	scan(pokey);
	keyboard.pressKey(0x2a);
	scan(pokey);
	expect(pokey.read(KBCODE)).toBe(0x2a);
	expect(pokey.read(SKSTAT_SKCTL) & 0x40).toBe(0);

	pokey.write(SKRES, 0);
	expect(pokey.read(SKSTAT_SKCTL) & 0x40).toBe(0x40);
});

test("only a power cycle clears POKEY", () => {
	const { pokey, keyboard } = makeScanner();
	pokey.write(IRQEN_IRQST, 0x40);
	keyboard.pressKey(0x3f);
	scan(pokey);

	pokey.reset(false);
	expect(pokey.irq).toBe(true);

	pokey.reset(true);
	expect(pokey.irq).toBe(false);
	expect(pokey.read(IRQEN_IRQST)).toBe(0xf7);
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

function makeMachine(model: "800" | "800XL" | "130XE") {
	return new Atari({
		xl: model !== "800",
		...(model === "130XE" && { xeBankCount: 4, separateAnticAccess: true }),
		os: new Uint8Array(model === "800" ? 10240 : 16384),
	});
}

// The dummy OS ROM never writes SKCTL, so enable the scan by hand like the
// OS boot does, then advance enough for any debounced transition.
function enableScan(machine: Atari) {
	machine.write(SKSTAT_SKCTL, 0x03, ReadOptions.NONE);
}

function runScan(machine: Atari, ticks = 200) {
	for (let i = 0; i < ticks * 114; i++) machine.cycle();
}

test("the 800 Reset key drives the RNMI line, not the reset line", () => {
	const machine = makeMachine("800");

	// Set up some PIA state: it must survive, since nothing pulses the
	// 400/800 hardware reset line - the Reset key is only an NMI source.
	machine.write(0xd302, 0x3c, ReadOptions.NONE); // PACTL: CA2 manual high, data register
	machine.write(0xd300, 0xa5, ReadOptions.NONE); // PORTA output latch

	const panel = machine.console;
	panel.reset = true;
	expect(machine.anticGtia.rnmi).toBe(true);
	expect(machine.resetAsserted).toBe(false);

	panel.reset = false;
	expect(machine.anticGtia.rnmi).toBe(false);
	expect(machine.read(0xd302, ReadOptions.NONE)).toBe(0x3c);
});

test("the XL Reset button resets components and holds the reset line", () => {
	const machine = makeMachine("800XL");
	machine.write(NMIEN, 0xc0, ReadOptions.NONE);
	expect(machine.anticGtia.vbiEnabled).toBe(true);

	// Bank the OS ROM out (DDRB all outputs, then PORTB bit 0 low) and put a
	// marker in the RAM underneath.
	machine.write(0xd303, 0x00, ReadOptions.NONE);
	machine.write(0xd301, 0xff, ReadOptions.NONE);
	machine.write(0xd303, 0x04, ReadOptions.NONE);
	machine.write(0xd301, 0xfe, ReadOptions.NONE);
	machine.write(0xe000, 0x55, ReadOptions.NONE);
	expect(machine.read(0xe000, ReadOptions.NONE)).toBe(0x55);

	const panel = machine.console;
	panel.reset = true;
	expect(machine.resetAsserted).toBe(true);
	expect(machine.anticGtia.rnmi).toBe(false);
	// ANTIC sits on the system reset line.
	expect(machine.anticGtia.vbiEnabled).toBe(false);
	// So does the PIA: PORTB floats back to all-inputs ($FF), banking the OS
	// ROM back in over the marker. The RAM itself survives the warm reset.
	expect(machine.read(0xe000, ReadOptions.NONE)).toBe(0x00);

	panel.reset = false;
	expect(machine.resetAsserted).toBe(false);
});

test("console keys drive the CONSOL register (active low)", () => {
	const machine = makeMachine("800");
	const CONSOL = 0xd01f;
	// Release the power-on written latch first, like the OS does.
	machine.write(CONSOL, 0x08, ReadOptions.NONE);
	expect(machine.read(CONSOL, ReadOptions.NONE)).toBe(7);

	const panel = machine.console;
	panel.option = true;
	panel.start = true;
	expect(machine.read(CONSOL, ReadOptions.NONE)).toBe(2);

	panel.option = false;
	expect(machine.read(CONSOL, ReadOptions.NONE)).toBe(6);
});

test("a matrix key reaches POKEY through the machine's scan", () => {
	const machine = makeMachine("800");
	enableScan(machine);
	machine.write(IRQEN_IRQST, 0x40, ReadOptions.NONE);

	machine.keyboard.pressKey(0x3f);
	runScan(machine);
	expect(machine.irq).toBe(true);
	expect(machine.read(KBCODE, ReadOptions.NONE)).toBe(0x3f);
	expect(machine.read(SKSTAT_SKCTL, ReadOptions.NONE) & 0x04).toBe(0);

	machine.keyboard.releaseKey(0x3f);
	runScan(machine);
	expect(machine.read(SKSTAT_SKCTL, ReadOptions.NONE) & 0x04).toBe(0x04);
	// KBCODE holds the last key, like hardware.
	expect(machine.read(KBCODE, ReadOptions.NONE)).toBe(0x3f);
});

test("the meta lines compose KBCODE and drive the senses", () => {
	const machine = makeMachine("800");
	enableScan(machine);

	// Shift held: the SKSTAT sense follows the line...
	machine.keyboard.pressMetaKey(KEYBOARD_LINES.SHIFT);
	runScan(machine);
	expect(machine.read(SKSTAT_SKCTL, ReadOptions.NONE) & 0x08).toBe(0);

	// ...and a key pressed while it's down scans with bit 6 set.
	machine.keyboard.pressKey(0x3f);
	runScan(machine);
	expect(machine.read(KBCODE, ReadOptions.NONE)).toBe(0x7f);
	machine.keyboard.releaseAll();
	runScan(machine);

	// Control composes bit 7.
	machine.keyboard.pressMetaKey(KEYBOARD_LINES.CONTROL);
	machine.keyboard.pressKey(0x3f);
	runScan(machine);
	expect(machine.read(KBCODE, ReadOptions.NONE)).toBe(0xbf);
});

test("three keys on a rectangle phantom the fourth corner", () => {
	const keyboard = new Keyboard();

	// Keys at (line 0, sense 0), (line 0, sense 1), (line 1, sense 0):
	// current sneaks through them to close (line 1, sense 1) = code $09.
	keyboard.pressKey(0x00);
	keyboard.pressKey(0x01);
	keyboard.pressKey(0x08);

	keyboard.scan(0x09);
	expect(keyboard.KR1).toBe(true);

	keyboard.releaseKey(0x01);
	keyboard.scan(0x09);
	expect(keyboard.KR1).toBe(false);
});

test("releaseAll clears keys and meta lines - the focus-loss backstop", () => {
	const machine = makeMachine("800");
	enableScan(machine);
	machine.keyboard.pressKey(0x3f);
	machine.keyboard.pressMetaKey(KEYBOARD_LINES.SHIFT);
	runScan(machine);
	expect(machine.read(SKSTAT_SKCTL, ReadOptions.NONE) & 0x0c).toBe(0);

	machine.keyboard.releaseAll();
	runScan(machine);
	expect(machine.read(SKSTAT_SKCTL, ReadOptions.NONE) & 0x0c).toBe(0x0c);
});

test("a held key survives a power cycle and re-latches once scanning resumes", () => {
	const machine = makeMachine("800XL");
	enableScan(machine);
	machine.keyboard.pressKey(0x3f);
	runScan(machine);
	expect(machine.read(SKSTAT_SKCTL, ReadOptions.NONE) & 0x04).toBe(0);

	// The cold reset clears POKEY (SKCTL included - the scan stops until
	// re-enabled, as the OS boot would). The finger is still on the key:
	// once the scan runs again, it re-latches.
	machine.console.powerCycle();
	expect(machine.read(SKSTAT_SKCTL, ReadOptions.NONE) & 0x04).toBe(0x04);
	enableScan(machine);
	runScan(machine);
	expect(machine.read(SKSTAT_SKCTL, ReadOptions.NONE) & 0x04).toBe(0);
	expect(machine.read(KBCODE, ReadOptions.NONE)).toBe(0x3f);
});

test("a detached keyboard sends no response; reattaching restores it", () => {
	const machine = makeMachine("800");
	enableScan(machine);

	// Held and registered, then unplugged: the scan finds the matrix gone
	// and releases the key sense (KBCODE keeps the last latch, as ever).
	machine.keyboard.pressKey(0x3f);
	runScan(machine);
	expect(machine.read(SKSTAT_SKCTL, ReadOptions.NONE) & 0x04).toBe(0);

	machine.keyboard.attached.value = false;
	runScan(machine);
	expect(machine.read(SKSTAT_SKCTL, ReadOptions.NONE) & 0x04).toBe(0x04);

	// Still held behind the unplugged cable: reattaching re-latches it.
	machine.keyboard.attached.value = true;
	runScan(machine);
	expect(machine.read(SKSTAT_SKCTL, ReadOptions.NONE) & 0x04).toBe(0);
});

test("keyboardSense wires the presence line to TRIG2 on the XEGS", () => {
	const TRIG2 = 0xd012;
	const xegs = new Atari({
		xl: true,
		os: new Uint8Array(16384),
		keyboardSense: true,
	});
	expect(xegs.read(TRIG2, ReadOptions.NONE)).toBe(1);

	xegs.keyboard.attached.value = false;
	expect(xegs.read(TRIG2, ReadOptions.NONE)).toBe(0);
	xegs.keyboard.attached.value = true;
	expect(xegs.read(TRIG2, ReadOptions.NONE)).toBe(1);

	// The other XL/XE leave T2 disconnected: detaching changes nothing.
	const xl = makeMachine("800XL");
	xl.keyboard.attached.value = false;
	expect(xl.read(TRIG2, ReadOptions.NONE)).toBe(1);

	// And without xl the option is ignored - T2 is joystick 2's trigger.
	const early = new Atari({ os: new Uint8Array(10240), keyboardSense: true });
	early.keyboard.attached.value = false;
	expect(early.read(TRIG2, ReadOptions.NONE)).toBe(1);
});
