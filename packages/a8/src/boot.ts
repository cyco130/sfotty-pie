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
import { basename, join } from "node:path";
import { AtrImage } from "./atr.ts";
import { Cartridge } from "./cartridge.ts";
import { detectFileFormat } from "./detect-file-format.ts";
import { Atari } from "./machine.ts";
import { createSioHandler, SIOV } from "./sio.ts";
import { buildBootDisk } from "./xex-boot.ts";

function loadRom(name: string): Uint8Array {
	const path = join(import.meta.dirname, "../../../roms.local", name);
	return new Uint8Array(fs.readFileSync(path));
}

// Usage: boot.ts [--xl | --xe] [--trace] [--dump-frame] [file]
// `file` is an XEX, ATR, or cartridge image; like the web emulator's Load,
// booting a file is boot-image semantics — the 800's BASIC cart comes out.
const xe = process.argv.includes("--xe");
const xl = xe || process.argv.includes("--xl");
const filePath = process.argv.slice(2).find((arg) => !arg.startsWith("--"));

let cartridge: Cartridge | undefined;
let disk: AtrImage | undefined;

if (filePath) {
	const contents = new Uint8Array(fs.readFileSync(filePath));
	switch (detectFileFormat(contents, basename(filePath))) {
		case "atr":
			disk = new AtrImage(contents);
			break;
		case "xex":
			disk = buildBootDisk(contents);
			break;
		case "cart":
		case "raw-cart-8k-8000-9fff":
		case "raw-cart-8k-a000-bfff":
		case "raw-cart-16k":
			cartridge = new Cartridge(contents, basename(filePath));
			break;
		default:
			process.stderr.write(`${filePath}: not a loadable file format\n`);
			process.exit(1);
	}
}

const machine = new Atari({
	model: xe ? "130XE" : xl ? "800XL" : "800",
	os: loadRom(xl ? "xl-02.rom" : "800-b-ntsc.rom"),
	...(xl || !filePath ? { basic: loadRom("basic-c.rom") } : {}),
	...(cartridge ? { cartridge } : {}),
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

// Power-on reset: the seven-cycle RES sequence runs on the first run() calls
// and lands at the reset vector.
cpu.reset(true);

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

// Thrown by the GETBYT trap when the stdin line buffer is empty: the run loop
// catches it, awaits the next line, and retries the same instruction.
const NEED_INPUT = Symbol("need-input");

// A trap returns true if it handled the call (already RTS'd — skip the real ROM
// routine) or false if it only observed (let the ROM code run).
const traps = new Map<number, () => boolean>();

// E: PUTBYT — copy the ATASCII character in A to stdout, then let the real ROM
// routine run too, so the text also lands in screen RAM (and the framebuffer).
function editorPutByte(): boolean {
	const c = cpu.A & 0xff;
	fs.writeSync(1, Buffer.from([c === 0x9b ? 0x0a : c])); // EOL → newline
	return false;
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
}

traps.set(0xe456, () => {
	// CIOV: only OPEN comes through here. Use it to install the E: byte traps,
	// then let the real OS run the open.
	installEditorTraps();
	return false;
});
// SIOV: serve D1: from the attached image (trap-based SIO); everything else
// times out, so without a disk the OS abandons the disk boot like before. The
// handler returns a substitute RTS opcode for the bus-trap style; here we
// perform the RTS ourselves.
const sio = createSioHandler({
	machine,
	cpu,
	getDisk: (unit) => (unit === 1 ? disk : undefined),
});
traps.set(SIOV, () => {
	sio(SIOV);
	rts();
	return true;
});

traps.set(0xe471, () => {
	// BLKBDV, the Memo Pad ("blackboard") entry: the OS jumps here when there
	// is nothing left to run — e.g. a booted executable returned. Session over.
	process.exit(0);
});

// --- Stuck-loop watchdog. ---
const WINDOW = 10_000;
const FEW_PCS = 64;
const FEW_ADDRESSES = 32;
// Generous: past multi-frame OS startup delays AND test-suite deadman
// timeouts (Acid800's serial-input test spins for many emulated seconds
// before its own timeout gives up).
const STUCK_LIMIT = 30_000_000;
const LIMIT = 1_000_000_000;

// With --nudge: when a small loop persists, the program is often polling for
// a keypress (e.g. Acid800's "press any key" does BIT $D20E) — that bypasses
// the E: traps, so press Return through the real keyboard matrix before
// declaring it stuck. Off by default: Acid800's standalone tests *rerun* on a
// keypress, where stopping at the wait loop is the better outcome.
const nudgeEnabled = process.argv.includes("--nudge");
const NUDGE_AT = 500_000; // spin cycles before the first nudge (then doubled)
const NUDGE_HOLD = 30_000; // ~2 frames of key-down
const MAX_NUDGES = 3;
let nudges = 0;
let keyUpAt = 0;

const fetchCount = new Uint32Array(0x10000);
const seenPcs = new Set<number>();
let windowStart = 0;
let loopCycles = 0;
let cycles = 0;

// The framebuffer ANTIC/GTIA renders into: 240 lines of 376 hi-res pixels (94
// visible cycles x 4), one Atari color byte each.
const frame = new Uint8Array(376 * 240);

if (process.argv.includes("--dump-frame")) {
	// Render the last frame as ASCII art on exit. Hooked on the exit event
	// because the normal exit path is process.exit() inside the GETBYT trap.
	process.on("exit", dumpFrame);
}

function dumpFrame(): void {
	// Call the most frequent color the background.
	const counts = new Uint32Array(256);
	for (const value of frame) counts[value]!++;
	let bg = 0;
	for (let i = 1; i < 256; i++) {
		if (counts[i]! > counts[bg]!) bg = i;
	}

	process.stderr.write(`\nFrame dump (" " = $${hex(bg, 2)}):\n`);
	for (let y = 0; y < 240; y += 4) {
		let line = "";
		for (let x = 0; x < 376; x += 2) {
			line += frame[y * 376 + x] === bg ? " " : "#";
		}
		process.stderr.write(line + "\n");
	}
}

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
	const ag = machine.anticGtia;

	while (cycles < LIMIT) {
		ag.beforeCpu();
		machine.cycle();
		cpu.NMI = ag.nmi;
		cpu.IRQ = machine.irq;
		cpu.RDY = ag.rdy;

		let trapped = false;

		// Traps fire on an opcode fetch the CPU will actually perform — not on
		// halted cycles (the CPU is frozen), and not while a WSYNC stall is
		// repeating the fetch (the trap would fire once per stalled cycle).
		if (!ag.halt && cpu.RDY && cpu.state === DECODE) {
			fetchCount[cpu.PC] = (fetchCount[cpu.PC] ?? 0) + 1;
			seenPcs.add(cpu.PC);
			if (trace) process.stderr.write(traceLine(cpu, peek) + "\n");

			const trap = traps.get(cpu.PC);
			if (trap) {
				try {
					trapped = trap();
				} catch (error) {
					if (error !== NEED_INPUT) throw error;
					// Keep beforeCpu/afterCpu paired for this cycle, then wait
					// for input and retry the same instruction.
					ag.afterCpu(frame, machine.busData);
					cycles++;
					await new Promise<void>((resolve) => {
						onStdin = resolve;
					});
					continue;
				}
			}
		}

		if (!trapped && !ag.halt) {
			cpu.run();
		}

		ag.afterCpu(frame, machine.busData);
		cycles++;

		if (cpu.crashed) {
			process.stderr.write(`\nCRASHED: ${cpu.describeState()}\n`);
			dumpRegisters();
			break;
		}

		if (keyUpAt !== 0 && cycles >= keyUpAt) {
			machine.pokeyKeyUp();
			keyUpAt = 0;
		}

		if (cycles - windowStart >= WINDOW) {
			const small = seenPcs.size <= FEW_PCS && touched.size <= FEW_ADDRESSES;
			if (small) {
				loopCycles += cycles - windowStart;
				if (
					nudgeEnabled &&
					nudges < MAX_NUDGES &&
					loopCycles >= NUDGE_AT << nudges
				) {
					nudges++;
					machine.pokeyKeyDown(0x0c); // Return
					keyUpAt = cycles + NUDGE_HOLD;
				}
				if (loopCycles >= STUCK_LIMIT) {
					reportStuck();
					break;
				}
			} else {
				loopCycles = 0;
				nudges = 0;
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
