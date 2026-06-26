import { describe, expect, it } from "vitest";
import { idbBlobStore } from "./blob-store.ts";
import {
	type BlobRecord,
	openLibraryDb,
	STORE_BLOBS,
	withStore,
} from "./db.ts";

const store = idbBlobStore();

async function storedRecord(ref: string): Promise<BlobRecord | undefined> {
	const db = await openLibraryDb();
	return withStore<BlobRecord | undefined>(db, STORE_BLOBS, "readonly", (s) =>
		s.get(ref),
	);
}

describe("idbBlobStore", () => {
	it("round-trips bytes through IndexedDB, stored raw when incompressible", async () => {
		const bytes = new Uint8Array([1, 2, 3, 4, 5]);
		await store.put("ref-roundtrip", bytes);
		expect([...(await store.get("ref-roundtrip"))!]).toEqual([...bytes]);
		expect((await storedRecord("ref-roundtrip"))?.encoding).toBe("raw");
	});

	it("stores zero-heavy blobs compressed and round-trips them intact", async () => {
		const disk = new Uint8Array(92160);
		for (let i = 0; i < 4096; i++) disk[i] = (i * 37) & 0xff;
		await store.put("ref-disk", disk);

		const record = await storedRecord("ref-disk");
		expect(record?.encoding).toBe("deflate-raw");
		expect(record!.bytes.byteLength).toBeLessThan(disk.length / 10);

		const back = await store.get("ref-disk");
		expect(back).toHaveLength(disk.length);
		expect([...back!]).toEqual([...disk]);
	});

	it("stores a subarray view without dragging in the whole buffer", async () => {
		const big = new Uint8Array(64).fill(0xaa);
		const view = big.subarray(8, 16);
		await store.put("ref-view", view);
		const back = await store.get("ref-view");
		expect(back).toHaveLength(8);
		expect([...back!]).toEqual([...view]);
	});

	it("returns undefined for a missing ref", async () => {
		expect(await store.get("ref-absent")).toBeUndefined();
	});

	it("deletes a blob", async () => {
		await store.put("ref-del", new Uint8Array([9]));
		await store.delete("ref-del");
		expect(await store.get("ref-del")).toBeUndefined();
	});
});
