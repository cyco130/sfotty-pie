import { expect, test } from "vitest";
import { ReadOptions } from "@sfotty-pie/sfotty";
import { createCartridge } from "./cartridge.ts";
import { Atari } from "./machine.ts";

// A .car image of the given type; the caller stamps identifying bytes.
function car(type: number, sizeKB: number): Uint8Array {
	const image = new Uint8Array(16 + sizeKB * 1024);
	image.set([0x43, 0x41, 0x52, 0x54]); // "CART"
	image[6] = (type >> 8) & 0xff;
	image[7] = type & 0xff;
	return image;
}

// Stamp the first byte of every 8K bank with its bank number.
function stamp8k(image: Uint8Array): Uint8Array {
	for (let bank = 0; bank * 8192 < image.length - 16; bank++) {
		image[16 + bank * 8192] = bank;
	}
	return image;
}

const NONE = ReadOptions.NONE;

test("Atarimax 1MB (42): the written address selects the bank, through the machine", () => {
	const machine = new Atari({
		xl: true,
		os: new Uint8Array(16384),
	});
	machine.cartridge = createCartridge(stamp8k(car(42, 1024)), "test.car");

	// Powers up with bank 127 mapped.
	expect(machine.mmu.read(0xa000, NONE)).toBe(127);

	// Writing to $D500+n selects bank n (the value is irrelevant).
	machine.mmu.write(0xd505, 0xea, NONE);
	expect(machine.mmu.read(0xa000, NONE)).toBe(5);
	expect(machine.mmu.read(0xa000, ReadOptions.DMA)).toBe(5);

	// A write with address bit 7 set ($D580+) disables: RAM shows through.
	machine.mmu.write(0xd580, 0, NONE);
	machine.mmu.write(0xa000, 0x99, NONE);
	expect(machine.mmu.read(0xa000, NONE)).toBe(0x99);

	// Re-enabling maps the ROM back over the RAM.
	machine.mmu.write(0xd503, 0, NONE);
	expect(machine.mmu.read(0xa000, NONE)).toBe(3);
});

test("XEGS 32 (12): value-selected $8000 bank, last bank fixed at $A000", () => {
	const cart = createCartridge(stamp8k(car(12, 32)), "test.car");

	expect(cart.read(0x8000, NONE)).toBe(0);
	expect(cart.read(0xa000, NONE)).toBe(3);

	cart.write(0xd5ab, 2, NONE); // any control address; low value bits select
	expect(cart.read(0x8000, NONE)).toBe(2);
	expect(cart.read(0xa000, NONE)).toBe(3);
});

test("Williams 64 (8): access-switched banks, and PEEK doesn't switch", () => {
	const cart = createCartridge(stamp8k(car(8, 64)), "test.car");

	// A *read* of $D502 switches to bank 2 (access-triggered).
	cart.read(0xd502, NONE);
	expect(cart.read(0xa000, NONE)).toBe(2);

	// Address bit 3 disables.
	cart.read(0xd508, NONE);
	expect(cart.hasA000ToBfff).toBe(false);

	// A PEEK of the control region must not bank-switch.
	cart.read(0xd502, ReadOptions.PEEK);
	expect(cart.hasA000ToBfff).toBe(false);
});

test("OSS 034M (3): fixed $B000 bank, AND'ed dual-bank states", () => {
	const image = car(3, 16);
	image[16 + 0 * 4096] = 0b1100; // bank 0
	image[16 + 1 * 4096] = 0b1010; // bank 1
	image[16 + 2 * 4096] = 0b1001; // bank 2
	image[16 + 3 * 4096] = 0b0011; // bank 3 (fixed at $B000)
	const cart = createCartridge(image, "test.car");

	expect(cart.read(0xa000, NONE)).toBe(0b1100);
	expect(cart.read(0xb000, NONE)).toBe(0b0011);

	// $D5x1 drives banks 0 and 1 together; the bus sees the AND.
	cart.read(0xd501, NONE);
	expect(cart.read(0xa000, NONE)).toBe(0b1000);

	// $D5x2 turns the $A000 window off ($FF) but $B000 stays.
	cart.read(0xd502, NONE);
	expect(cart.read(0xa000, NONE)).toBe(0xff);
	expect(cart.read(0xb000, NONE)).toBe(0b0011);

	// $D5x8 disables the whole cartridge.
	cart.read(0xd508, NONE);
	expect(cart.hasA000ToBfff).toBe(false);
});

test("SIC! 128 (54): independent 8K halves and a readable register", () => {
	const image = car(54, 128);
	for (let sub = 0; sub < 16; sub++) {
		image[16 + sub * 8192] = sub; // stamp 8K subbanks
	}
	const cart = createCartridge(image, "test.car");

	// Default register 0: 16K bank 0's upper subbank at $A000 only.
	expect(cart.has8000To9fff).toBe(false);
	expect(cart.read(0xa000, NONE)).toBe(1);

	// Bank 5 with both halves: bit 5 enables $8000, bit 6 clear keeps $A000.
	cart.write(0xd500, 0x25, NONE);
	expect(cart.read(0x8000, NONE)).toBe(10);
	expect(cart.read(0xa000, NONE)).toBe(11);

	// The register reads back exactly as written, anywhere in its window.
	expect(cart.read(0xd51f, NONE)).toBe(0x25);

	// $40 switches the cartridge off; the register still reads back.
	cart.write(0xd51f, 0x40, NONE);
	expect(cart.has8000To9fff).toBe(false);
	expect(cart.hasA000ToBfff).toBe(false);
	expect(cart.read(0xd500, NONE)).toBe(0x40);
});

test("Ultracart (52): accesses cycle the banks through off and around", () => {
	const cart = createCartridge(stamp8k(car(52, 32)), "test.car");

	expect(cart.read(0xa000, NONE)).toBe(0);
	cart.read(0xd500, NONE);
	expect(cart.read(0xa000, NONE)).toBe(1);
	cart.read(0xd500, NONE);
	cart.read(0xd500, NONE);
	expect(cart.read(0xa000, NONE)).toBe(3);
	cart.read(0xd500, NONE); // -> disabled
	expect(cart.hasA000ToBfff).toBe(false);
	cart.read(0xd500, NONE); // -> wraps to bank 0
	expect(cart.read(0xa000, NONE)).toBe(0);
});

test("Atrax 128 (68): the scrambled dump decodes to the type-17 layout", () => {
	// Build a scrambled image from a known decoded pattern by inverting the
	// pin tables (cart.txt): dump[S(L)] gets the decoded byte with its bits
	// routed through the data map.
	const ADDR = [5, 6, 7, 12, 0, 1, 2, 3, 4, 8, 10, 11, 9, 13, 14, 15, 16];
	const DATA = [5, 6, 2, 4, 0, 1, 7, 3];
	const decodedByte = (address: number) => (address * 7 + 3) & 0xff;

	const image = car(68, 128);
	const dump = image.subarray(16);
	for (let address = 0; address < dump.length; address++) {
		let scrambled = 0;
		for (let bit = 0; bit < ADDR.length; bit++) {
			if (address & (1 << bit)) scrambled |= 1 << ADDR[bit]!;
		}
		let byte = 0;
		for (let bit = 0; bit < 8; bit++) {
			if (decodedByte(address) & (1 << bit)) byte |= 1 << DATA[bit]!;
		}
		dump[scrambled] = byte;
	}
	const cart = createCartridge(image, "test.car");

	// Bank 0 decodes to the pattern...
	for (const offset of [0, 1, 0x123, 0x1fff]) {
		expect(cart.read(0xa000 + offset, NONE)).toBe(decodedByte(offset));
	}

	// ...and a value-selected bank reads its own slice.
	cart.write(0xd500, 5, NONE);
	expect(cart.read(0xa000, NONE)).toBe(decodedByte(5 * 8192));
});

test("Bounty Bob (18): in-window triggers switch banks, PEEK doesn't", () => {
	// Eight 4K banks + a fixed 8K tail; stamp each 4K bank's first byte.
	const image = car(18, 40);
	for (let bank = 0; bank < 8; bank++) {
		image[16 + bank * 4096] = 0x40 + bank;
	}
	image[16 + 32768] = 0x77; // the fixed $A000 8K
	const machine = new Atari({
		xl: true,
		os: new Uint8Array(16384),
	});
	machine.cartridge = createCartridge(image, "test.car");

	// Power-on: banks 0 and 4, fixed tail.
	expect(machine.mmu.read(0x8000, NONE)).toBe(0x40);
	expect(machine.mmu.read(0x9000, NONE)).toBe(0x44);
	expect(machine.mmu.read(0xa000, NONE)).toBe(0x77);

	// Reading $8FF7 switches the low window to bank 1 (and returns the
	// outgoing bank's byte); the fast page tables must follow.
	machine.mmu.read(0x8ff7, NONE);
	expect(machine.mmu.read(0x8000, NONE)).toBe(0x41);
	expect(machine.mmu.read(0x8000, ReadOptions.DMA)).toBe(0x41);

	// $9FF8 switches the high window to image bank 6.
	machine.mmu.read(0x9ff8, NONE);
	expect(machine.mmu.read(0x9000, NONE)).toBe(0x46);

	// A write access triggers too.
	machine.mmu.write(0x8ff9, 0, NONE);
	expect(machine.mmu.read(0x8000, NONE)).toBe(0x43);

	// A PEEK of a trigger address must not switch.
	machine.mmu.read(0x9ff6, ReadOptions.PEEK);
	expect(machine.mmu.read(0x9000, NONE)).toBe(0x46);
});

test("XL TRIG3 follows the cartridge sense (RD5) live", () => {
	const machine = new Atari({
		xl: true,
		os: new Uint8Array(16384),
	});
	machine.cartridge = createCartridge(stamp8k(car(42, 1024)), "test.car");
	const TRIG3 = 0xd013;
	expect(machine.mmu.read(TRIG3, NONE)).toBe(1);

	// Banking the cartridge out via CCTL drops RD5 - and TRIG3 with it.
	machine.mmu.write(0xd580, 0, NONE);
	expect(machine.mmu.read(TRIG3, NONE)).toBe(0);
	machine.mmu.write(0xd503, 0, NONE);
	expect(machine.mmu.read(TRIG3, NONE)).toBe(1);

	// Pulling the cartridge reads 0; the accessor is the physical swap, so
	// re-inserting the same cart keeps its bank state (still bank 3).
	const cart = machine.cartridge;
	machine.cartridge = undefined;
	expect(machine.mmu.read(TRIG3, NONE)).toBe(0);
	machine.cartridge = cart;
	expect(machine.mmu.read(TRIG3, NONE)).toBe(1);
	expect(machine.mmu.read(0xa000, NONE)).toBe(3);
});
