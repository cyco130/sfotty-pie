import { describe, expect, it } from "vitest";
import {
	cartTypesForSize,
	isCartTypeSupported,
	suggestCartType,
} from "./cartridge.ts";

// Place a plausible boot trailer at the end of the 8K bank starting at
// `bankOffset`: zero byte + an init vector at $A000.
function trailer(bytes: Uint8Array, bankOffset: number): Uint8Array {
	bytes[bankOffset + 8188] = 0x00;
	bytes[bankOffset + 8190] = 0x00;
	bytes[bankOffset + 8191] = 0xa0;
	return bytes;
}

describe("cartTypesForSize", () => {
	it("lists every size match, supported first", () => {
		const options = cartTypesForSize(32);
		const types = options.map((o) => o.cartType);
		expect(types).toContain(12); // XEGS 32 (supported)
		expect(types).toContain(82); // COS32 (unimplemented)
		expect(types).toContain(4); // 5200 32K
		// Supported prefix, unsupported suffix.
		const firstUnsupported = options.findIndex((o) => !o.supported);
		expect(options.slice(0, firstUnsupported).every((o) => o.supported)).toBe(
			true,
		);
		expect(options.slice(firstUnsupported).some((o) => o.supported)).toBe(
			false,
		);
	});

	it("supported excludes 5200 and unimplemented types", () => {
		expect(isCartTypeSupported(12)).toBe(true);
		expect(isCartTypeSupported(82)).toBe(false); // COS32: no scheme yet
		expect(isCartTypeSupported(4)).toBe(false); // 5200
		expect(isCartTypeSupported(9999)).toBe(false);
	});
});

describe("suggestCartType", () => {
	it("is certain for size-unique types", () => {
		expect(suggestCartType(new Uint8Array(2048))).toBe(57);
		expect(suggestCartType(new Uint8Array(32 * 1024 * 1024))).toBe(65);
	});

	it("maps an end-of-image trailer to the XEGS shape", () => {
		const bytes = trailer(new Uint8Array(32768), 32768 - 8192);
		expect(suggestCartType(bytes)).toBe(12);
	});

	it("maps a first-bank trailer to the 8K-window shape", () => {
		expect(suggestCartType(trailer(new Uint8Array(65536), 0))).toBe(8);
	});

	it("maps a first-16K-upper trailer to the MegaCart shape", () => {
		expect(suggestCartType(trailer(new Uint8Array(131072), 8192))).toBe(29);
	});

	it("returns null when nothing matches", () => {
		expect(suggestCartType(new Uint8Array(65536).fill(0x55))).toBe(null);
		expect(suggestCartType(new Uint8Array(1000))).toBe(null);
	});
});
