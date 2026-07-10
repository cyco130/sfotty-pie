import { describe, test, expect } from "vitest";
import { Sfotty } from "@sfotty-pie/sfotty";
import { crashDump } from "./crash-dump.ts";

describe("crashDump", () => {
	test("renders the microstate and the recent disassembly", () => {
		const ram = new Uint8Array(65536);
		// $0400: LDX #$FF; INX; CIM (jam)
		ram.set([0xa2, 0xff, 0xe8, 0x02], 0x0400);
		ram[0xfffc] = 0x00;
		ram[0xfffd] = 0x04;

		const cpu = new Sfotty({
			read: (address) => ram[address]!,
			write: (address, value) => {
				ram[address] = value;
			},
		});

		const recentPCs: number[] = [];
		cpu.onFetch = (pc) => recentPCs.push(pc);

		let cycles = 0;
		while (!cpu.crashed && cycles++ < 100) {
			cpu.run();
		}
		expect(cpu.crashed).toBe(true);

		const dump = crashDump(cpu, (address) => ram[address & 0xffff]!, recentPCs);
		const lines = dump.split("\n");

		expect(lines[0]).toMatch(/^CPU state: CIM imp/);
		expect(lines[1]).toBe("Last instructions:");
		expect(lines[2]).toBe("  0400  A2 FF    LDX #$FF");
		expect(lines[3]).toBe("  0402  E8       INX");
		// The final line is the jam instruction with the register annotation
		// (X wrapped FF -> 00 via INX).
		expect(lines[4]).toContain("0403  02       CIM");
		expect(lines[4]).toContain("X=00");
	});

	test("omits the instruction list when nothing has executed", () => {
		const cpu = new Sfotty({ read: () => 0, write: () => {} });
		const dump = crashDump(cpu, () => 0, []);
		expect(dump).toMatch(/^CPU state: /);
		expect(dump).not.toContain("Last instructions:");
	});
});
