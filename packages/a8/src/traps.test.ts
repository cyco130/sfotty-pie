import { expect, test } from "vitest";
import { ReadOptions } from "@sfotty-pie/sfotty";
import { Atari } from "./machine.ts";

// Bus-manager trap dispatch, driven through the Machine API by issuing reads
// and writes with explicit ReadOptions (no CPU needed). A committed opcode
// fetch is SYNC alone; the dummy/stalled fetch adds DUMMY; a data read is NONE.
const FETCH = ReadOptions.SYNC; // committed opcode fetch
const DUMMY = ReadOptions.SYNC | ReadOptions.DUMMY; // non-committing fetch

function machine(): Atari {
	return new Atari({
		xl: true,
		os: new Uint8Array(16384),
		basic: new Uint8Array(8192),
	});
}

test("execute interceptor substitutes a committed fetch only", () => {
	const m = machine();
	m.write(0x0090, 0x42, ReadOptions.NONE); // plain zero-page RAM
	m.interceptExecute(0x0090, () => 0x60);

	expect(m.read(0x0090, FETCH)).toBe(0x60); // committed fetch → substituted
	expect(m.read(0x0090, DUMMY)).toBe(0x42); // dummy fetch → real memory
	expect(m.read(0x0090, ReadOptions.NONE)).toBe(0x42); // data read → real memory
});

test("read traps fire on data reads and committed fetches, but not dummies", () => {
	const m = machine();
	m.write(0x0091, 0x11, ReadOptions.NONE);
	const seen: number[] = [];
	m.observeRead(0x0091, (_a, _v, flags) => seen.push(flags));

	m.read(0x0091, ReadOptions.NONE); // data read → fires
	m.read(0x0091, FETCH); // committed fetch → fires (default mask only excludes DUMMY)
	m.read(0x0091, DUMMY); // dummy → excluded by default { dummy: false }
	expect(seen).toEqual([ReadOptions.NONE, FETCH]);
});

test("a mask of { dummy: undefined } also fires on dummy accesses", () => {
	const m = machine();
	m.write(0x0091, 0x11, ReadOptions.NONE);
	let count = 0;
	m.observeRead(0x0091, () => count++, { mask: { dummy: undefined } });
	m.read(0x0091, ReadOptions.NONE);
	m.read(0x0091, DUMMY);
	expect(count).toBe(2);
});

test("interceptors are additive, LIFO, first non-undefined wins", () => {
	const m = machine();
	m.write(0x0092, 0x10, ReadOptions.NONE);
	const order: string[] = [];
	m.interceptRead(0x0092, () => {
		order.push("first");
		return 0xaa;
	});
	m.interceptRead(0x0092, () => {
		order.push("second");
		return undefined; // pass through to the earlier one
	});

	// LIFO: the later-registered "second" runs first, returns undefined, then
	// "first" runs and wins with 0xaa.
	expect(m.read(0x0092, ReadOptions.NONE)).toBe(0xaa);
	expect(order).toEqual(["second", "first"]);
});

test("observers run last-registered-first", () => {
	const m = machine();
	m.write(0x0093, 0x77, ReadOptions.NONE);
	const order: string[] = [];
	m.observeRead(0x0093, () => order.push("a"));
	m.observeRead(0x0093, () => order.push("b"));
	m.read(0x0093, ReadOptions.NONE);
	expect(order).toEqual(["b", "a"]);
});

test("read interceptor substitutes; observers see the result after", () => {
	const m = machine();
	m.write(0x0094, 0x11, ReadOptions.NONE);
	const observed: number[] = [];
	m.observeRead(0x0094, (_a, value) => observed.push(value));

	expect(m.read(0x0094, ReadOptions.NONE)).toBe(0x11); // real value observed
	m.interceptRead(0x0094, () => 0x55);
	expect(m.read(0x0094, ReadOptions.NONE)).toBe(0x55); // substitute observed
	expect(observed).toEqual([0x11, 0x55]);
});

test("write interceptor can suppress the store; observers fire only on commit", () => {
	const m = machine();
	m.write(0x0095, 0x10, ReadOptions.NONE);
	const written: number[] = [];
	m.observeWrite(0x0095, (_a, value) => written.push(value));

	const handle = m.interceptWrite(0x0095, () => true); // suppress
	m.write(0x0095, 0x20, ReadOptions.NONE);
	expect(m.read(0x0095, ReadOptions.NONE)).toBe(0x10); // unchanged
	expect(written).toEqual([]); // suppressed → no observer

	handle.remove();
	m.write(0x0095, 0x30, ReadOptions.NONE); // now commits
	expect(m.read(0x0095, ReadOptions.NONE)).toBe(0x30);
	expect(written).toEqual([0x30]);
});

test("once auto-removes after the first fire", () => {
	const m = machine();
	m.write(0x0096, 0x77, ReadOptions.NONE);
	let calls = 0;
	m.observeRead(0x0096, () => calls++, { once: true });
	m.read(0x0096, ReadOptions.NONE);
	m.read(0x0096, ReadOptions.NONE);
	expect(calls).toBe(1);

	m.interceptExecute(0x0096, () => 0x60, { once: true });
	expect(m.read(0x0096, FETCH)).toBe(0x60);
	expect(m.read(0x0096, FETCH)).toBe(0x77); // gone after first fetch
});

test("a PEEK fires no traps and substitutes nothing", () => {
	const m = machine();
	m.write(0x0097, 0x33, ReadOptions.NONE);
	let reads = 0;
	m.observeRead(0x0097, () => reads++);
	m.interceptRead(0x0097, () => 0x99);

	expect(m.read(0x0097, ReadOptions.PEEK)).toBe(0x33); // real memory, not 0x99
	expect(reads).toBe(0);
});
