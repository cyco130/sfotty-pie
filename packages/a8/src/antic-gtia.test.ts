import { expect, test } from "vitest";
import { AnticGtia } from "./antic-gtia.ts";

// GTIA read registers at power-on, per the Altirra Hardware Reference
// Manual. (The write-only registers' contents are not covered by it.)
const POWER_ON_READS = [
	0x00,
	0x00,
	0x00,
	0x00,
	0x00,
	0x00,
	0x00,
	0x00, // M0PF-P3PF
	0x0f,
	0x0f,
	0x0f,
	0x0f,
	0x0e,
	0x0d,
	0x0b,
	0x07, // M0PL-P3PL
	0x01,
	0x01,
	0x01,
	0x01, // TRIG0-TRIG3
	0x0f, // PAL (NTSC)
	0x0f,
	0x0f,
	0x0f,
	0x0f,
	0x0f,
	0x0f,
	0x0f,
	0x0f,
	0x0f,
	0x0f, // unmapped
	0x00, // CONSOL (the written latch powers on pulling the lines low)
];

test("GTIA read registers match the documented power-on state", () => {
	const ag = new AnticGtia(
		{ dmaRead: () => 0, log: () => {} },
		{ anticTvSystem: "ntsc", gtiaTvSystem: "ntsc" },
	);

	for (let offset = 0; offset < 0x20; offset++) {
		expect(
			ag.read(0xd000 + offset),
			`$D0${offset.toString(16).padStart(2, "0").toUpperCase()}`,
		).toBe(POWER_ON_READS[offset]);
	}
});

test("writing CONSOL releases the switch lines", () => {
	const ag = new AnticGtia(
		{ dmaRead: () => 0, log: () => {} },
		{ anticTvSystem: "ntsc", gtiaTvSystem: "ntsc" },
	);

	expect(ag.read(0xd01f)).toBe(0); // latch pulls all lines low
	ag.write(0xd01f, 0x08); // what the OS writes every VBLANK
	expect(ag.read(0xd01f)).toBe(7); // no console keys pressed
	ag.console &= ~0x04; // hold Option
	expect(ag.read(0xd01f)).toBe(3);
});
