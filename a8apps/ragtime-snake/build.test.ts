import { expect, test } from "vitest";
import { buildGame } from "./build.ts";

// Structural checks on the built XEX: signature, a single load chunk that
// accounts for the whole file, and a RUNAD trailer pointing into the chunk.
// (Booting the image in the a8 core is the next step - it needs the OS
// fixture dance from a8's xex-boot tests.)
test("the game assembles to a well-formed single-chunk XEX", async () => {
	const xex = await buildGame();
	const word = (i: number) => xex[i]! | (xex[i + 1]! << 8);

	expect(word(0)).toBe(0xffff);
	const chunkStart = word(2);
	const chunkEnd = word(4); // inclusive
	expect(chunkStart).toBe(0x2000);
	const chunkLength = chunkEnd - chunkStart + 1;
	// signature+range (6) + chunk + RUNAD range (4) + RUNAD value (2)
	expect(xex.length).toBe(6 + chunkLength + 6);

	// The RUNAD trailer targets $02E0-$02E1 with a run address in the chunk.
	const trailer = 6 + chunkLength;
	expect(word(trailer)).toBe(0x02e0);
	expect(word(trailer + 2)).toBe(0x02e1);
	const run = word(trailer + 4);
	expect(run).toBeGreaterThanOrEqual(chunkStart);
	expect(run).toBeLessThanOrEqual(chunkEnd);
});
