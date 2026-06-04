import {
	DECODE,
	disassemble,
	type Memory,
	ReadOptions,
	Sfotty,
	traceLine,
} from "@sfotty-pie/sfotty";
import fs from "node:fs";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { Atari800 } from "./machine.ts";

function loadRom(name: string): Uint8Array {
	const path = fileURLToPath(
		new URL(`../../../roms.local/${name}`, import.meta.url),
	);
	return new Uint8Array(fs.readFileSync(path));
}

const machine = new Atari800({
	os: loadRom("800-b-ntsc.rom"),
	basic: loadRom("basic-c.rom"),
});

// Record every bus address touched in the current window so the watchdog can
// tell a real stuck loop from a legitimately long loop (e.g. the RAM test).
const touched = new Set<number>();
const bus: Memory = {
	read(address, options) {
		touched.add(address);
		return machine.read(address, options);
	},
	write(address, value) {
		touched.add(address);
		machine.write(address, value);
	},
};

const cpu = new Sfotty(bus, { withoutUndocumented: false });

const peek = (address: number) => machine.read(address, ReadOptions.PEEK);

// Power-on reset: jump to the reset vector with interrupts disabled.
cpu.resetPending = false;
cpu.S = 0xff;
cpu.iFlag = true;
cpu.PC = peek(0xfffc) | (peek(0xfffd) << 8);

const trace = process.argv.includes("--trace");

// --- Console via readline (line-buffered stdin) — good enough for BASIC. ---
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});
let stdinBuffer = Buffer.alloc(0);
let stdinOffset = 0;
let stdinClosed = false;
let onStdin: (() => void) | null = null;
rl.on("line", (line) => {
	stdinBuffer = Buffer.concat([
		stdinBuffer.subarray(stdinOffset),
		Buffer.from(line + "\n"),
	]);
	stdinOffset = 0;
	onStdin?.();
	onStdin = null;
});
rl.on("close", () => {
	stdinClosed = true;
	onStdin?.();
	onStdin = null;
});

// --- Execute traps: emulate OS-ROM entry points in the host. ---
function rts(): void {
	const lo = machine.read(0x0100 | ((cpu.S + 1) & 0xff), ReadOptions.NONE);
	const hi = machine.read(0x0100 | ((cpu.S + 2) & 0xff), ReadOptions.NONE);
	cpu.S = (cpu.S + 2) & 0xff;
	cpu.PC = (((hi << 8) | lo) + 1) & 0xffff;
}

function returnStatus(status: number): void {
	cpu.Y = status;
	cpu.nFlag = (status & 0x80) !== 0;
	cpu.zFlag = status === 0;
	rts();
}

function hex(value: number, width: number): string {
	return value.toString(16).toUpperCase().padStart(width, "0");
}

const SIO_TIMEOUT = 0x8a; // "device timeout" — no peripheral responded

// Thrown by the GETBYT trap when the stdin line buffer is empty: the run loop
// catches it, awaits the next line, and retries the same instruction.
const NEED_INPUT = Symbol("need-input");

// A trap returns true if it handled the call (already RTS'd — skip the real ROM
// routine) or false if it only observed (let the ROM code run).
const traps = new Map<number, () => boolean>();

// E: PUTBYT — write the ATASCII character in A to stdout, then return.
function editorPutByte(): boolean {
	const c = cpu.A & 0xff;
	fs.writeSync(1, Buffer.from([c === 0x9b ? 0x0a : c])); // EOL → newline
	returnStatus(0x01);
	return true;
}

// E: GETBYT — return the next stdin byte in A (as ATASCII), waiting if needed.
function editorGetByte(): boolean {
	if (stdinOffset >= stdinBuffer.length) {
		if (stdinClosed) process.exit(0); // stdin ended → end the session
		throw NEED_INPUT;
	}
	const c = stdinBuffer[stdinOffset++]!;
	cpu.A = c === 0x0a ? 0x9b : c; // newline → ATASCII EOL
	returnStatus(0x01);
	return true;
}

// Find a device's handler-vector table via HATABS ($031A): 3-byte entries
// [name, table-lo, table-hi], terminated by a zero name.
function findHandler(device: number): number {
	for (let addr = 0x031a; addr < 0x033f; addr += 3) {
		const name = machine.read(addr, ReadOptions.NONE);
		if (name === 0) break;
		if (name === device) {
			return (
				machine.read(addr + 1, ReadOptions.NONE) |
				(machine.read(addr + 2, ReadOptions.NONE) << 8)
			);
		}
	}
	return 0;
}

// On the first CIOV call HATABS is initialized, so discover E:'s GETBYT/PUTBYT
// routines (each stored as address-1) and trap them — OS-version independent.
let editorTrapped = false;
function installEditorTraps(): void {
	if (editorTrapped) return;
	editorTrapped = true;
	const table = findHandler(0x45); // 'E'
	if (table === 0) return;
	const word = (off: number) =>
		machine.read(table + off, ReadOptions.NONE) |
		(machine.read(table + off + 1, ReadOptions.NONE) << 8);
	const getByte = (word(4) + 1) & 0xffff;
	const putByte = (word(6) + 1) & 0xffff;
	traps.set(getByte, editorGetByte);
	traps.set(putByte, editorPutByte);
	process.stderr.write(
		`E: handler @ $${hex(table, 4)}  GETBYT=$${hex(getByte, 4)}  ` +
			`PUTBYT=$${hex(putByte, 4)}\n`,
	);
}

traps.set(0xe456, () => {
	// CIOV: only OPEN comes through here. Use it to install the E: byte traps,
	// then let the real OS run the open.
	installEditorTraps();
	return false;
});
traps.set(0xe459, () => {
	// SIOV: no peripherals → report a timeout so the OS abandons disk boot.
	machine.write(0x0303, SIO_TIMEOUT); // DSTATS
	returnStatus(SIO_TIMEOUT);
	return true;
});

// --- Stuck-loop watchdog + fake VBLANK RTCLOK tick. ---
const WINDOW = 10_000;
const FEW_PCS = 64;
const FEW_ADDRESSES = 32;
const STUCK_LIMIT = 2_000_000; // generous: past multi-frame OS startup delays
const LIMIT = 50_000_000;
const FRAME = 29868; // NTSC cycles per frame

const fetchCount = new Uint32Array(0x10000);
const seenPcs = new Set<number>();
let windowStart = 0;
let loopCycles = 0;
let cycles = 0;
let nextVblank = FRAME;

function dumpRegisters(): void {
	process.stderr.write(
		`  PC=${hex(cpu.PC, 4)} A=${hex(cpu.A, 2)} X=${hex(cpu.X, 2)} ` +
			`Y=${hex(cpu.Y, 2)} S=${hex(cpu.S, 2)} P=${hex(cpu.getP(), 2)}\n`,
	);
}

function reportStuck(): void {
	const pcs = [...seenPcs].sort((a, b) => a - b);
	const addresses = [...touched].sort((a, b) => a - b);
	process.stderr.write(
		`\nStuck at ${cycles} cycles (spinning ~${loopCycles}): ` +
			`${seenPcs.size} PCs, ${touched.size} addresses.\n` +
			`Addresses touched: ${addresses.map((a) => "$" + hex(a, 4)).join(" ")}\n` +
			`Loop body:\n`,
	);
	for (const pc of pcs) {
		process.stderr.write(
			`  ${hex(pc, 4)}  ${disassemble(peek, pc).text.padEnd(13)} ` +
				`(x${fetchCount[pc]})\n`,
		);
	}
	dumpRegisters();
}

function reportHotspots(): void {
	const hot = [...fetchCount.entries()]
		.filter(([, count]) => count > 0)
		.sort(([, a], [, b]) => b - a)
		.slice(0, 20);
	process.stderr.write(`\nReached ${cycles} cycles. Hottest PCs:\n`);
	for (const [pc, count] of hot) {
		process.stderr.write(
			`  ${hex(pc, 4)}  ${disassemble(peek, pc).text.padEnd(13)} (x${count})\n`,
		);
	}
	dumpRegisters();
}

async function run(): Promise<void> {
	while (cycles < LIMIT) {
		let trapped = false;
		if (cpu.state === DECODE) {
			fetchCount[cpu.PC] = (fetchCount[cpu.PC] ?? 0) + 1;
			seenPcs.add(cpu.PC);
			if (trace) process.stderr.write(traceLine(cpu, peek) + "\n");

			const trap = traps.get(cpu.PC);
			if (trap) {
				try {
					trapped = trap();
				} catch (error) {
					if (error === NEED_INPUT) {
						await new Promise<void>((resolve) => {
							onStdin = resolve;
						});
						continue;
					}
					throw error;
				}
			}
		}

		if (!trapped) {
			machine.cycle = cycles;
			cpu.run();
		}
		cycles++;

		if (cycles >= nextVblank) {
			nextVblank += FRAME;
			const lsb = (machine.read(0x14, ReadOptions.NONE) + 1) & 0xff;
			machine.write(0x14, lsb);
			if (lsb === 0) {
				const mid = (machine.read(0x13, ReadOptions.NONE) + 1) & 0xff;
				machine.write(0x13, mid);
				if (mid === 0) {
					machine.write(
						0x12,
						(machine.read(0x12, ReadOptions.NONE) + 1) & 0xff,
					);
				}
			}
		}

		if (cpu.crashed) {
			process.stderr.write(`\nCRASHED: ${cpu.describeState()}\n`);
			dumpRegisters();
			break;
		}

		if (cycles - windowStart >= WINDOW) {
			const small = seenPcs.size <= FEW_PCS && touched.size <= FEW_ADDRESSES;
			if (small) {
				loopCycles += cycles - windowStart;
				if (loopCycles >= STUCK_LIMIT) {
					reportStuck();
					break;
				}
			} else {
				loopCycles = 0;
			}
			seenPcs.clear();
			touched.clear();
			windowStart = cycles;
		}
	}

	if (cycles >= LIMIT) reportHotspots();
	rl.close();
}

await run();
