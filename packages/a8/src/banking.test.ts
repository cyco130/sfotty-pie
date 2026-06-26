import { expect, test } from "vitest";
import { ReadOptions } from "@sfotty-pie/sfotty";
import { Atari } from "./machine.ts";

test("the XL self-test window requires the OS ROM to be enabled", () => {
	const basic = new Uint8Array(8192);
	basic[8191] = 0xa0;
	const machine = new Atari({
		xl: true,
		os: new Uint8Array(16384).fill(0xaa),
		basic,
	});

	// DDRB all outputs, then drive PORTB.
	machine.write(0xd303, 0x00, ReadOptions.NONE);
	machine.write(0xd301, 0xff, ReadOptions.NONE);
	machine.write(0xd303, 0x04, ReadOptions.NONE);

	// Self-test on (bit 7 low) with the OS ROM enabled (bit 0 high).
	machine.write(0xd301, 0x7f, ReadOptions.NONE);
	expect(machine.read(0x5000, ReadOptions.NONE)).toBe(0xaa);

	// With the OS ROM banked out, the self-test vanishes too — it lives on
	// the OS ROM chip. RAM shows through instead.
	machine.write(0xd301, 0x7e, ReadOptions.NONE);
	expect(machine.read(0x5000, ReadOptions.NONE)).toBe(0x00);

	// Self-test off, OS on: RAM again.
	machine.write(0xd301, 0xff, ReadOptions.NONE);
	expect(machine.read(0x5000, ReadOptions.NONE)).toBe(0x00);
});

test("the 130XE separates CPU and ANTIC extended RAM access", () => {
	const basic = new Uint8Array(8192);
	basic[8191] = 0xa0;
	const machine = new Atari({
		xl: true,
		xeBankCount: 4,
		separateAnticAccess: true,
		os: new Uint8Array(16384),
		basic,
	});

	// DDRB all outputs.
	machine.write(0xd303, 0x00, ReadOptions.NONE);
	machine.write(0xd301, 0xff, ReadOptions.NONE);
	machine.write(0xd303, 0x04, ReadOptions.NONE);

	// CPU sees extended bank 0 (bit 4 low, bank bits 2-3 clear), ANTIC sees
	// main RAM (bit 5 high).
	machine.write(0xd301, 0xe3, ReadOptions.NONE);
	machine.write(0x4000, 0x55, ReadOptions.NONE); // lands in extended bank 0
	expect(machine.read(0x4000, ReadOptions.NONE)).toBe(0x55);
	expect(machine.read(0x4000, ReadOptions.DMA)).toBe(0x00); // ANTIC: main

	// Banks are distinct: bank 1 (bit 2 high) is its own RAM.
	machine.write(0xd301, 0xe7, ReadOptions.NONE);
	expect(machine.read(0x4000, ReadOptions.NONE)).toBe(0x00);
	machine.write(0xd301, 0xe3, ReadOptions.NONE);
	expect(machine.read(0x4000, ReadOptions.NONE)).toBe(0x55);

	// Both back to main RAM: the extended write never touched it.
	machine.write(0xd301, 0xff, ReadOptions.NONE);
	expect(machine.read(0x4000, ReadOptions.NONE)).toBe(0x00);

	// ANTIC to extended bank 0 (bit 5 low), CPU to main: the mirror image.
	machine.write(0xd301, 0xd3, ReadOptions.NONE);
	expect(machine.read(0x4000, ReadOptions.DMA)).toBe(0x55);
	expect(machine.read(0x4000, ReadOptions.NONE)).toBe(0x00);
});
