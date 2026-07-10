import { describe, expect, it } from "vitest";
import { sha256Hex } from "./hash.ts";
import {
	addImage,
	getImage,
	getImageBytes,
	libraryEntries,
	readyLibrary,
	removeImage,
	retypeImage,
} from "./library.ts";

// An 8K cartridge that canonicalizes to a type-1 .car; `fill` varies the bytes
// (and thus the hash) so tests stay independent of each other.
function rawCart8k(fill: number): Uint8Array {
	const cart = new Uint8Array(8192).fill(fill);
	// Leave a valid CART trailer regardless of `fill`: the byte at length-4 must
	// be 0, start address unused, init = $A000 -> raw-cart-8k-a000-bfff.
	cart[8188] = 0x00;
	cart[8189] = 0x00;
	cart[8190] = 0x00;
	cart[8191] = 0xa0;
	return cart;
}

describe("image library", () => {
	it("merges the built-in manifest, mapping firmware identity and slots", async () => {
		await readyLibrary();
		const builtin = libraryEntries.value.find((e) => e.source === "builtin");
		expect(builtin).toBeDefined();
		expect(builtin!.id).toBe("fake-basic"); // firmware key, not the path
		expect(builtin!.derived).toEqual({ type: "cart", cartType: 1 });
		expect(builtin!.user.slots).toEqual(["basic"]); // primed from firmwareType
	});

	it("adds an upload, surfaces it merged, and round-trips canonical bytes", async () => {
		const before = libraryEntries.value.length;
		const { added, deduped } = await addImage(rawCart8k(0x11), "game.rom");

		expect(deduped).toBe(0);
		expect(added).toHaveLength(1);
		const entry = added[0]!;
		expect(entry.source).toBe("user");
		expect(entry.derived).toEqual({ type: "cart", cartType: 1 });

		expect(libraryEntries.value.length).toBe(before + 1);
		expect(getImage(entry.id)).toBeDefined();

		// getImageBytes returns the stored canonical bytes - they hash to `hash`.
		const bytes = await getImageBytes(entry.id);
		expect(await sha256Hex(bytes)).toBe(entry.hash);
	});

	it("dedups a re-upload of identical bytes (no second entry)", async () => {
		const first = await addImage(rawCart8k(0x22), "a.rom");
		const again = await addImage(rawCart8k(0x22), "b.rom");

		expect(again.added).toHaveLength(0);
		expect(again.deduped).toBe(1);
		expect(
			libraryEntries.value.filter(
				(e) => e.source === "user" && e.hash === first.added[0]!.hash,
			),
		).toHaveLength(1);
	});

	it("removes a user image and frees its blob", async () => {
		const { added } = await addImage(rawCart8k(0x33), "c.rom");
		const entry = added[0]!;
		await removeImage(entry.id);

		expect(getImage(entry.id)).toBeUndefined();
		await expect(getImageBytes(entry.id)).rejects.toThrow();
	});

	it("throws on an unrecognized upload", async () => {
		await expect(
			addImage(new Uint8Array([1, 2, 3]), "junk.bin"),
		).rejects.toThrow(/Unrecognized/);
	});
});

describe("retypeImage", () => {
	it("types an unknown ROM by writing the header, keeping the entry id", async () => {
		// 32K of patterned noise, no trailer: canonicalizes to unknown-rom.
		const raw = new Uint8Array(32768);
		for (let i = 0; i < raw.length; i++) raw[i] = (i * 13 + 7) & 0xff;
		const { added } = await addImage(raw, "mystery.rom");
		const entry = added[0]!;
		expect(entry.derived).toEqual({ type: "unknown-rom" });
		const oldHash = entry.hash;

		// Pick XEGS 32 (type 12): header written, kind derived, id stable.
		expect(await retypeImage(entry.id, 12)).toBe(true);
		const typed = getImage(entry.id)!;
		expect(typed.derived).toEqual({ type: "cart", cartType: 12 });
		expect(typed.hash).not.toBe(oldHash);
		const bytes = await getImageBytes(entry.id);
		expect(bytes.length).toBe(32768 + 16);
		expect([...bytes.subarray(0, 8)]).toEqual([
			0x43, 0x41, 0x52, 0x54, 0, 0, 0, 12,
		]);

		// Re-typing a typed cart swaps the header in place (trial and error).
		expect(await retypeImage(entry.id, 33)).toBe(true);
		const retyped = await getImageBytes(entry.id);
		expect(retyped.length).toBe(32768 + 16);
		expect(retyped[7]).toBe(33);
		// A size-mismatched or unknown type is refused.
		expect(await retypeImage(entry.id, 1)).toBe(false); // 8K type
		expect(await retypeImage(entry.id, 9999)).toBe(false);
		expect((await getImageBytes(entry.id))[7]).toBe(33); // unchanged
	});
});
