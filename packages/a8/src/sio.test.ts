import { expect, test } from "vitest";
import { DECODE, ReadOptions, Sfotty } from "@sfotty-pie/sfotty";
import { makeAtr } from "./atr-fixture.ts";
import { AtrImage } from "./atr.ts";
import { Atari, type AtariModel } from "./machine.ts";
import { createSioHandler, SIOV } from "./sio.ts";

const DSTATS = 0x0303;

function makeMachine(model: AtariModel = "800") {
	// On the 800, BASIC goes through cartridge image sniffing: give the dummy
	// ROM a valid $A000 cart trailer (init address $A000, start unused).
	const basic = new Uint8Array(8192);
	basic[8191] = 0xa0;

	return new Atari({
		model,
		os: new Uint8Array(model === "800XL" ? 16384 : 10240),
		basic,
	});
}

function setup(disk?: AtrImage) {
	const machine = makeMachine();
	const cpu = new Sfotty(machine, { withoutUndocumented: false });
	const handler = createSioHandler({
		machine,
		cpu,
		getDisk: (unit) => (unit === 1 ? disk : undefined),
	});
	return { machine, cpu, handler };
}

function setDcb(
	machine: Atari,
	dcb: {
		device?: number;
		unit?: number;
		command: number;
		buffer: number;
		byteCount: number;
		aux?: number;
	},
) {
	machine.write(0x0300, dcb.device ?? 0x31, ReadOptions.NONE);
	machine.write(0x0301, dcb.unit ?? 1, ReadOptions.NONE);
	machine.write(0x0302, dcb.command, ReadOptions.NONE);
	machine.write(0x0304, dcb.buffer & 0xff, ReadOptions.NONE);
	machine.write(0x0305, dcb.buffer >> 8, ReadOptions.NONE);
	machine.write(0x0308, dcb.byteCount & 0xff, ReadOptions.NONE);
	machine.write(0x0309, dcb.byteCount >> 8, ReadOptions.NONE);
	machine.write(0x030a, (dcb.aux ?? 0) & 0xff, ReadOptions.NONE);
	machine.write(0x030b, (dcb.aux ?? 0) >> 8, ReadOptions.NONE);
}

test("read sector fills the buffer and reports success", () => {
	const { machine, cpu, handler } = setup(new AtrImage(makeAtr(128, 4)));
	setDcb(machine, { command: 0x52, buffer: 0x2000, byteCount: 128, aux: 2 });

	expect(handler(SIOV)).toBe(0x60); // RTS
	expect(machine.read(0x2000, ReadOptions.NONE)).toBe(2);
	expect(machine.read(0x207f, ReadOptions.NONE)).toBe(2);
	expect(machine.read(DSTATS, ReadOptions.NONE)).toBe(0x01);
	expect(cpu.Y).toBe(0x01);
	expect(cpu.nFlag).toBe(false);
});

test("an empty drive and a non-disk device time out", () => {
	const { machine, cpu, handler } = setup(new AtrImage(makeAtr(128, 4)));

	setDcb(machine, { command: 0x52, buffer: 0x2000, byteCount: 128, unit: 2 });
	expect(handler(SIOV)).toBe(0x60);
	expect(cpu.Y).toBe(0x8a);
	expect(cpu.nFlag).toBe(true);

	setDcb(machine, {
		command: 0x52,
		buffer: 0x2000,
		byteCount: 128,
		device: 0x40, // printer
	});
	handler(SIOV);
	expect(cpu.Y).toBe(0x8a);
});

test("out-of-range reads and writes report a device error", () => {
	const { machine, cpu, handler } = setup(new AtrImage(makeAtr(128, 4)));

	setDcb(machine, { command: 0x52, buffer: 0x2000, byteCount: 128, aux: 5 });
	handler(SIOV);
	expect(cpu.Y).toBe(0x90);

	setDcb(machine, { command: 0x57, buffer: 0x2000, byteCount: 128, aux: 5 });
	handler(SIOV);
	expect(cpu.Y).toBe(0x90);
});

test("write sector stores bytes that read back", () => {
	const disk = new AtrImage(makeAtr(128, 4));
	const { machine, cpu, handler } = setup(disk);

	for (let i = 0; i < 128; i++) {
		machine.write(0x2000 + i, (i + 1) & 0xff, ReadOptions.NONE);
	}
	setDcb(machine, { command: 0x57, buffer: 0x2000, byteCount: 128, aux: 2 });

	expect(handler(SIOV)).toBe(0x60); // RTS
	expect(cpu.Y).toBe(0x01);

	const stored = disk.readSector(2)!;
	expect(stored[0]).toBe(1);
	expect(stored[127]).toBe(128 & 0xff);
	// A neighboring sector is untouched.
	expect(disk.readSector(3)![0]).toBe(3);
});

test("writes to a write-protected disk report a device error", () => {
	const disk = new AtrImage(makeAtr(128, 4), { writeProtected: true });
	const { machine, cpu, handler } = setup(disk);

	machine.write(0x2000, 0xff, ReadOptions.NONE);
	setDcb(machine, { command: 0x57, buffer: 0x2000, byteCount: 128, aux: 2 });
	handler(SIOV);

	expect(cpu.Y).toBe(0x90);
	expect(disk.readSector(2)![0]).toBe(2); // unchanged
});

test("the status command reports density and write protection", () => {
	// A writable single-density disk: neither bit.
	const single = setup(new AtrImage(makeAtr(128, 4)));
	setDcb(single.machine, { command: 0x53, buffer: 0x02ea, byteCount: 4 });
	single.handler(SIOV);
	expect(single.machine.read(0x02ea, ReadOptions.NONE)).toBe(0x00);

	// Double density sets the density bit.
	const double = setup(new AtrImage(makeAtr(256, 4)));
	setDcb(double.machine, { command: 0x53, buffer: 0x02ea, byteCount: 4 });
	double.handler(SIOV);
	expect(double.machine.read(0x02ea, ReadOptions.NONE)).toBe(0x20);

	// A protected disk sets the write-protect bit.
	const locked = setup(new AtrImage(makeAtr(128, 4), { writeProtected: true }));
	setDcb(locked.machine, { command: 0x53, buffer: 0x02ea, byteCount: 4 });
	locked.handler(SIOV);
	expect(locked.machine.read(0x02ea, ReadOptions.NONE)).toBe(0x08);
});

test("the trap fires on a real JSR through SIOV", () => {
	const { machine, cpu, handler } = setup(new AtrImage(makeAtr(128, 4)));
	machine.interceptExecute(SIOV, handler);
	setDcb(machine, { command: 0x52, buffer: 0x2000, byteCount: 128, aux: 3 });

	// JSR SIOV
	machine.write(0x0600, 0x20, ReadOptions.NONE);
	machine.write(0x0601, SIOV & 0xff, ReadOptions.NONE);
	machine.write(0x0602, SIOV >> 8, ReadOptions.NONE);

	cpu.reset(true);
	for (let i = 0; i < 20 && cpu.state !== DECODE; i++) cpu.run();
	cpu.PC = 0x0600;
	cpu.S = 0xfd;
	for (let i = 0; i < 60 && cpu.PC !== 0x0603; i++) cpu.run();

	expect(cpu.PC).toBe(0x0603);
	expect(cpu.Y).toBe(0x01);
	expect(machine.read(0x2000, ReadOptions.NONE)).toBe(3);
});
