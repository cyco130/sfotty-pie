import { describe, expect, it } from "vitest";
import { canonicalize } from "./canonicalize.ts";
import { builtinSlotRom, Cartridge } from "./cartridge.ts";
import { detectFileFormat } from "./detect-file-format.ts";

// Minimal synthetic fixtures that satisfy the structural detectors.

/** An 8K cartridge that detects as raw-cart-8k-a000-bfff (init = $A000). */
function rawCart8kA000(): Uint8Array {
	const cart = new Uint8Array(8192);
	cart[8190] = 0x00; // init address low
	cart[8191] = 0xa0; // init address high → $A000
	return cart;
}

/** An 8K cartridge that detects as raw-cart-8k-8000-9fff (init = $8000). */
function rawCart8k8000(): Uint8Array {
	const cart = new Uint8Array(8192);
	cart[8190] = 0x00;
	cart[8191] = 0x80; // init address $8000
	return cart;
}

/** A 16K cartridge that detects as raw-cart-16k (init = $A000). */
function rawCart16k(): Uint8Array {
	const cart = new Uint8Array(16384);
	cart[16382] = 0x00;
	cart[16383] = 0xa0; // init address $A000
	return cart;
}

/** A 16K blob that satisfies isOsRom (vectors + the $E450 jump table). */
function fakeOsRom16k(): Uint8Array {
	const rom = new Uint8Array(16384);
	const base = 0xc000;
	for (let address = 0xe450; address < 0xe480; address += 3) {
		const offset = address - base;
		rom[offset] = 0x4c; // JMP
		rom[offset + 1] = 0x00;
		rom[offset + 2] = 0xe0; // → $E000
	}
	for (const tail of [6, 4, 2]) {
		rom[16384 - tail] = 0x00;
		rom[16384 - tail + 1] = 0xe0; // interrupt vector → $E000
	}
	return rom;
}

function xegsCombined(): Uint8Array {
	const dump = new Uint8Array(32768);
	dump.set(rawCart8kA000(), 0x0000); // game
	dump.set(rawCart8kA000(), 0x2000); // BASIC
	dump.set(fakeOsRom16k(), 0x4000); // OS
	return dump;
}

// A synthetic ATR: the 16-byte header (magic, paragraph count, sector size)
// over `dataBytes` of zeroed image data. detectFileFormat only needs the magic.
function makeAtr(sectorSize: 128 | 256, dataBytes: number): Uint8Array {
	const atr = new Uint8Array(16 + dataBytes);
	atr[0] = 0x96;
	atr[1] = 0x02; // magic 0x0296
	const paras = dataBytes / 16;
	atr[2] = paras & 0xff;
	atr[3] = (paras >> 8) & 0xff;
	atr[6] = (paras >> 16) & 0xff;
	atr[4] = sectorSize & 0xff;
	atr[5] = (sectorSize >> 8) & 0xff;
	return atr;
}

const CART_MAGIC = [0x43, 0x41, 0x52, 0x54];

describe("canonicalize", () => {
	it("wraps a raw 8K $A000 cart as a type-1 .car the Cartridge can parse", () => {
		const [piece, ...rest] = canonicalize(rawCart8kA000());
		expect(rest).toHaveLength(0);
		expect(piece!.kind).toEqual({ type: "cart", cartType: 1 });
		expect([...piece!.bytes.subarray(0, 4)]).toEqual(CART_MAGIC);
		expect(piece!.header).toHaveLength(16);
		expect(piece!.from).toBe(0);
		expect(piece!.to).toBe(8192);
		expect(piece!.bytes).toHaveLength(8192 + 16);
		// Round-trips through the detector and the emulator's cartridge loader.
		expect(detectFileFormat(piece!.bytes)).toBe("cart");
		expect(() => new Cartridge(piece!.bytes)).not.toThrow();
	});

	it("maps raw 8K $8000 → type 21 and raw 16K → type 2", () => {
		expect(canonicalize(rawCart8k8000())[0]!.kind).toEqual({
			type: "cart",
			cartType: 21,
		});
		expect(canonicalize(rawCart16k())[0]!.kind).toEqual({
			type: "cart",
			cartType: 2,
		});
	});

	it("passes an OS ROM through raw with its size class", () => {
		const [piece, ...rest] = canonicalize(fakeOsRom16k());
		expect(rest).toHaveLength(0);
		expect(piece!.kind).toEqual({ type: "os", sizeClass: 16 });
		expect(piece!.header).toHaveLength(0);
		expect(piece!.bytes).toHaveLength(16384);
	});

	it("splits an XEGS 32K dump into game cart, BASIC cart, and OS", () => {
		const pieces = canonicalize(xegsCombined());
		expect(pieces.map((p) => p.role)).toEqual(["game", "basic", "os"]);
		expect(pieces.map((p) => [p.from, p.to])).toEqual([
			[0x0000, 0x2000],
			[0x2000, 0x4000],
			[0x4000, 0x8000],
		]);
		expect(pieces.map((p) => p.kind)).toEqual([
			{ type: "cart", cartType: 1 },
			{ type: "cart", cartType: 1 },
			{ type: "os", sizeClass: 16 },
		]);
		// The cart pieces are real .cars; the OS piece is the raw 16K slice.
		expect(detectFileFormat(pieces[0]!.bytes)).toBe("cart");
		expect(detectFileFormat(pieces[1]!.bytes)).toBe("cart");
		expect(pieces[2]!.bytes).toHaveLength(16384);
	});

	it("counts SD disk sectors by a flat 128-byte division", () => {
		expect(canonicalize(makeAtr(128, 720 * 128))[0]!.kind).toEqual({
			type: "disk",
			sectorSize: 128,
			sectors: 720,
		});
	});

	it("counts DD disk sectors honoring the 128-byte boot sectors", () => {
		// Standard DD: 3 boot sectors at 128 B, the rest at 256 B.
		expect(canonicalize(makeAtr(256, 3 * 128 + 717 * 256))[0]!.kind).toEqual({
			type: "disk",
			sectorSize: 256,
			sectors: 720,
		});
	});

	it("counts a non-standard all-256 DD image by a flat division", () => {
		expect(canonicalize(makeAtr(256, 720 * 256))[0]!.kind).toEqual({
			type: "disk",
			sectorSize: 256,
			sectors: 720,
		});
	});

	it("throws on an unrecognized format", () => {
		expect(() => canonicalize(new Uint8Array([1, 2, 3, 4]))).toThrow(
			/Unrecognized/,
		);
	});
});

describe("builtinSlotRom", () => {
	it("passes a raw 8K ROM through and unwraps a standard-8K .car back to it", () => {
		const raw = rawCart8kA000();
		expect(builtinSlotRom(raw)).toBe(raw); // raw passes straight through

		const car = canonicalize(raw)[0]!.bytes; // type-1 .car (8208 bytes)
		const unwrapped = builtinSlotRom(car);
		expect(unwrapped).toHaveLength(8192);
		expect([...unwrapped]).toEqual([...raw]);
	});

	it("rejects a non-standard .car for a built-in 8K slot", () => {
		const car16 = canonicalize(rawCart16k())[0]!.bytes; // CART type 2 (16K)
		expect(() => builtinSlotRom(car16)).toThrow(/standard-8K/);
	});
});
