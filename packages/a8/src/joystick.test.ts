import { expect, test } from "vitest";
import { ReadOptions } from "@sfotty-pie/sfotty";
import { Cartridge } from "./cartridge.ts";
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

test("joystick 0/1 directions drive PORTA, active low", () => {
	const machine = makeMachine("800");
	machine.write(PACTL, 0x04, ReadOptions.NONE);
	expect(machine.read(PORTA, ReadOptions.NONE)).toBe(0xff);

	machine.joystickDown(0, 0x05); // up+left
	machine.joystickDown(1, 0x08); // right
	expect(machine.read(PORTA, ReadOptions.NONE)).toBe(0x7a);

	machine.joystickUp(0, 0x01); // release up, left stays held
	expect(machine.read(PORTA, ReadOptions.NONE)).toBe(0x7b);

	machine.joystickUp(0, 0x04);
	machine.joystickUp(1, 0x08);
	expect(machine.read(PORTA, ReadOptions.NONE)).toBe(0xff);
});

test("the 800 has joysticks 2/3 on PORTB", () => {
	const machine = makeMachine("800");
	machine.write(PBCTL, 0x04, ReadOptions.NONE);

	machine.joystickDown(2, 0x02); // down
	machine.joystickDown(3, 0x01); // up
	expect(machine.read(PORTB, ReadOptions.NONE)).toBe(0xed);
});

test("triggers drive the GTIA TRIG lines", () => {
	const machine = makeMachine("800");
	expect(machine.read(TRIG0, ReadOptions.NONE)).toBe(1);

	machine.joystickTriggerDown(0);
	machine.joystickTriggerDown(2);
	expect(machine.read(TRIG0, ReadOptions.NONE)).toBe(0);
	expect(machine.read(TRIG2, ReadOptions.NONE)).toBe(0);

	machine.joystickTriggerUp(0);
	expect(machine.read(TRIG0, ReadOptions.NONE)).toBe(1);
	expect(machine.read(TRIG2, ReadOptions.NONE)).toBe(0);
});

test("the XL has no ports 2/3", () => {
	const machine = makeMachine("800XL");
	machine.write(PBCTL, 0x04, ReadOptions.NONE);

	machine.joystickDown(2, 0x0f);
	machine.joystickTriggerDown(3);
	expect(machine.read(PORTB, ReadOptions.NONE)).toBe(0xff);
	// TRIG3 is the cartridge sense on XL/XE (0 with no cart), not a trigger,
	// so the joystick-3 press leaves it untouched.
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
		cartridge: new Cartridge(cart),
	});
	expect(withCart.read(TRIG3, ReadOptions.NONE)).toBe(1);
});

test("a stick switch pulls even an output-driven PORTA pin low", () => {
	const machine = makeMachine("800");
	machine.write(PORTA, 0xff, ReadOptions.NONE); // PACTL bit 2 is 0 after power-on: sets DDRA
	machine.write(PACTL, 0x04, ReadOptions.NONE);
	machine.write(PORTA, 0xff, ReadOptions.NONE); // the output latch

	machine.joystickDown(0, 0x01);
	expect(machine.read(PORTA, ReadOptions.NONE)).toBe(0xfe);
});

test("joystick state survives a reset (switches are physical)", () => {
	const machine = makeMachine("800");
	machine.joystickDown(0, 0x08);
	machine.reset(false);
	machine.write(PACTL, 0x04, ReadOptions.NONE);
	expect(machine.read(PORTA, ReadOptions.NONE)).toBe(0xf7);
});
