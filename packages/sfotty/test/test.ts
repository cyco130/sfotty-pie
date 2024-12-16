/* eslint-disable no-console */
// @ts-expect-error: Too lazy to add NodeJS types
import fs from "node:fs";
import { Sfotty } from "../src";
import { VANILLA_OPCODES } from "@sfotty-pie/opcodes";

for (let opcode = 0; opcode < 256; opcode++) {
	if (!VANILLA_OPCODES.find((o) => o.opcode === opcode)) {
		continue;
	}

	const oc = opcode.toString(16).padStart(2, "0").toLowerCase();
	const file = fs.readFileSync(
		`/Users/fatih/Documents/github/65x02/6502/v1/${oc}.json`,
		"utf-8",
	);

	const tests: Array<{
		name: string;
		initial: {
			pc: number;
			s: number;
			a: number;
			x: number;
			y: number;
			p: number;
			ram: [number, number][];
		};
		final: {
			pc: number;
			s: number;
			a: number;
			x: number;
			y: number;
			p: number;
			ram: [number, number][];
		};
		cycles: [number, number, "read" | "write"][];
	}> = JSON.parse(file);

	for (const test of tests) {
		const ram = new Uint8Array(0x10000);
		for (const [address, value] of test.initial.ram) {
			ram[address] = value;
		}

		const cycles: [number, number, "read" | "write"][] = [];

		const sfotty = new Sfotty({
			read(address) {
				const result = ram[address]!;
				cycles.push([address, result, "read"]);
				return result;
			},
			write(address, value) {
				cycles.push([address, value, "write"]);
				ram[address] = value;
			},
		});

		// if (test.name === "61 50 3c") {
		// 	debugger;
		//  sfotty.trace = true;
		// }

		sfotty.resetPending = false;
		sfotty.PC = test.initial.pc;
		sfotty.S = test.initial.s;
		sfotty.A = test.initial.a;
		sfotty.X = test.initial.x;
		sfotty.Y = test.initial.y;
		sfotty.setP(test.initial.p);

		for (const [address, value] of test.initial.ram) {
			ram[address] = value;
		}

		// sfotty.trace = true;
		let PC = 0;
		for (let i = 0; i < test.cycles.length + 1; i++) {
			sfotty.run();
			if (i === test.cycles.length - 1) {
				PC = sfotty.PC;
			}
		}

		function check<T>(message: string, actual: T, expected: T) {
			if (!Object.is(expected, actual)) {
				console.dir(test, { depth: null });
				console.dir(cycles, { depth: null });

				throw new Error(
					test.name +
						": " +
						message +
						`: expected ${expected}, got ${actual}`,
				);
			}
		}

		check("PC", PC, test.final.pc);
		check("S", sfotty.S, test.final.s);
		check("A", sfotty.A, test.final.a);
		check("X", sfotty.X, test.final.x);
		check("Y", sfotty.Y, test.final.y);
		check("P", sfotty.getP() | 0x30, test.final.p | 0x30);

		for (const [address, value] of test.final.ram) {
			check(`RAM address ${address}`, value, ram[address]);
		}

		let i = 0;
		for (const [address, value, rw] of test.cycles) {
			const cycle = cycles[i++];
			check(`Bus access address ${i - 1}`, cycle?.[0], address);
			check(`Bus access value ${i - 1}`, cycle?.[1], value);
			check(`Bus access type ${i - 1}`, cycle?.[2], rw);
		}
	}
}
