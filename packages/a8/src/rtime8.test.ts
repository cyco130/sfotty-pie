import { describe, expect, it } from "vitest";
import { ReadOptions } from "@sfotty-pie/sfotty";
import {
	CART_TYPES,
	cartTypeHasD5b8ToD5bf,
	createCartridge,
} from "./cartridge.ts";
import { Atari } from "./machine.ts";
import { Rtime8Cartridge } from "./rtime8.ts";

const NONE = ReadOptions.NONE;
const PORT = 0xd5b8;

// A .car image of the given type (contents all zero - fine for these tests).
function car(type: number, sizeKB: number): Uint8Array {
	const image = new Uint8Array(16 + sizeKB * 1024);
	image.set([0x43, 0x41, 0x52, 0x54]); // "CART"
	image[6] = (type >> 8) & 0xff;
	image[7] = type & 0xff;
	return image;
}

// Wednesday 2026-07-15 13:45:23 local - ISO weekday 3, ISO week 29.
const WEDNESDAY = new Date(2026, 6, 15, 13, 45, 23);

function clock(date = WEDNESDAY): Rtime8Cartridge {
	return new Rtime8Cartridge(undefined, { now: () => date });
}

// Run the read sequence for a location: write its number, read the two
// data nibbles.
function readLocation(rtc: Rtime8Cartridge, location: number): number {
	rtc.write(PORT, location, NONE);
	const high = rtc.read(PORT, NONE) & 0x0f;
	const low = rtc.read(PORT, NONE) & 0x0f;
	return (high << 4) | low;
}

// Run the write sequence: location number, then the byte's two nibbles.
function writeLocation(
	rtc: Rtime8Cartridge,
	location: number,
	byte: number,
): void {
	rtc.write(PORT, location, NONE);
	rtc.write(PORT, byte >> 4, NONE);
	rtc.write(PORT, byte & 0x0f, NONE);
}

describe("the M3002 port", () => {
	it("serves the injected time in BCD", () => {
		const rtc = clock();
		expect(readLocation(rtc, 0x0)).toBe(0x23); // seconds
		expect(readLocation(rtc, 0x1)).toBe(0x45); // minutes
		expect(readLocation(rtc, 0x2)).toBe(0x13); // hours
		expect(readLocation(rtc, 0x3)).toBe(0x15); // day
		expect(readLocation(rtc, 0x4)).toBe(0x07); // month
		expect(readLocation(rtc, 0x5)).toBe(0x26); // year
		expect(readLocation(rtc, 0x6)).toBe(0x03); // weekday (ISO, Wednesday)
		expect(readLocation(rtc, 0x7)).toBe(0x29); // ISO week
	});

	it("reads the RAM locations back as 0 until written", () => {
		expect(readLocation(clock(), 0x8)).toBe(0x00);
		expect(readLocation(clock(), 0xf)).toBe(0x00);
	});

	it("stores writes to the RAM locations - SpartaDOS detects by this", () => {
		const rtc = clock();
		// The 3.2g resident driver's probe: control := $01, $7 := a scratch
		// value, then read $7 back and compare.
		writeLocation(rtc, 0xf, 0x01);
		writeLocation(rtc, 0x7, 0x04);
		expect(readLocation(rtc, 0x7)).toBe(0x04);
		expect(readLocation(rtc, 0xf)).toBe(0x01);
		// Until written, $7 serves the live ISO week (see the table test).
	});

	it("drives only the low nibble; the top four bits read as pull-ups", () => {
		const rtc = clock();
		expect(rtc.read(PORT, NONE)).toBe(0xf0); // status: idle
		rtc.write(PORT, 0x1, NONE); // minutes = 45
		expect(rtc.read(PORT, NONE)).toBe(0xf4);
		expect(rtc.read(PORT, NONE)).toBe(0xf5);
	});

	it("mirrors the port across $D5B8-$D5BF", () => {
		const rtc = clock();
		rtc.write(0xd5bf, 0x2, NONE); // hours = 13
		expect(rtc.read(0xd5bb, NONE) & 0x0f).toBe(1);
		expect(rtc.read(0xd5be, NONE) & 0x0f).toBe(3);
	});

	it("resyncs to idle on two dummy reads from any sequence step", () => {
		const rtc = clock();
		rtc.write(PORT, 0x3, NONE); // mid-sequence: data nibbles pending
		rtc.read(PORT, NONE);
		rtc.read(PORT, NONE);
		expect(rtc.read(PORT, NONE)).toBe(0xf0); // status again: idle
		expect(readLocation(rtc, 0x4)).toBe(0x07); // and sequences still work
	});

	it("latches the byte at the first data read - nibbles can't tear", () => {
		let seconds = 9;
		const rtc = new Rtime8Cartridge(undefined, {
			now: () => new Date(2026, 6, 15, 13, 45, seconds),
		});
		rtc.write(PORT, 0x0, NONE);
		expect(rtc.read(PORT, NONE) & 0x0f).toBe(0); // latches :09, serves 0
		seconds = 10; // the clock ticks between the nibbles
		expect(rtc.read(PORT, NONE) & 0x0f).toBe(9); // still :09, not :10's 0
	});

	it("keeps time read-only: writes to $0-$6 are consumed but dropped", () => {
		const rtc = clock();
		writeLocation(rtc, 0x2, 0x09); // "set hours to 9"
		expect(rtc.read(PORT, NONE)).toBe(0xf0); // sequence done, back to idle
		expect(readLocation(rtc, 0x2)).toBe(0x13); // hours still follow now()
	});

	it("PEEK reads the pending nibble without advancing the sequence", () => {
		const rtc = clock();
		rtc.write(PORT, 0x1, NONE);
		expect(rtc.read(PORT, ReadOptions.PEEK) & 0x0f).toBe(4);
		expect(rtc.read(PORT, NONE) & 0x0f).toBe(4); // still the high nibble
		expect(rtc.read(PORT, NONE) & 0x0f).toBe(5);
	});

	it("shifts the served time by offsetMs", () => {
		const rtc = clock();
		rtc.offsetMs = 24 * 60 * 60 * 1000;
		expect(readLocation(rtc, 0x3)).toBe(0x16); // day 15 -> 16
		expect(readLocation(rtc, 0x6)).toBe(0x04); // Wednesday -> Thursday
	});
});

describe("the passthrough slot", () => {
	it("stands in for an empty slot: no ROM areas, CCTL reads $FF", () => {
		const rtc = clock();
		expect(rtc.has8000To9fff).toBe(false);
		expect(rtc.hasA000ToBfff).toBe(false);
		expect(rtc.read(0xd500, NONE)).toBe(0xff);
		expect(rtc.rtcActive).toBe(true);
	});

	it("forwards everything but the port to a compatible cartridge", () => {
		const inner = createCartridge(car(1, 8)); // standard 8K
		const rtc = new Rtime8Cartridge(inner, { now: () => WEDNESDAY });
		expect(rtc.rtcActive).toBe(true);
		expect(rtc.hasA000ToBfff).toBe(true);
		expect(rtc.mappingChanged).toBe(inner.mappingChanged);
		expect(rtc.read(0xa000, NONE)).toBe(inner.read(0xa000, NONE));
		expect(rtc.read(0xd500, NONE)).toBe(0xff); // inner's CCTL answer
		expect(readLocation(rtc, 0x4)).toBe(0x07); // the clock answers its port
	});

	it("answers through the machine's $D5 page; empty slot senses as none", () => {
		const machine = new Atari({ xl: true, os: new Uint8Array(16384) });
		machine.cartridge = new Rtime8Cartridge(undefined, {
			now: () => WEDNESDAY,
		});
		machine.mmu.write(0xd5b8, 0x2, NONE); // hours = 13
		expect(machine.mmu.read(0xd5b8, NONE)).toBe(0xf1);
		expect(machine.mmu.read(0xd5b8, NONE)).toBe(0xf3);
		// A clock with an empty slot doesn't assert RD5: no cartridge sense.
		expect(machine.anticGtia.trig3).toBe(0);
	});

	it("goes transparent over a cartridge that decodes the port range", () => {
		const inner = createCartridge(car(8, 64)); // Williams: whole-page decode
		const rtc = new Rtime8Cartridge(inner, { now: () => WEDNESDAY });
		expect(rtc.rtcActive).toBe(false);
		// The port access reaches the cartridge: $D5B8 has A3 set, which
		// disables a Williams board - exactly the conflict being modeled.
		expect(inner.hasA000ToBfff).toBe(true);
		rtc.read(PORT, NONE);
		expect(inner.hasA000ToBfff).toBe(false);
	});

	it("portShield keeps the clock active and hides the port from the cart", () => {
		const inner = createCartridge(car(8, 64)); // Williams
		const rtc = new Rtime8Cartridge(inner, {
			now: () => WEDNESDAY,
			portShield: true,
		});
		expect(rtc.rtcActive).toBe(true);
		// A full clock transaction leaves the Williams board untouched...
		expect(readLocation(rtc, 0x4)).toBe(0x07);
		expect(inner.hasA000ToBfff).toBe(true);
		// ...while the rest of the CCTL page still reaches it.
		rtc.read(0xd508, NONE); // A3 set: disable
		expect(inner.hasA000ToBfff).toBe(false);
	});

	it("portShield: SDX-on-Atarimax survives its clock driver's writes", () => {
		// Atarimax 1MB disables on any A7-set write - which every clock
		// transaction's opening location write is. Shielded, the driver can
		// run its whole protocol without knocking the cartridge ROM out.
		const inner = createCartridge(car(42, 1024));
		const rtc = new Rtime8Cartridge(inner, {
			now: () => WEDNESDAY,
			portShield: true,
		});
		writeLocation(rtc, 0xf, 0x01); // the SpartaDOS probe
		writeLocation(rtc, 0x7, 0x04);
		expect(readLocation(rtc, 0x7)).toBe(0x04);
		expect(inner.hasA000ToBfff).toBe(true); // still mapped
		rtc.write(0xd580, 0, NONE); // the software's own disable alias works
		expect(inner.hasA000ToBfff).toBe(false);
	});

	it("portShield toggles live", () => {
		const inner = createCartridge(car(8, 64)); // Williams
		const rtc = new Rtime8Cartridge(inner, { now: () => WEDNESDAY });
		expect(rtc.rtcActive).toBe(false);
		rtc.portShield = true;
		expect(rtc.rtcActive).toBe(true);
		expect(readLocation(rtc, 0x4)).toBe(0x07);
	});
});

describe("cartTypeHasD5b8ToD5bf", () => {
	// Hand-derived from each type's decode in CART_TYPES: whole-page and
	// value-selected schemes (OSS, XEGS, MegaCart, Williams, Turbosoft,
	// Atrax, Atarimax 1MB, JCart, XE Multicart, sequence carts, AST, DCart,
	// MegaMax, DB, Phoenix/Blizzard) conflict; address-windowed schemes
	// that stay clear of $D5B8-$D5BF (SDX/Express/Diamond, Atarimax 128K,
	// SIC!, The!Cart, Flash MegaCart, MIO, JRC64) don't. Unsupported types
	// probe false - they can't attach. NOTE: JRC64's optional RAM-disk
	// registers at $D580-$D5FF aren't emulated; the physical board would
	// conflict.
	const INCOMPATIBLE = new Set([
		3, 5, 8, 12, 13, 14, 15, 17, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33,
		34, 35, 36, 37, 38, 39, 40, 42, 44, 45, 46, 47, 50, 51, 52, 60, 61, 64, 67,
		68, 69, 70, 75, 76, 86, 87, 88, 89, 90, 91, 92, 93, 104, 105, 106, 107, 108,
		109, 110, 111, 112,
	]);

	it("classifies every CART type", () => {
		for (const [key, type] of Object.entries(CART_TYPES)) {
			expect
				.soft(cartTypeHasD5b8ToD5bf(type), `type ${key} (${type.name})`)
				.toBe(INCOMPATIBLE.has(Number(key)));
		}
	});
});
