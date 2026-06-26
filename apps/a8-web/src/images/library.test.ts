import { describe, expect, it } from "vitest";
import { sha256Hex } from "./hash.ts";
import {
	addImage,
	getImage,
	getImageBytes,
	libraryEntries,
	readyLibrary,
	removeImage,
} from "./library.ts";

// An 8K cartridge that canonicalizes to a type-1 .car; `fill` varies the bytes
// (and thus the hash) so tests stay independent of each other.
function rawCart8k(fill: number): Uint8Array {
	const cart = new Uint8Array(8192).fill(fill);
	// Leave a valid CART trailer regardless of `fill`: the byte at length-4 must
	// be 0, start address unused, init = $A000 → raw-cart-8k-a000-bfff.
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

		// getImageBytes returns the stored canonical bytes — they hash to `hash`.
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
