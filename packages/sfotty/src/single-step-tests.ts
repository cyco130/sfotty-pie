/* eslint-disable no-console */
import fs from "node:fs";
import { join } from "node:path";
import { DECODE, Sfotty } from "./index.ts";

// Runs the SingleStepTests/65x02 vectors against Sfotty, comparing final
// registers, touched RAM, and per-cycle bus activity. By default it tests all
// 256 opcodes; pass hex opcodes as arguments to test a specific subset, e.g.
// `pnpm single-step-tests a9 a5`.
//
// Vector files are fetched on demand into external.local/ (gitignored) and
// cached.

interface State {
	pc: number;
	s: number;
	a: number;
	x: number;
	y: number;
	p: number;
	ram: [number, number][];
}

interface SingleStepTest {
	name: string;
	initial: State;
	final: State;
	cycles: [number, number, "read" | "write"][];
}

const VECTOR_DIR = join(
	import.meta.dirname,
	"../../../external.local/65x02/6502/v1",
);
const BASE_URL =
	"https://raw.githubusercontent.com/SingleStepTests/65x02/main/6502/v1";

async function loadVectors(hex: string): Promise<SingleStepTest[]> {
	const file = join(VECTOR_DIR, `${hex}.json`);
	if (!fs.existsSync(file)) {
		console.log(`Fetching ${hex}.json`);
		const response = await fetch(`${BASE_URL}/${hex}.json`);
		if (!response.ok) {
			throw new Error(`Failed to fetch ${hex}.json: HTTP ${response.status}`);
		}
		fs.mkdirSync(VECTOR_DIR, { recursive: true });
		fs.writeFileSync(file, await response.text());
	}
	return JSON.parse(fs.readFileSync(file, "utf-8")) as SingleStepTest[];
}

/** Run one vector; returns null on success or a description of the first mismatch. */
function runTest(test: SingleStepTest): string | null {
	const ram = new Uint8Array(0x10000);
	for (const [address, value] of test.initial.ram) ram[address] = value;

	const cycles: [number, number, "read" | "write"][] = [];
	// The default options match the vectors' real NMOS hardware: undocumented
	// opcodes execute rather than crash.
	const sfotty = new Sfotty({
		read(address) {
			const value = ram[address]!;
			cycles.push([address, value, "read"]);
			return value;
		},
		write(address, value) {
			cycles.push([address, value, "write"]);
			ram[address] = value;
		},
	});

	sfotty.PC = test.initial.pc;
	sfotty.S = test.initial.s;
	sfotty.A = test.initial.a;
	sfotty.X = test.initial.x;
	sfotty.Y = test.initial.y;
	sfotty.setP(test.initial.p);
	sfotty.state = DECODE; // skip the power-on reset; the vector seeds the CPU

	// One run past the instruction; PC is captured at the nominal boundary while
	// registers settle on the trailing decode (see the commit-timing note).
	let pc = 0;
	try {
		for (let i = 0; i < test.cycles.length + 1; i++) {
			sfotty.run();
			if (i === test.cycles.length - 1) pc = sfotty.PC;
		}
	} catch (error) {
		return `threw: ${(error as Error).message}`;
	}

	const bad = (label: string, got: unknown, exp: unknown): string | null =>
		Object.is(got, exp) ? null : `${label}: got ${got}, expected ${exp}`;

	return (
		bad("PC", pc, test.final.pc) ??
		bad("S", sfotty.S, test.final.s) ??
		bad("A", sfotty.A, test.final.a) ??
		bad("X", sfotty.X, test.final.x) ??
		bad("Y", sfotty.Y, test.final.y) ??
		bad("P", sfotty.getP() | 0x30, test.final.p | 0x30) ??
		test.final.ram.reduce<string | null>(
			(err, [address, value]) =>
				err ?? bad(`ram[${address}]`, ram[address], value),
			null,
		) ??
		test.cycles.reduce<string | null>(
			(err, [address, value, rw], i) =>
				err ??
				bad(`cycle ${i} address`, cycles[i]?.[0], address) ??
				bad(`cycle ${i} value`, cycles[i]?.[1], value) ??
				bad(`cycle ${i} type`, cycles[i]?.[2], rw),
			null,
		)
	);
}

const args = process.argv.slice(2);
const opcodes = args.length
	? args.map((arg) => parseInt(arg.replace(/^0x/i, ""), 16))
	: Array.from({ length: 256 }, (_, i) => i);

let totalFailures = 0;
for (const opcode of opcodes) {
	const hex = opcode.toString(16).padStart(2, "0");
	const tests = await loadVectors(hex);
	let passed = 0;
	let firstFailure: string | null = null;
	for (const test of tests) {
		const failure = runTest(test);
		if (failure) {
			totalFailures++;
			firstFailure ??= `${test.name} — ${failure}`;
		} else {
			passed++;
		}
	}
	console.log(
		`${hex}: ${passed}/${tests.length}${firstFailure ? ` FAIL (${firstFailure})` : " ok"}`,
	);
}

if (totalFailures) {
	console.error(`\n${totalFailures} failing test(s).`);
	process.exitCode = 1;
} else {
	console.log(`\nAll ${opcodes.length} opcode(s) passed.`);
}
