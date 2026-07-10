import { expect, test } from "vitest";
import { ReadOptions } from "@sfotty-pie/sfotty";
import { createCartridge } from "./cartridge.ts";
import { Joystick } from "./joystick.ts";
import { Atari } from "./machine.ts";

const TRIG0 = 0xd010;
const TRIG2 = 0xd012;
const TRIG3 = 0xd013;
const PORTA = 0xd300;
const PORTB = 0xd301;
const PACTL = 0xd302;
const PBCTL = 0xd303;

function makeMachine(model: "800" | "800XL" | "130XE") {
	// On the 800, BASIC goes through cartridge image sniffing: give the dummy
	// ROM a valid $A000 cart trailer (init address $A000, start unused).
	const basic = new Uint8Array(8192);
	basic[8191] = 0xa0;

	return new Atari({
		xl: model !== "800",
		...(model === "130XE" && { xeBankCount: 4, separateAnticAccess: true }),
		os: new Uint8Array(model === "800" ? 10240 : 16384),
		basic,
	});
}

function plugStick(machine: Atari, port: number): Joystick {
	return new Joystick(machine.joysticks[port]!);
}

test("joystick 0/1 directions drive PORTA, active low", () => {
	const machine = makeMachine("800");
	machine.write(PACTL, 0x04, ReadOptions.NONE);
	expect(machine.read(PORTA, ReadOptions.NONE)).toBe(0xff);

	const stick0 = plugStick(machine, 0);
	const stick1 = plugStick(machine, 1);

	stick0.press(0x05); // up+left
	stick1.press(0x08); // right
	expect(machine.read(PORTA, ReadOptions.NONE)).toBe(0x7a);

	stick0.release(0x01); // release up, left stays held
	expect(machine.read(PORTA, ReadOptions.NONE)).toBe(0x7b);

	stick0.release(0x04);
	stick1.release(0x08);
	expect(machine.read(PORTA, ReadOptions.NONE)).toBe(0xff);
});

test("assigning direction replaces the stick position atomically", () => {
	const machine = makeMachine("800");
	machine.write(PACTL, 0x04, ReadOptions.NONE);

	const stick0 = plugStick(machine, 0);
	stick0.direction = 0x09; // up+right
	expect(machine.read(PORTA, ReadOptions.NONE)).toBe(0xf6);
	expect(stick0.direction).toBe(0x09);

	stick0.direction = 0x02; // down only - up+right implicitly released
	expect(machine.read(PORTA, ReadOptions.NONE)).toBe(0xfd);

	stick0.direction = 0;
	expect(machine.read(PORTA, ReadOptions.NONE)).toBe(0xff);
});

test("the 800 has joysticks 2/3 on PORTB", () => {
	const machine = makeMachine("800");
	machine.write(PBCTL, 0x04, ReadOptions.NONE);

	plugStick(machine, 2).press(0x02); // down
	plugStick(machine, 3).press(0x01); // up
	expect(machine.read(PORTB, ReadOptions.NONE)).toBe(0xed);
});

test("triggers drive the GTIA TRIG lines", () => {
	const machine = makeMachine("800");
	expect(machine.read(TRIG0, ReadOptions.NONE)).toBe(1);

	const stick0 = plugStick(machine, 0);
	const stick2 = plugStick(machine, 2);

	stick0.trigger = true;
	stick2.trigger = true;
	expect(machine.read(TRIG0, ReadOptions.NONE)).toBe(0);
	expect(machine.read(TRIG2, ReadOptions.NONE)).toBe(0);

	stick0.trigger = false;
	expect(machine.read(TRIG0, ReadOptions.NONE)).toBe(1);
	expect(machine.read(TRIG2, ReadOptions.NONE)).toBe(0);
});

test("the XL has no ports 2/3", () => {
	const machine = makeMachine("800XL");
	machine.write(PBCTL, 0x04, ReadOptions.NONE);

	expect(machine.joysticks.length).toBe(2);
	expect(machine.joysticks[2]).toBeUndefined();

	// With no connector to press, PORTB stays PIA-driven and TRIG3 stays the
	// cartridge sense (0 with no cart).
	expect(machine.read(PORTB, ReadOptions.NONE)).toBe(0xff);
	expect(machine.read(TRIG3, ReadOptions.NONE)).toBe(0);
});

test("XL/XE TRIG3 senses the cartridge (RD5)", () => {
	expect(makeMachine("800XL").read(TRIG3, ReadOptions.NONE)).toBe(0);

	const cart = new Uint8Array(8192);
	cart[8191] = 0xa0; // valid $A000 cart trailer
	const withCart = new Atari({
		xl: true,
		os: new Uint8Array(16384),
		basic: new Uint8Array(8192),
	});
	withCart.cartridge = createCartridge(cart);
	expect(withCart.read(TRIG3, ReadOptions.NONE)).toBe(1);
});

test("a stick switch pulls even an output-driven PORTA pin low", () => {
	const machine = makeMachine("800");
	machine.write(PORTA, 0xff, ReadOptions.NONE); // PACTL bit 2 is 0 after power-on: sets DDRA
	machine.write(PACTL, 0x04, ReadOptions.NONE);
	machine.write(PORTA, 0xff, ReadOptions.NONE); // the output latch

	plugStick(machine, 0).press(0x01);
	expect(machine.read(PORTA, ReadOptions.NONE)).toBe(0xfe);
});

test("joystick state survives a reset (switches are physical)", () => {
	// The XL, whose Reset key actually resets the components (the 800's is
	// only an NMI source).
	const machine = makeMachine("800XL");
	plugStick(machine, 0).press(0x08);
	machine.console.reset = true;
	machine.console.reset = false;
	machine.write(PACTL, 0x04, ReadOptions.NONE);
	expect(machine.read(PORTA, ReadOptions.NONE)).toBe(0xf7);
});
