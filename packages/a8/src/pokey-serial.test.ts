import { expect, test } from "vitest";
import { Pokey } from "./pokey.ts";

const AUDF1 = 0x00;
const AUDF2 = 0x02;
const AUDF3 = 0x04;
const AUDF4 = 0x06;
const AUDCTL = 0x08;
const STIMER = 0x09;
const SKRES = 0x0a;
const SEROUT = 0x0d;
const SERIN = 0x0d;
const IRQEN_IRQST = 0x0e;
const SKCTL = 0x0f;

const IRQ_SERIN = 0x20;
const IRQ_TIMER4 = 0x04;

const SKSTAT_FRAMING = 0x80;
const SKSTAT_OVERRUN = 0x20;
const SKSTAT_DIRECT_IN = 0x10;
const SKSTAT_RX_BUSY = 0x02;

// The standard disk setup: timers 3+4 linked at 1.79MHz with divisor
// $0028 - a 47-cycle timer period, two periods (94 cycles) per bit cell,
// 19040 baud like the real bus.
const BIT_CYCLES = 94;

// Configure asynchronous receive at the standard disk rate (the OS's
// SKCTL=$13: input clock = timers 3+4 async, output clock = external).
function asyncReceiver(): Pokey {
	const pokey = new Pokey();
	pokey.write(AUDCTL, 0x28); // link 3+4, channel 3 at 1.79MHz
	pokey.write(AUDF3, 0x28);
	pokey.write(AUDF4, 0x00);
	pokey.write(SKCTL, 0x13);
	pokey.write(IRQEN_IRQST, IRQ_SERIN);
	return pokey;
}

function run(pokey: Pokey, cycles: number): void {
	for (let i = 0; i < cycles; i++) pokey.cycle();
}

// Drive one 10-bit frame onto the input line, mimicking a device
// transmitting at the given bit-cell length.
function feedByte(
	pokey: Pokey,
	byte: number,
	{ stopBit = 1, bitCycles = BIT_CYCLES } = {},
): void {
	const bits = [0]; // start
	for (let i = 0; i < 8; i++) bits.push((byte >> i) & 1); // LSB first
	bits.push(stopBit);
	for (const bit of bits) {
		pokey.serialIn = bit;
		run(pokey, bitCycles);
	}
	pokey.serialIn = 1;
}

test("async receive: a byte lands in SERIN and raises the input-ready IRQ", () => {
	const pokey = asyncReceiver();
	run(pokey, 500); // idle: nothing arrives
	expect(pokey.read(IRQEN_IRQST) & IRQ_SERIN).not.toBe(0);

	feedByte(pokey, 0xa5);
	expect(pokey.read(SERIN)).toBe(0xa5);
	expect(pokey.read(IRQEN_IRQST) & IRQ_SERIN).toBe(0); // latched low
	expect(pokey.read(SKCTL) & SKSTAT_FRAMING).not.toBe(0); // no error
});

test("async receive: back-to-back bytes, each acknowledged, no overrun", () => {
	const pokey = asyncReceiver();
	for (const byte of [0x00, 0xff, 0x55, 0x31]) {
		feedByte(pokey, byte);
		expect(pokey.read(SERIN)).toBe(byte);
		pokey.write(IRQEN_IRQST, 0); // acknowledge: clear the latch...
		pokey.write(IRQEN_IRQST, IRQ_SERIN); // ...and re-enable
	}
	expect(pokey.read(SKCTL) & SKSTAT_OVERRUN).not.toBe(0);
});

test("a low stop bit latches the framing error; the byte still arrives", () => {
	const pokey = asyncReceiver();
	feedByte(pokey, 0x42, { stopBit: 0 });
	expect(pokey.read(SERIN)).toBe(0x42);
	expect(pokey.read(IRQEN_IRQST) & IRQ_SERIN).toBe(0); // IRQ still raised
	expect(pokey.read(SKCTL) & SKSTAT_FRAMING).toBe(0);

	// Sticky across a clean byte; cleared by SKRES.
	pokey.serialIn = 1;
	run(pokey, 2 * BIT_CYCLES);
	feedByte(pokey, 0x43);
	expect(pokey.read(SKCTL) & SKSTAT_FRAMING).toBe(0);
	pokey.write(SKRES, 0);
	expect(pokey.read(SKCTL) & SKSTAT_FRAMING).not.toBe(0);
});

test("an unacknowledged byte overruns; disabled IRQ detects nothing", () => {
	const pokey = asyncReceiver();
	feedByte(pokey, 0x11);
	feedByte(pokey, 0x22); // IRQ still pending: overrun
	expect(pokey.read(SERIN)).toBe(0x22); // the new byte replaces the old
	expect(pokey.read(SKCTL) & SKSTAT_OVERRUN).toBe(0);
	pokey.write(SKRES, 0);
	expect(pokey.read(SKCTL) & SKSTAT_OVERRUN).not.toBe(0);

	// With the input-ready IRQ disabled the latch never asserts, so the
	// overrun goes undetected.
	pokey.write(IRQEN_IRQST, 0);
	feedByte(pokey, 0x33);
	feedByte(pokey, 0x44);
	expect(pokey.read(SKCTL) & SKSTAT_OVERRUN).not.toBe(0);
});

test("SKSTAT bit 4 reads the raw input line; bit 1 tracks the shifter", () => {
	const pokey = asyncReceiver();
	expect(pokey.read(SKCTL) & SKSTAT_DIRECT_IN).not.toBe(0);
	pokey.serialIn = 0;
	expect(pokey.read(SKCTL) & SKSTAT_DIRECT_IN).toBe(0);
	pokey.serialIn = 1;

	// Busy asserts at the mid-start-bit sample and releases at the
	// mid-stop-bit sample.
	expect(pokey.read(SKCTL) & SKSTAT_RX_BUSY).not.toBe(0);
	pokey.serialIn = 0; // start bit
	run(pokey, BIT_CYCLES);
	expect(pokey.read(SKCTL) & SKSTAT_RX_BUSY).toBe(0);
	pokey.serialIn = 1; // data bits and stop, all high ($FF)
	run(pokey, 9 * BIT_CYCLES + BIT_CYCLES / 2);
	expect(pokey.read(SKCTL) & SKSTAT_RX_BUSY).not.toBe(0);
	expect(pokey.read(SERIN)).toBe(0xff);
});

test("async mode holds timers 3+4 while the line idles", () => {
	const pokey = asyncReceiver();
	pokey.write(IRQEN_IRQST, IRQ_TIMER4);
	run(pokey, 10000);
	expect(pokey.read(IRQEN_IRQST) & IRQ_TIMER4).not.toBe(0); // frozen

	// The start-bit edge releases them: the timer fires during reception.
	pokey.serialIn = 0;
	run(pokey, BIT_CYCLES);
	expect(pokey.read(IRQEN_IRQST) & IRQ_TIMER4).toBe(0);
});

test("full-duplex loopback: a transmitted byte is received", () => {
	const pokey = new Pokey();
	// Timers 1+2 clock the transmitter, timers 3+4 the (async) receiver,
	// both linked at 1.79MHz with the standard disk divisor.
	pokey.write(AUDCTL, 0x78);
	pokey.write(AUDF1, 0x28);
	pokey.write(AUDF2, 0x00);
	pokey.write(AUDF3, 0x28);
	pokey.write(AUDF4, 0x00);
	pokey.write(SKCTL, 0x73); // %111: output = timer 2, input = async
	pokey.write(STIMER, 0);
	pokey.write(IRQEN_IRQST, IRQ_SERIN);

	pokey.write(SEROUT, 0xc9);
	for (let i = 0; i < 3000; i++) {
		pokey.cycle();
		pokey.serialIn = pokey.serialOut;
	}

	expect(pokey.read(IRQEN_IRQST) & IRQ_SERIN).toBe(0);
	expect(pokey.read(SERIN)).toBe(0xc9);
	expect(pokey.read(SKCTL) & SKSTAT_FRAMING).not.toBe(0); // clean frame
});

test("the clock-out line toggles at the transmit-timer rate in mode %010", () => {
	const pokey = new Pokey();
	pokey.write(AUDCTL, 0x28);
	pokey.write(AUDF3, 0x28);
	pokey.write(AUDF4, 0x00);
	pokey.write(SKCTL, 0x23); // %010: output clock = timer 4, line driven
	pokey.write(STIMER, 0);

	let last = pokey.serialClockOut;
	const gaps: number[] = [];
	let sinceToggle = 0;
	for (let i = 0; i < 600; i++) {
		pokey.cycle();
		sinceToggle++;
		if (pokey.serialClockOut !== last) {
			last = pokey.serialClockOut;
			gaps.push(sinceToggle);
			sinceToggle = 0;
		}
	}
	expect(gaps.length).toBeGreaterThan(8);
	// Steady state: one toggle per timer fire (the N+7 = 47-cycle period).
	for (const gap of gaps.slice(1)) expect(gap).toBe(47);

	// An input-clock mode leaves the line pulled up.
	pokey.write(SKCTL, 0x13);
	expect(pokey.serialClockOut).toBe(1);
});

test("the output line level: force break and two-tone FSK", () => {
	const pokey = new Pokey();
	pokey.write(SKCTL, 0x03);
	expect(pokey.serialOut).toBe(1); // idles at mark

	pokey.write(SKCTL, 0x83); // force break
	expect(pokey.serialOut).toBe(0);

	// Two-tone: the line carries the FSK flip-flop, toggled by timer
	// fires. With force break pinning the data bit to 0, timer 2's tone
	// drives it alone.
	pokey.write(AUDCTL, 0x50); // link 1+2 at 1.79MHz
	pokey.write(AUDF1, 0x10);
	pokey.write(AUDF2, 0x00);
	pokey.write(SKCTL, 0x8b); // two-tone + force break
	pokey.write(STIMER, 0);
	const seen = new Set<number>();
	for (let i = 0; i < 200; i++) {
		pokey.cycle();
		seen.add(pokey.serialOut);
	}
	expect(seen).toEqual(new Set([0, 1]));

	// Clearing bit 3 resets the flip-flop; the line returns to mark.
	pokey.write(SKCTL, 0x03);
	expect(pokey.serialOut).toBe(1);
});
