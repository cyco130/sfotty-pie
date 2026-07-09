import { expect, test } from "vitest";
import { ReadOptions } from "@sfotty-pie/sfotty";
import { createCartridge } from "./cartridge.ts";
import { Atari } from "./machine.ts";

// An Atarimax 1MB (CART type 42) image: 128 x 8K banks at A000-BFFF, the bank
// selected by the value written to $D500-$D57F, bit 7 disabling the cart.
// Each bank's first byte is its bank number so reads identify the mapping.
function atarimaxCar(): Uint8Array {
	const car = new Uint8Array(16 + 1024 * 1024);
	car.set([0x43, 0x41, 0x52, 0x54]); // "CART"
	car[7] = 42; // type, big-endian
	for (let bank = 0; bank < 128; bank++) {
		car[16 + bank * 8192] = bank;
	}
	return car;
}

test("a cartridge bank switch remaps A000 reads immediately", () => {
	const machine = new Atari({
		xl: true,
		os: new Uint8Array(16384),
		cartridge: createCartridge(atarimaxCar(), "test.car"),
	});

	// Powers up with bank 127 mapped.
	expect(machine.read(0xa000, ReadOptions.NONE)).toBe(127);

	// A write to the control region selects the bank by value.
	machine.write(0xd500, 5, ReadOptions.NONE);
	expect(machine.read(0xa000, ReadOptions.NONE)).toBe(5);
	expect(machine.read(0xa000, ReadOptions.DMA)).toBe(5);

	// Bit 7 disables the cartridge: RAM shows through.
	machine.write(0xd500, 0x80, ReadOptions.NONE);
	machine.write(0xa000, 0x99, ReadOptions.NONE);
	expect(machine.read(0xa000, ReadOptions.NONE)).toBe(0x99);

	// Re-enabling maps the ROM back over the RAM.
	machine.write(0xd500, 3, ReadOptions.NONE);
	expect(machine.read(0xa000, ReadOptions.NONE)).toBe(3);
});
