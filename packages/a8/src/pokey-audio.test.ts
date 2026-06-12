import { expect, test } from "vitest";
import { Pokey } from "./pokey.ts";

const AUDF1 = 0x00;
const AUDC1 = 0x01;
const AUDCTL = 0x08;
const RANDOM = 0x0a;

test("RANDOM is polynomial-driven: the 9-bit poly repeats every 511", () => {
	const pokey = new Pokey();
	pokey.write(AUDCTL, 0x80); // 9-bit poly

	const sequence: number[] = [];
	for (let i = 0; i < 511 * 2; i++) {
		pokey.cycle();
		sequence.push(pokey.read(RANDOM));
	}

	expect(new Set(sequence).size).toBeGreaterThan(1); // it does run
	for (let i = 0; i < 511; i++) {
		expect(sequence[i + 511]).toBe(sequence[i]);
	}
});

test("a volume-only channel outputs its volume constantly", () => {
	const pokey = new Pokey();
	pokey.write(AUDC1, 0x1f); // volume-only, volume 15

	for (let i = 0; i < 100; i++) {
		expect(pokey.cycle()).toBe(15);
	}
});

test("a square-wave channel toggles with a stable period", () => {
	const pokey = new Pokey();
	pokey.write(AUDCTL, 0x40); // channel 1 at 1.79MHz
	pokey.write(AUDF1, 10);
	pokey.write(AUDC1, 0xaf); // square wave, volume 15

	const samples: number[] = [];
	for (let i = 0; i < 300; i++) samples.push(pokey.cycle());

	expect(samples).toContain(0);
	expect(samples).toContain(15);

	// All rising edges are equally spaced.
	const edges: number[] = [];
	for (let i = 1; i < samples.length; i++) {
		if (samples[i] === 15 && samples[i - 1] === 0) edges.push(i);
	}
	expect(edges.length).toBeGreaterThan(3);
	const distances = new Set(edges.slice(1).map((edge, i) => edge - edges[i]!));
	expect(distances.size).toBe(1);
});

test("linking 1+2 silences channel 1's own output", () => {
	const pokey = new Pokey();
	pokey.write(AUDCTL, 0x40);
	pokey.write(AUDF1, 0);
	pokey.write(AUDC1, 0xa8); // square wave, volume 8

	let sawOutput = false;
	for (let i = 0; i < 50; i++) sawOutput ||= pokey.cycle() === 8;
	expect(sawOutput).toBe(true);

	// In 16-bit linked mode channel 1 only clocks channel 2 — its own
	// output is forced low (and must stay there: the ghost-output bug).
	pokey.write(AUDCTL, 0x50);
	pokey.cycle();
	for (let i = 0; i < 100; i++) {
		expect(pokey.cycle()).toBe(0);
	}
});

test("a power cycle silences and clears the audio state", () => {
	const pokey = new Pokey();
	pokey.write(AUDC1, 0x1f);
	expect(pokey.cycle()).toBe(15);

	pokey.reset(true);
	expect(pokey.cycle()).toBe(0);
});
