import { describe, test, expect } from "vitest";
import { Sfotty } from "./sfotty.ts";
import { DECODE } from "./microcode.ts";
import { type Memory } from "./bus.ts";

/**
 * A flat 64K RAM that also tallies how many times each address is read/written
 * — the access counts back the RDY tests. The single-step tests cover instruction
 * behavior; these tests cover what it doesn't: the config flags and RDY.
 */
class Ram implements Memory {
	readonly bytes = new Uint8Array(0x10000);
	readonly reads = new Uint32Array(0x10000);
	readonly writes = new Uint32Array(0x10000);

	read(address: number): number {
		this.reads[address] = this.reads[address]! + 1;
		return this.bytes[address]!;
	}

	write(address: number, value: number): void {
		this.writes[address] = this.writes[address]! + 1;
		this.bytes[address] = value;
	}
}

/** Write consecutive bytes starting at `address`. */
function load(ram: Ram, address: number, ...bytes: number[]): void {
	bytes.forEach((byte, i) => (ram.bytes[address + i] = byte));
}

/**
 * Run from the opcode-fetch state through one full instruction, stopping when
 * it returns to DECODE. Do not call on a crashing opcode — it never returns.
 */
function runInstruction(cpu: Sfotty): void {
	do {
		cpu.run();
	} while (cpu.state !== DECODE);
}

/**
 * Seed PC directly and skip the power-on reset sequence (a new CPU starts
 * mid-cold-reset), jumping straight to the opcode fetch.
 */
function jumpTo(cpu: Sfotty, pc: number): void {
	cpu.PC = pc;
	cpu.state = DECODE;
}

describe("withoutDecimal", () => {
	test("decimal mode is honored by default — ADC produces BCD", () => {
		const ram = new Ram();
		load(ram, 0x0200, 0x69, 0x01); // ADC #$01
		const cpu = new Sfotty(ram);
		jumpTo(cpu, 0x0200);
		cpu.A = 0x09;
		cpu.dFlag = true;
		cpu.cFlag = false;

		runInstruction(cpu);

		expect(cpu.A).toBe(0x10); // 0x09 + 0x01 in BCD
	});

	test("withoutDecimal keeps ADC binary, but the D flag still exists", () => {
		const ram = new Ram();
		load(ram, 0x0200, 0x69, 0x01); // ADC #$01
		const cpu = new Sfotty(ram, { withoutDecimal: true });
		jumpTo(cpu, 0x0200);
		cpu.A = 0x09;
		cpu.dFlag = true;
		cpu.cFlag = false;

		runInstruction(cpu);

		expect(cpu.A).toBe(0x0a); // binary add, D ignored
		expect(cpu.dFlag).toBe(true); // the flag itself is unaffected
	});
});

describe("withoutUndocumented", () => {
	test("undocumented opcodes execute by default", () => {
		const ram = new Ram();
		load(ram, 0x0200, 0xa7, 0x05); // LAX $05 (undocumented)
		ram.bytes[0x05] = 0x42;
		const cpu = new Sfotty(ram);
		jumpTo(cpu, 0x0200);

		runInstruction(cpu);

		expect(cpu.A).toBe(0x42);
		expect(cpu.X).toBe(0x42);
		expect(cpu.crashed).toBe(false);
	});

	test("undocumented opcodes jam like CIM when enabled", () => {
		const ram = new Ram();
		load(ram, 0x0200, 0xa7, 0x05); // LAX $05
		ram.bytes[0x05] = 0x42;
		const cpu = new Sfotty(ram, { withoutUndocumented: true });
		jumpTo(cpu, 0x0200);

		// The opcode runs CIM's microcode: dummy reads of $FFFF/$FFFE for several
		// cycles, then the crash on `cc--`. Every cycle stays bus-visible.
		for (let i = 0; i < 10 && !cpu.crashed; i++) cpu.run();

		expect(cpu.crashed).toBe(true);
		expect(cpu.A).toBe(0); // never loaded — the op did not run
		expect(ram.reads[0xffff]).toBeGreaterThan(0); // the jam preamble's reads
		expect(ram.reads[0xfffe]).toBe(2);
	});

	test("a CIM opcode crashes via its own microcode even by default", () => {
		const ram = new Ram();
		load(ram, 0x0200, 0x02); // CIM
		const cpu = new Sfotty(ram);
		jumpTo(cpu, 0x0200);

		// Its real microcode dummy-reads for several cycles, then crashes on `cc--`.
		for (let i = 0; i < 10 && !cpu.crashed; i++) cpu.run();

		expect(cpu.crashed).toBe(true);
	});
});

describe("RDY", () => {
	test("RDY low stalls the opcode fetch, re-reading PC without advancing", () => {
		const ram = new Ram();
		ram.bytes[0x0200] = 0xea; // NOP
		const cpu = new Sfotty(ram);
		jumpTo(cpu, 0x0200);

		cpu.RDY = false;
		for (let i = 0; i < 3; i++) cpu.run();

		// State frozen at DECODE, PC unmoved — but the read was issued each cycle.
		expect(cpu.state).toBe(DECODE);
		expect(cpu.PC).toBe(0x0200);
		expect(ram.reads[0x0200]).toBe(3);

		// Raising RDY lets the very next cycle complete the fetch.
		cpu.RDY = true;
		cpu.run();
		expect(cpu.PC).toBe(0x0201);
		expect(cpu.state).not.toBe(DECODE);
		expect(ram.reads[0x0200]).toBe(4);
	});

	test("write cycles ignore RDY and run to completion", () => {
		const ram = new Ram();
		load(ram, 0x0200, 0x85, 0x05); // STA $05
		const cpu = new Sfotty(ram);
		jumpTo(cpu, 0x0200);
		cpu.A = 0x42;

		// Fetch + operand read with RDY high, leaving us on the write cycle.
		cpu.run();
		cpu.run();
		expect(ram.writes[0x05]).toBe(0);

		// The write cycle completes even though RDY is low.
		cpu.RDY = false;
		cpu.run();
		expect(ram.bytes[0x05]).toBe(0x42);
		expect(ram.writes[0x05]).toBe(1);
		expect(cpu.state).toBe(DECODE);
	});

	test("a stalled read is re-issued; the cycle RDY rises is the one consumed", () => {
		const ram = new Ram();
		load(ram, 0x0200, 0xa9, 0x11); // LDA #$11
		const cpu = new Sfotty(ram);
		jumpTo(cpu, 0x0200);

		cpu.run(); // fetch the opcode (RDY high)

		// Stall on the immediate-operand read; it re-reads $0201 each cycle.
		cpu.RDY = false;
		cpu.run();
		cpu.run();
		expect(ram.reads[0x0201]).toBe(2);
		expect(cpu.A).toBe(0); // nothing consumed yet

		// Change the byte under the stall, then release: the release read wins.
		ram.bytes[0x0201] = 0x22;
		cpu.RDY = true;
		cpu.run();
		expect(cpu.A).toBe(0x22);
		expect(cpu.state).toBe(DECODE);
	});
});

describe("reset", () => {
	test("a new CPU powers on into the cold-reset sequence", () => {
		const ram = new Ram();
		ram.bytes[0xfffc] = 0x00;
		ram.bytes[0xfffd] = 0x03;
		const cpu = new Sfotty(ram);

		// No reset() call — construction itself is the power-on.
		for (let i = 0; i < 7; i++) cpu.run();

		expect(cpu.PC).toBe(0x0300);
		expect(cpu.S).toBe(0xfd);
		expect(cpu.iFlag).toBe(true);
		expect(cpu.state).toBe(DECODE);
	});

	test("cold reset wipes registers, sets I, loads PC from $FFFC, leaves S = $FD", () => {
		const ram = new Ram();
		ram.bytes[0xfffc] = 0x34;
		ram.bytes[0xfffd] = 0x12;
		const cpu = new Sfotty(ram);
		// Dirty state a cold reset must wipe.
		cpu.A = 0x11;
		cpu.X = 0x22;
		cpu.Y = 0x33;
		cpu.dFlag = true;

		cpu.reset(true);
		for (let i = 0; i < 7; i++) cpu.run();

		expect(cpu.PC).toBe(0x1234);
		expect(cpu.S).toBe(0xfd); // 0 − 3, the canonical power-on value
		expect(cpu.iFlag).toBe(true);
		expect(cpu.A).toBe(0);
		expect(cpu.X).toBe(0);
		expect(cpu.Y).toBe(0);
		expect(cpu.dFlag).toBe(false);
		expect(cpu.state).toBe(DECODE);
		expect(ram.reads[0xfffc]).toBe(1);
		expect(ram.reads[0xfffd]).toBe(1);
	});

	test("the reset sequence takes exactly seven cycles", () => {
		const ram = new Ram();
		ram.bytes[0xfffc] = 0x00;
		ram.bytes[0xfffd] = 0x03;
		const cpu = new Sfotty(ram);

		cpu.reset(true);
		for (let i = 0; i < 6; i++) cpu.run();
		expect(cpu.state).not.toBe(DECODE); // not done after six
		cpu.run(); // seventh
		expect(cpu.state).toBe(DECODE);
		expect(cpu.PC).toBe(0x0300);
	});

	test("warm reset preserves registers and D; S −= 3 and I is set", () => {
		const ram = new Ram();
		ram.bytes[0xfffc] = 0x78;
		ram.bytes[0xfffd] = 0x56;
		const cpu = new Sfotty(ram);
		cpu.A = 0x42;
		cpu.X = 0x33;
		cpu.Y = 0x44;
		cpu.S = 0x80;
		cpu.dFlag = true;
		cpu.iFlag = false;

		cpu.reset(false);
		for (let i = 0; i < 7; i++) cpu.run();

		expect(cpu.PC).toBe(0x5678);
		expect(cpu.S).toBe(0x7d); // 0x80 − 3
		expect(cpu.iFlag).toBe(true);
		expect(cpu.A).toBe(0x42); // preserved
		expect(cpu.X).toBe(0x33);
		expect(cpu.Y).toBe(0x44);
		expect(cpu.dFlag).toBe(true); // NMOS reset doesn't touch D
		expect(cpu.state).toBe(DECODE);
	});

	test("reset clears a CIM crash and resumes from the vector", () => {
		const ram = new Ram();
		load(ram, 0x0200, 0x02); // CIM — jams
		ram.bytes[0xfffc] = 0x00;
		ram.bytes[0xfffd] = 0x03;
		load(ram, 0x0300, 0xa9, 0x55); // LDA #$55 at the reset vector
		const cpu = new Sfotty(ram);
		jumpTo(cpu, 0x0200);

		for (let i = 0; i < 8 && !cpu.crashed; i++) cpu.run();
		expect(cpu.crashed).toBe(true);

		cpu.reset(true);
		expect(cpu.crashed).toBe(false);
		for (let i = 0; i < 7; i++) cpu.run();
		expect(cpu.PC).toBe(0x0300);

		runInstruction(cpu); // LDA #$55
		expect(cpu.A).toBe(0x55);
	});

	test("RDY low stalls the reset sequence", () => {
		const ram = new Ram();
		ram.bytes[0xfffc] = 0x00;
		ram.bytes[0xfffd] = 0x03;
		const cpu = new Sfotty(ram);

		cpu.reset(true);
		cpu.RDY = false;
		for (let i = 0; i < 20; i++) cpu.run(); // all stalled on the first read
		expect(cpu.state).not.toBe(DECODE);
		expect(cpu.PC).toBe(0);

		cpu.RDY = true;
		for (let i = 0; i < 7; i++) cpu.run();
		expect(cpu.PC).toBe(0x0300);
		expect(cpu.state).toBe(DECODE);
	});
});
