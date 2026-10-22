import { describe, expect, test } from "vitest";
import { DECODE, type Memory } from "@sfotty-pie/sfotty";
import { RewindMachine } from "./rewind.ts";

/** A flat 64K RAM, the simplest bus that can hold a program. */
class Ram implements Memory {
	readonly bytes = new Uint8Array(0x10000);

	read(address: number): number {
		return this.bytes[address]!;
	}

	write(address: number, value: number): void {
		this.bytes[address] = value;
	}
}

/** Write consecutive bytes starting at `address`. */
function load(ram: Ram, address: number, ...bytes: number[]): void {
	bytes.forEach((byte, i) => (ram.bytes[address + i] = byte));
}

/**
 * Seed the machine at `pc` with a sane stack pointer, skipping the power-on
 * reset sequence a new CPU starts in.
 */
function start(ram: Ram, pc: number, historySize?: number): RewindMachine {
	const machine = new RewindMachine(ram, { historySize });
	machine.cpu.PC = pc;
	machine.cpu.S = 0xfd;
	machine.cpu.state = DECODE;
	return machine;
}

/** Everything that must come back identical after an undo. */
function snapshot(ram: Ram, machine: RewindMachine) {
	const cpu = machine.cpu;
	return {
		bytes: ram.bytes.slice(),
		a: cpu.A,
		x: cpu.X,
		y: cpu.Y,
		s: cpu.S,
		p: cpu.getP(),
		pc: cpu.PC,
		state: cpu.state,
		executed: machine.instructionsExecuted,
	};
}

/**
 * Fill $0300-$033F with an arithmetic series, then spin. Exercises indexed
 * stores, the flags, and a taken branch over 386 instructions.
 */
function loadFillLoop(ram: Ram): void {
	load(
		ram,
		0x0200,
		0xa2,
		0x00, // LDX #$00
		0xa9,
		0x01, // LDA #$01
		0x9d,
		0x00,
		0x03, // loop: STA $0300,X
		0x18, // CLC
		0x69,
		0x07, // ADC #$07
		0xe8, // INX
		0xe0,
		0x40, // CPX #$40
		0xd0,
		0xf5, // BNE loop
		0x4c,
		0x0f,
		0x02, // JMP *
	);
}

describe("step", () => {
	test("runs exactly one instruction", () => {
		const ram = new Ram();
		load(ram, 0x0200, 0xa9, 0x42, 0x85, 0x10); // LDA #$42; STA $10
		const machine = start(ram, 0x0200);

		machine.step();
		expect(machine.cpu.A).toBe(0x42);
		expect(machine.cpu.PC).toBe(0x0202);
		expect(ram.bytes[0x10]).toBe(0x00);

		machine.step();
		expect(ram.bytes[0x10]).toBe(0x42);
		expect(machine.cpu.PC).toBe(0x0204);
		expect(machine.instructionsExecuted).toBe(2);
	});

	test("leaves the CPU at an instruction boundary", () => {
		const ram = new Ram();
		loadFillLoop(ram);
		const machine = start(ram, 0x0200);

		for (let i = 0; i < 20; i++) machine.step();

		expect(machine.cpu.state).toBe(DECODE);
	});
});

describe("undo", () => {
	test("restores a register write", () => {
		const ram = new Ram();
		load(ram, 0x0200, 0xa9, 0x42); // LDA #$42
		const machine = start(ram, 0x0200);
		const before = snapshot(ram, machine);

		machine.step();
		expect(machine.undo()).toBe(true);

		expect(snapshot(ram, machine)).toEqual(before);
	});

	test("restores an overwritten byte", () => {
		const ram = new Ram();
		load(ram, 0x0200, 0x85, 0x10); // STA $10
		ram.bytes[0x10] = 0x99;
		const machine = start(ram, 0x0200);
		machine.cpu.A = 0x42;
		const before = snapshot(ram, machine);

		machine.step();
		expect(ram.bytes[0x10]).toBe(0x42);
		machine.undo();

		expect(ram.bytes[0x10]).toBe(0x99);
		expect(snapshot(ram, machine)).toEqual(before);
	});

	test("restores a read-modify-write, dummy write included", () => {
		const ram = new Ram();
		load(ram, 0x0200, 0xe6, 0x10); // INC $10
		ram.bytes[0x10] = 0x7f;
		const machine = start(ram, 0x0200);
		const before = snapshot(ram, machine);

		machine.step();
		expect(ram.bytes[0x10]).toBe(0x80);
		expect(machine.cpu.nFlag).toBe(true);
		machine.undo();

		expect(snapshot(ram, machine)).toEqual(before);
	});

	test("restores the stack across JSR, PHA, PLA and RTS", () => {
		const ram = new Ram();
		load(
			ram,
			0x0200,
			0xa9,
			0xaa, // LDA #$AA
			0x48, // PHA
			0x20,
			0x0a,
			0x02, // JSR $020A
			0x68, // PLA
			0x4c,
			0x07,
			0x02, // JMP *
		);
		load(ram, 0x020a, 0xe6, 0x10, 0x60); // INC $10; RTS
		const machine = start(ram, 0x0200);
		const before = snapshot(ram, machine);

		for (let i = 0; i < 6; i++) machine.step();
		expect(machine.cpu.PC).toBe(0x0207);
		expect(machine.cpu.A).toBe(0xaa);
		expect(ram.bytes[0x10]).toBe(0x01);

		for (let i = 0; i < 6; i++) expect(machine.undo()).toBe(true);

		expect(snapshot(ram, machine)).toEqual(before);
	});

	test("rewinds a long run to the exact starting state", () => {
		const ram = new Ram();
		loadFillLoop(ram);
		const machine = start(ram, 0x0200);
		const before = snapshot(ram, machine);

		const steps = 300;
		for (let i = 0; i < steps; i++) machine.step();

		// The run really did something, so the comparison below is meaningful.
		expect(ram.bytes.slice(0x0300, 0x0340)).not.toEqual(
			before.bytes.slice(0x0300, 0x0340),
		);
		expect(machine.depth).toBe(steps);

		for (let i = 0; i < steps; i++) expect(machine.undo()).toBe(true);

		expect(snapshot(ram, machine)).toEqual(before);
		expect(machine.canUndo()).toBe(false);
	});

	test("rewinds to any intermediate point", () => {
		const ram = new Ram();
		loadFillLoop(ram);
		const machine = start(ram, 0x0200);

		for (let i = 0; i < 120; i++) machine.step();
		const middle = snapshot(ram, machine);

		for (let i = 0; i < 90; i++) machine.step();
		for (let i = 0; i < 90; i++) machine.undo();

		expect(snapshot(ram, machine)).toEqual(middle);
	});

	test("re-running after an undo reproduces the same state", () => {
		const ram = new Ram();
		loadFillLoop(ram);
		const machine = start(ram, 0x0200);

		for (let i = 0; i < 150; i++) machine.step();
		const after = snapshot(ram, machine);

		for (let i = 0; i < 50; i++) machine.undo();
		for (let i = 0; i < 50; i++) machine.step();

		expect(snapshot(ram, machine)).toEqual(after);
	});

	test("reports nothing to undo on a fresh machine", () => {
		const machine = start(new Ram(), 0x0200);

		expect(machine.canUndo()).toBe(false);
		expect(machine.undo()).toBe(false);
	});
});

describe("historySize", () => {
	test("bounds how far back the machine can go", () => {
		const ram = new Ram();
		loadFillLoop(ram);
		const machine = start(ram, 0x0200, 4);

		for (let i = 0; i < 40; i++) machine.step();
		expect(machine.depth).toBe(4);

		for (let i = 0; i < 4; i++) expect(machine.undo()).toBe(true);
		expect(machine.undo()).toBe(false);
	});

	test("0 records nothing but still runs", () => {
		const ram = new Ram();
		loadFillLoop(ram);
		const machine = start(ram, 0x0200, 0);

		for (let i = 0; i < 40; i++) machine.step();

		expect(machine.instructionsExecuted).toBe(40);
		expect(machine.canUndo()).toBe(false);
		expect(ram.bytes[0x0300]).toBe(0x01);
	});

	test("clearHistory keeps the state but drops the past", () => {
		const ram = new Ram();
		loadFillLoop(ram);
		const machine = start(ram, 0x0200);

		for (let i = 0; i < 20; i++) machine.step();
		const now = snapshot(ram, machine);
		machine.clearHistory();

		expect(machine.canUndo()).toBe(false);
		expect(snapshot(ram, machine)).toEqual(now);
	});
});

describe("jams", () => {
	test("a CIM stops the machine and is not rewound past", () => {
		const ram = new Ram();
		load(ram, 0x0200, 0xa9, 0x42, 0x02); // LDA #$42; CIM
		const machine = start(ram, 0x0200);

		machine.step();
		machine.step();

		expect(machine.cpu.crashed).toBe(true);

		// Further steps are refused rather than spinning forever.
		machine.step();
		expect(machine.instructionsExecuted).toBe(2);
	});
});

describe("devices", () => {
	/**
	 * A bus with a memory-mapped register at $D010 that counts what it was
	 * told to print, so a replayed write is visible as a second print.
	 */
	class Device extends Ram {
		readonly printed: number[] = [];

		override write(address: number, value: number): void {
			if (address === 0xd010) {
				this.printed.push(value);
				return;
			}
			super.write(address, value);
		}
	}

	function startWith(
		ram: Ram,
		pc: number,
		devices: { start: number; end: number }[],
	) {
		const machine = new RewindMachine(ram, { devices });
		machine.cpu.PC = pc;
		machine.cpu.S = 0xfd;
		machine.cpu.state = DECODE;
		return machine;
	}

	const page = [{ start: 0xd000, end: 0xd0ff }];

	test("undo does not make a device act a second time", () => {
		const ram = new Device();
		load(ram, 0x0200, 0xa9, 0x41, 0x8d, 0x10, 0xd0); // LDA #$41; STA $D010
		const machine = startWith(ram, 0x0200, page);

		machine.step();
		machine.step();
		expect(ram.printed).toEqual([0x41]);

		machine.undo();
		expect(ram.printed).toEqual([0x41]);
	});

	test("still undoes the registers of the instruction that wrote", () => {
		const ram = new Device();
		load(ram, 0x0200, 0xa9, 0x41, 0x8d, 0x10, 0xd0); // LDA #$41; STA $D010
		const machine = startWith(ram, 0x0200, page);

		machine.step();
		machine.step();
		machine.undo();

		expect(machine.cpu.PC).toBe(0x0202);
		expect(machine.cpu.A).toBe(0x41);
	});

	test("still journals the rest of an instruction's writes", () => {
		const ram = new Device();
		// PHA pushes to the stack, which is RAM and must still come back.
		load(ram, 0x0200, 0x48); // PHA
		ram.bytes[0x01fd] = 0x99;
		const machine = startWith(ram, 0x0200, page);
		machine.cpu.A = 0x41;

		machine.step();
		expect(ram.bytes[0x01fd]).toBe(0x41);
		machine.undo();

		expect(ram.bytes[0x01fd]).toBe(0x99);
		expect(machine.cpu.S).toBe(0xfd);
	});

	test("treats both ends of a range as inside it", () => {
		const ram = new Ram();
		load(
			ram,
			0x0200,
			0x8d,
			0x00,
			0xd0, // STA $D000
			0x8d,
			0xff,
			0xd0, // STA $D0FF
			0x8d,
			0xff,
			0xcf, // STA $CFFF
		);
		const machine = startWith(ram, 0x0200, page);
		machine.cpu.A = 0x41;

		for (let i = 0; i < 3; i++) machine.step();
		expect(machine.depth).toBe(3);

		// Only the store below the page left something to put back.
		ram.bytes[0xd000] = 0;
		ram.bytes[0xd0ff] = 0;
		for (let i = 0; i < 3; i++) machine.undo();

		expect(ram.bytes[0xd000]).toBe(0);
		expect(ram.bytes[0xd0ff]).toBe(0);
		expect(ram.bytes[0xcfff]).toBe(0);
	});

	test("journals everything when no device is declared", () => {
		const ram = new Ram();
		load(ram, 0x0200, 0x8d, 0x10, 0xd0); // STA $D010
		ram.bytes[0xd010] = 0x99;
		const machine = start(ram, 0x0200);
		machine.cpu.A = 0x41;

		machine.step();
		machine.undo();

		expect(ram.bytes[0xd010]).toBe(0x99);
	});
});
