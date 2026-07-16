import { expect, test } from "vitest";
import { ReadOptions } from "@sfotty-pie/sfotty";
import { createCartridge, type Cartridge } from "./cartridge.ts";
import { Atari } from "./machine.ts";

// A standard 8K $A000 cartridge: init address $A000, start unused.
function makeCart(marker: number) {
	const rom = new Uint8Array(8192);
	rom[0] = marker;
	rom[8191] = 0xa0;
	return createCartridge(rom);
}

// A right-slot cartridge as a .car image (type 21 = 8K at $8000, type 59 =
// 4K at $9000) - raw bytes would need boot vectors to detect as right-slot.
function makeRightCart(marker: number, type: 21 | 59 = 21) {
	const rom = new Uint8Array(type === 21 ? 8192 : 4096);
	rom[0] = marker;
	const car = new Uint8Array(16 + rom.length);
	car.set([0x43, 0x41, 0x52, 0x54]); // "CART"
	car[7] = type;
	car.set(rom, 16);
	return createCartridge(car);
}

function makeMachine(model: "800" | "800XL" | "130XE", cartridge?: Cartridge) {
	const basic = new Uint8Array(8192);
	basic[0] = 0xbb; // marker to tell BASIC from a game cart
	basic[8191] = 0xa0;

	const machine = new Atari({
		xl: model !== "800",
		...(model === "130XE" && { xeBankCount: 4, separateAnticAccess: true }),
		os: new Uint8Array(model === "800" ? 10240 : 16384),
		basic,
	});
	if (cartridge) machine.cartridge = cartridge;
	return machine;
}

test("on the 800, BASIC is a cartridge the host attaches and swaps", () => {
	// `basic` in the config is XL/XE-only; a bare 800 slot is empty (RAM).
	const bare = makeMachine("800");
	expect(bare.mmu.read(0xa000, ReadOptions.NONE)).toBe(0x00);

	// BASIC goes in like any $A000 cart...
	const basicCart = new Uint8Array(8192);
	basicCart[0] = 0xbb;
	basicCart[8191] = 0xa0;
	const machine = makeMachine("800", createCartridge(basicCart));
	expect(machine.mmu.read(0xa000, ReadOptions.NONE)).toBe(0xbb);

	// ...and a game cart displaces it.
	machine.cartridge = makeCart(0x42);
	expect(machine.mmu.read(0xa000, ReadOptions.NONE)).toBe(0x42);
});

test("the 800's cartridge slot can be left empty", () => {
	const machine = new Atari({ os: new Uint8Array(10240) });
	expect(machine.mmu.read(0xa000, ReadOptions.NONE)).toBe(0x00); // RAM
});

test("a right-slot cartridge sits alongside the normal slot", () => {
	const machine = makeMachine("800", makeCart(0x42));
	expect(machine.mmu.read(0x8000, ReadOptions.NONE)).toBe(0x00); // RAM

	machine.rightCartridge = makeRightCart(0x51);
	expect(machine.mmu.read(0x8000, ReadOptions.NONE)).toBe(0x51);
	expect(machine.mmu.read(0xa000, ReadOptions.NONE)).toBe(0x42); // left cart

	machine.rightCartridge = undefined;
	expect(machine.mmu.read(0x8000, ReadOptions.NONE)).toBe(0x00); // RAM again
});

test("the right slot wins $8000-$9FFF over a 16K left cartridge", () => {
	// A 16K left cart fills $8000-$BFFF; its lower half loses to the right
	// slot while a right cart is in, and comes back when it's pulled.
	const rom = new Uint8Array(16384);
	rom[0] = 0x88;
	rom[8192] = 0xaa;
	rom[16383] = 0xa0; // init vector high byte, for the raw-16K detection
	const machine = makeMachine("800", createCartridge(rom));
	expect(machine.mmu.read(0x8000, ReadOptions.NONE)).toBe(0x88);

	machine.rightCartridge = makeRightCart(0x51);
	expect(machine.mmu.read(0x8000, ReadOptions.NONE)).toBe(0x51);
	expect(machine.mmu.read(0xa000, ReadOptions.NONE)).toBe(0xaa);

	machine.rightCartridge = undefined;
	expect(machine.mmu.read(0x8000, ReadOptions.NONE)).toBe(0x88);
});

test("a right-slot 4K cartridge decodes $9000-$9FFF only", () => {
	const machine = makeMachine("800");
	machine.rightCartridge = makeRightCart(0x51, 59);
	expect(machine.mmu.read(0x9000, ReadOptions.NONE)).toBe(0x51);
	// The chip doesn't decode A12 low: $8000-$8FFF is undriven, $FF pull-up.
	expect(machine.mmu.read(0x8000, ReadOptions.NONE)).toBe(0xff);
});

test("images advertise which slot they belong in", () => {
	expect(makeRightCart(0x00).rightSlot).toBe(true);
	expect(makeRightCart(0x00, 59).rightSlot).toBe(true);
	expect(makeCart(0x00).rightSlot).toBe(false);
});

test("a cartridge shadows the XL's built-in BASIC", () => {
	const machine = makeMachine("800XL", makeCart(0x42));

	// Bank BASIC in like the OS does (DDRB all outputs, PORTB bit 1 low) -
	// the cartridge still wins at $A000.
	machine.mmu.write(0xd303, 0x00, ReadOptions.NONE);
	machine.mmu.write(0xd301, 0xff, ReadOptions.NONE);
	machine.mmu.write(0xd303, 0x04, ReadOptions.NONE);
	machine.mmu.write(0xd301, 0xfd, ReadOptions.NONE);
	expect(machine.mmu.read(0xa000, ReadOptions.NONE)).toBe(0x42);
});
