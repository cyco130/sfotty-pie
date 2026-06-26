import { describe, expect, it } from "vitest";
import { deflateRaw, inflateRaw } from "./compress.ts";

describe("deflate-raw compression", () => {
	it("round-trips arbitrary bytes", async () => {
		const data = new Uint8Array(1000);
		for (let i = 0; i < data.length; i++) data[i] = (i * 31 + 7) & 0xff;
		const back = await inflateRaw(await deflateRaw(data));
		expect([...back]).toEqual([...data]);
	});

	it("crushes zero-heavy data the way a half-empty disk compresses", async () => {
		const disk = new Uint8Array(92160); // 90K, mostly zeros
		for (let i = 0; i < 4096; i++) disk[i] = (i * 37) & 0xff;
		const compressed = await deflateRaw(disk);
		expect(compressed.length).toBeLessThan(disk.length / 10);
		expect([...(await inflateRaw(compressed))]).toEqual([...disk]);
	});

	it("does not shrink incompressible data", async () => {
		const random = crypto.getRandomValues(new Uint8Array(4096));
		const compressed = await deflateRaw(random);
		expect(compressed.length).toBeGreaterThanOrEqual(random.length);
	});
});
