import { expect, test } from "vitest";
import { DelayLine } from "./delay-line.ts";

test("scheduled bits come due after exactly `delay` ticks", () => {
	const line = new DelayLine(8);
	line.schedule(1, 0x01);
	line.schedule(4, 0x02);

	expect(line.tick()).toBe(0x01);
	expect(line.tick()).toBe(0);
	expect(line.tick()).toBe(0);
	expect(line.tick()).toBe(0x02);
	expect(line.tick()).toBe(0);
});

test("events OR together; values overwrite", () => {
	const line = new DelayLine(8);
	line.schedule(2, 0x01);
	line.schedule(2, 0x04);
	expect(line.tick()).toBe(0);
	expect(line.tick()).toBe(0x05);

	line.scheduleValue(1, 0x30);
	line.scheduleValue(1, 0x21); // the later write wins
	expect(line.tick()).toBe(0x21);
});

test("cancel removes bits from every pending slot", () => {
	const line = new DelayLine(8);
	line.schedule(1, 0x03);
	line.schedule(3, 0x01);
	line.cancel(0x01);

	expect(line.tick()).toBe(0x02);
	expect(line.tick()).toBe(0);
	expect(line.tick()).toBe(0);
});

test("the ring wraps (tick first, then schedule, like a chip cycle)", () => {
	const line = new DelayLine(4);
	for (let i = 0; i < 23; i++) {
		expect(line.tick()).toBe(i >= 3 ? 0x01 : 0);
		line.schedule(3, 0x01);
	}
});

test("reset clears everything", () => {
	const line = new DelayLine(8);
	line.schedule(1, 0xff);
	line.reset();
	expect(line.tick()).toBe(0);
});

test("the size must be a power of two", () => {
	expect(() => new DelayLine(0)).toThrow("power of two");
	expect(() => new DelayLine(6)).toThrow("power of two");
	expect(() => new DelayLine(8)).not.toThrow();
});
