import { describe, test, expect } from "vitest";
import { Sfotty } from "./sfotty.ts";
import { type Memory } from "./interface.ts";

// Specs for the seven interrupt-recognition behaviors of the NMOS 6502.
//
// The observables: a serviced interrupt vectors PC to a handler and pushes a
// three-byte frame, so we read the pushed return address and status off the
// stack (S seeded to $ff: PCH at $01ff, PCL at $01fe, P at $01fd) and inspect
// which handler page PC reaches.
//
// The exact cycle at which a line is asserted is the crux of several points;
// these counts match the implementation, but the precise hijack window (point 6)
// and the "lost if too short" boundary (point 7) are still pending confirmation
// against a Visual6502 trace.

const NOP = 0xea;
const CIM = 0x02; // jams — a "control reached here" marker at handler entries
const CLI = 0x58;
const BRK = 0x00;
const BNE = 0xd0;

const IRQ_VEC = 0x0400;
const NMI_VEC = 0x0500;

class Ram implements Memory {
	readonly bytes = new Uint8Array(0x10000).fill(NOP);
	read(address: number): number {
		return this.bytes[address]!;
	}
	write(address: number, value: number): void {
		this.bytes[address] = value;
	}
}

function word(ram: Ram, addr: number, value: number): void {
	ram.bytes[addr] = value & 0xff;
	ram.bytes[addr + 1] = (value >> 8) & 0xff;
}

/** A CPU at $0200 with S=$ff and IRQ/NMI vectors wired to CIM-jam handlers. */
function newCpu(): { cpu: Sfotty; ram: Ram } {
	const ram = new Ram();
	word(ram, 0xfffa, NMI_VEC);
	word(ram, 0xfffe, IRQ_VEC);
	ram.bytes[IRQ_VEC] = CIM;
	ram.bytes[NMI_VEC] = CIM;
	const cpu = new Sfotty(ram);
	cpu.PC = 0x0200;
	cpu.S = 0xff;
	return { cpu, ram };
}

function run(cpu: Sfotty, cycles: number): void {
	for (let i = 0; i < cycles; i++) cpu.run();
}

/** Return address pushed by the first interrupt/BRK frame (S started $ff). */
function frame1Return(ram: Ram): number {
	return (ram.bytes[0x01ff]! << 8) | ram.bytes[0x01fe]!;
}

/** Status byte pushed by the first frame — its bit 4 is the B flag. */
function frame1Status(ram: Ram): number {
	return ram.bytes[0x01fd]!;
}

/** Return address pushed by the second frame (a nested interrupt). */
function frame2Return(ram: Ram): number {
	return (ram.bytes[0x01fc]! << 8) | ram.bytes[0x01fb]!;
}

describe("interrupts", () => {
	test("1: a pending IRQ runs the interrupt sequence at a decode", () => {
		const { cpu, ram } = newCpu();
		cpu.iFlag = false;
		cpu.IRQ = true; // held

		run(cpu, 40);

		// Vectored to the IRQ handler, with one three-byte frame pushed and the
		// B flag clear (a hardware IRQ, not a BRK).
		expect(cpu.PC & 0xff00).toBe(IRQ_VEC & 0xff00);
		expect(cpu.S).toBe(0xfc);
		expect(frame1Status(ram) & 0x10).toBe(0);
	});

	test("2: an IRQ held from the start is taken after exactly one instruction", () => {
		const { cpu, ram } = newCpu(); // $0200.. are NOPs (2 cycles each)
		cpu.iFlag = false;
		cpu.IRQ = true;

		run(cpu, 40);

		// The very first decode can't see it (nothing was polled two cycles
		// earlier), so the first NOP retires and the IRQ is taken at the next
		// decode — the pushed return address is the *second* instruction.
		expect(frame1Return(ram)).toBe(0x0201);
	});

	test("3: an NMI latched during an IRQ sequence waits for one handler instruction", () => {
		const { cpu, ram } = newCpu();
		ram.bytes[IRQ_VEC] = NOP; // handler: one NOP, then jam
		ram.bytes[IRQ_VEC + 1] = CIM;
		cpu.iFlag = false;
		cpu.IRQ = true; // IRQ taken after the first NOP (return $0201)

		// Pulse NMI mid-IRQ-sequence, past the hijack window so it doesn't steal
		// the IRQ vector — it must be latched and serviced *after* the handler's
		// first instruction, not at the post-sequence decode.
		run(cpu, 7);
		cpu.NMI = true;
		run(cpu, 40);

		// Two frames: the IRQ, then the NMI taken after the handler's NOP — so the
		// NMI's return address is the handler's *second* instruction, not its entry.
		expect(cpu.PC & 0xff00).toBe(NMI_VEC & 0xff00);
		expect(frame2Return(ram)).toBe(IRQ_VEC + 1);
	});

	test("4: CLI delays a pending IRQ until after the next instruction", () => {
		const { cpu, ram } = newCpu();
		ram.bytes[0x0200] = CLI; // then NOPs
		cpu.iFlag = true; // IRQ currently masked
		cpu.IRQ = true; // held

		run(cpu, 40);

		// The poll at CLI's last cycle still sees I set, so the IRQ is not taken at
		// CLI's boundary; the instruction after CLI ($0201) runs first, and the IRQ
		// is taken at the boundary after it — return address $0202.
		expect(frame1Return(ram)).toBe(0x0202);
	});

	test("5: a taken non-crossing branch delays an interrupt arriving in its last cycle", () => {
		const { cpu, ram } = newCpu();
		// $0200 BNE +2 (taken, no page cross) -> $0204; $0204.. are NOPs.
		ram.bytes[0x0200] = BNE;
		ram.bytes[0x0201] = 0x02;
		cpu.zFlag = false; // branch taken
		cpu.iFlag = false;

		// Assert IRQ during the branch's final (PCL-add) cycle, which doesn't poll.
		// A normal instruction would take the IRQ at its own boundary; the branch
		// defers it one instruction, so the first NOP at the target runs first and
		// the pushed return address is $0205, not $0204.
		run(cpu, 2); // through the branch's add cycle
		cpu.IRQ = true;
		run(cpu, 40);

		expect(frame1Return(ram)).toBe(0x0205);
	});

	test("6: an NMI during the first cycles of a BRK hijacks the vector (B stays set)", () => {
		const { cpu, ram } = newCpu();
		ram.bytes[0x0200] = BRK; // $00; pushes PC+2 = $0202

		run(cpu, 2); // enter the BRK sequence
		cpu.NMI = true; // within the first four cycles
		run(cpu, 40);

		// Vectored through the NMI vector, but the pushed status still has B set
		// (the sequence originated as a BRK) and the return address is BRK's PC+2.
		expect(cpu.PC & 0xff00).toBe(NMI_VEC & 0xff00);
		expect(frame1Status(ram) & 0x10).toBe(0x10);
		expect(frame1Return(ram)).toBe(0x0202);
	});

	test("7: an NMI pulsed across the BRK push-P and vector cycles is lost", () => {
		const { cpu, ram } = newCpu();
		ram.bytes[0x0200] = BRK;
		ram.bytes[IRQ_VEC] = NOP; // non-jamming handler, so a wrongly-serviced NMI shows up

		// BRK cycles (decode = c0): c0 fetch, c1 read, c2/c3/c4 push PCH/PCL/P,
		// c5 vector-low, c6 vector-high. NMI true at the start of c4 (the push-P
		// cycle — too late to hijack) and false again at c6, i.e. held for only two
		// cycles. It must be completely lost: never latched past the sequence.
		run(cpu, 4); // c0..c3
		cpu.NMI = true; // start of c4 (push-P)
		run(cpu, 2); // c4, c5
		cpu.NMI = false; // start of c6 (vector-high) — gone before the sequence ends
		run(cpu, 40);

		// Vectored through the BRK/IRQ vector, and only the BRK frame exists — the
		// NMI was dropped, so PC never reaches the NMI handler and S isn't pushed
		// a second time.
		expect(cpu.PC & 0xff00).toBe(IRQ_VEC & 0xff00);
		expect(cpu.S).toBe(0xfc);
	});

	test("7b: an NMI held past the BRK sequence is serviced after the handler", () => {
		const { cpu, ram } = newCpu();
		ram.bytes[0x0200] = BRK;
		ram.bytes[IRQ_VEC] = NOP; // handler: one NOP, then jam
		ram.bytes[IRQ_VEC + 1] = CIM;

		run(cpu, 4); // c0..c3
		cpu.NMI = true; // start of c4 (push-P), now held
		run(cpu, 40);

		// Too late to hijack (BRK took the IRQ/BRK vector), but the held NMI
		// outlasts the sequence, so it's serviced after the handler's first
		// instruction — the NMI frame's return is the handler's second instruction.
		expect(cpu.PC & 0xff00).toBe(NMI_VEC & 0xff00);
		expect(frame2Return(ram)).toBe(IRQ_VEC + 1);
	});
});
