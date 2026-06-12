import { expect, test } from "vitest";
import { Pokey } from "./pokey.ts";

const AUDF1 = 0x00;
const AUDC1 = 0x01;
const AUDCTL = 0x08;
const STIMER = 0x09;
const RANDOM = 0x0a;
const IRQEN_IRQST = 0x0e;
const SKCTL = 0x0f;

test("RANDOM is polynomial-driven: the 9-bit poly repeats every 511", () => {
	const pokey = new Pokey();
	pokey.write(SKCTL, 0x03); // leave the power-on init mode
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

test("leaving init, 9-bit RANDOM follows the hardware progression", () => {
	const pokey = new Pokey();
	pokey.write(AUDCTL, 0x80); // 9-bit poly
	pokey.write(SKCTL, 0x03); // leave the power-on init mode

	// The Altirra Hardware Reference's published progression, picking up
	// from the all-ones region the init hold saturates into.
	const expected = [0xff, 0x7f, 0x3f, 0x1f, 0x0f, 0x87, 0xc3, 0xe1, 0xf0];
	for (const value of expected) {
		pokey.cycle();
		expect(pokey.read(RANDOM)).toBe(value);
	}
});

test("re-entering init fills RANDOM with ones gradually", () => {
	const pokey = new Pokey();
	pokey.write(AUDCTL, 0x80);
	pokey.write(SKCTL, 0x03);
	for (let i = 0; i < 200; i++) pokey.cycle();

	// A hot stop doesn't snap to $FF: ones shift in from the top, one
	// bit per cycle (after the entry write's own normal shift).
	pokey.write(SKCTL, 0x00);
	pokey.cycle(); // the entry cycle still shifts normally
	let previous = pokey.read(RANDOM);
	for (let i = 0; i < 8; i++) {
		pokey.cycle();
		const value = pokey.read(RANDOM);
		expect(value).toBe(((previous >> 1) | 0x80) & 0xff);
		previous = value;
	}
	expect(previous).toBe(0xff);
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

test("init mode locks RANDOM at $FF and freezes the slow clocks", () => {
	const pokey = new Pokey();

	// Power-on is init mode: RANDOM locked, polys held.
	for (let i = 0; i < 50; i++) pokey.cycle();
	expect(pokey.read(RANDOM)).toBe(0xff);

	// A slow timer mid-count freezes during init and resumes after —
	// init does not reset the timer counters themselves.
	pokey.write(SKCTL, 0x03);
	pokey.write(AUDF1, 1); // 64KHz, period (1+1)*28 = 56 cycles
	pokey.write(IRQEN_IRQST, 0x01);
	pokey.write(STIMER, 0);

	const runUntilIrq = (limit: number) => {
		let cycles = 0;
		while (!pokey.irq && cycles < limit) {
			pokey.cycle();
			cycles++;
		}
		return cycles;
	};

	const first = runUntilIrq(500);
	expect(first).toBeLessThan(500);

	// Re-enter init mid-count: nothing fires for as long as we like.
	pokey.write(IRQEN_IRQST, 0x00);
	pokey.write(IRQEN_IRQST, 0x01);
	pokey.write(SKCTL, 0x00);
	for (let i = 0; i < 1000; i++) pokey.cycle();
	expect(pokey.irq).toBe(false);
	expect(pokey.read(RANDOM)).toBe(0xff);

	// Leaving init restarts the clocks; the timer picks up where it was.
	pokey.write(SKCTL, 0x03);
	expect(runUntilIrq(500)).toBeLessThan(500);
});

test("init mode does not touch IRQ state or fast channels", () => {
	const pokey = new Pokey();
	pokey.write(SKCTL, 0x03);
	pokey.write(IRQEN_IRQST, 0x40);
	pokey.keyDown(0x3f); // latch the keyboard IRQ

	pokey.write(SKCTL, 0x00); // back into init
	expect(pokey.read(IRQEN_IRQST)).toBe(0xbf); // the latch survives
	expect(pokey.irq).toBe(true);

	// A 1.79MHz channel keeps counting — it runs on the machine clock.
	pokey.write(AUDCTL, 0x40);
	pokey.write(AUDF1, 0);
	pokey.write(AUDC1, 0xaf);
	pokey.write(STIMER, 0);
	const samples = new Set<number>();
	for (let i = 0; i < 50; i++) samples.add(pokey.cycle());
	expect(samples.has(15)).toBe(true);
	expect(samples.has(0)).toBe(true);
});
