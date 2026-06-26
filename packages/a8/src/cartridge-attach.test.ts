import { expect, test } from "vitest";
import { ReadOptions } from "@sfotty-pie/sfotty";
import { Cartridge } from "./cartridge.ts";
import { Atari } from "./machine.ts";

// A standard 8K $A000 cartridge: init address $A000, start unused.
function makeCart(marker: number) {
	const rom = new Uint8Array(8192);
	rom[0] = marker;
	rom[8191] = 0xa0;
	return new Cartridge(rom);
}

function makeMachine(model: "800" | "800XL" | "130XE", cartridge?: Cartridge) {
	const basic = new Uint8Array(8192);
	basic[0] = 0xbb; // marker to tell BASIC from a game cart
	basic[8191] = 0xa0;

	return new Atari({
		xl: model !== "800",
		...(model === "130XE" && { xeBankCount: 4, separateAnticAccess: true }),
		os: new Uint8Array(model === "800" ? 10240 : 16384),
		basic,
		cartridge,
	});
}

test("a cartridge takes the 800's BASIC slot", () => {
	const bare = makeMachine("800");
	expect(bare.read(0xa000, ReadOptions.NONE)).toBe(0xbb);

	const machine = makeMachine("800", makeCart(0x42));
	expect(machine.read(0xa000, ReadOptions.NONE)).toBe(0x42);
});

test("the 800's cartridge slot can be left empty", () => {
	const machine = new Atari({ os: new Uint8Array(10240) });
	expect(machine.read(0xa000, ReadOptions.NONE)).toBe(0x00); // RAM
});

test("a cartridge shadows the XL's built-in BASIC", () => {
	const machine = makeMachine("800XL", makeCart(0x42));

	// Bank BASIC in like the OS does (DDRB all outputs, PORTB bit 1 low) —
	// the cartridge still wins at $A000.
	machine.write(0xd303, 0x00, ReadOptions.NONE);
	machine.write(0xd301, 0xff, ReadOptions.NONE);
	machine.write(0xd303, 0x04, ReadOptions.NONE);
	machine.write(0xd301, 0xfd, ReadOptions.NONE);
	expect(machine.read(0xa000, ReadOptions.NONE)).toBe(0x42);
});
