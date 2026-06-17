import { DECODE, ReadOptions, Sfotty, traceLine } from "@sfotty-pie/sfotty";
import fs from "node:fs";
import readline from "node:readline";
import { basename } from "node:path";
import { AtrImage } from "./atr.ts";
import { Cartridge } from "./cartridge.ts";
import { detectFileFormat } from "./detect-file-format.ts";
import { Atari } from "./machine.ts";
import { createSioHandler, SIOV } from "./sio.ts";
import { buildBootDisk } from "./xex-boot.ts";

// Usage: boot.ts --os <file> [--basic <file>] [--xl | --xe] [--pal] [--trace] [--dump-frame] [file]
// `--os`/`--basic` are paths to the OS and BASIC ROM images. `file` is an XEX,
// ATR, or cartridge image; like the web emulator's Load, booting a file is
// boot-image semantics — the 800's BASIC cart comes out.
const argv = process.argv.slice(2);

/** The value following a `--flag`, if present. */
function flagValue(name: string): string | undefined {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
}

function loadRom(path: string | undefined, flag: string): Uint8Array {
	if (!path) {
		process.stderr.write(`Pass ${flag} <file> with a ROM image.\n`);
		process.exit(1);
	}
	return new Uint8Array(fs.readFileSync(path));
}

const osPath = flagValue("--os");
const basicPath = flagValue("--basic");
const xe = argv.includes("--xe");
const xl = xe || argv.includes("--xl");
const pal = argv.includes("--pal");
// The positional file is the first non-flag arg that isn't a flag's value.
const flagValueIndices = new Set(
	["--os", "--basic", "--keys"]
		.map((flag) => argv.indexOf(flag) + 1)
		.filter((i) => i > 0),
);
const filePath = argv.find(
	(arg, i) => !arg.startsWith("--") && !flagValueIndices.has(i),
);

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
	os: loadRom(osPath, "--os"),
	...(xl || !filePath ? { basic: loadRom(basicPath, "--basic") } : {}),
	...(cartridge ? { cartridge } : {}),
	...(pal ? { tvSystem: "pal" as const } : {}),
});

// --keys automation (e.g. Acid800): each time the program waits for a key — it
// clears CH ($02FC) then polls it — feed the next scripted POKEY key code, and
// once the script is exhausted exit the process. Codes are KBCODE values,
// comma-separated hex (e.g. `--keys 21,16` = Space then X). Wired as bus traps
// further down: a write of 0 to CH arms it, the next CH read returns the code.
const CH = 0x02fc;
const keyScript = (flagValue("--keys") ?? "")
	.split(",")
	.filter(Boolean)
	.map((code) => parseInt(code, 16));
let keyIndex = 0;
let keyWaitArmed = false;

const cpu = new Sfotty(machine, { withoutUndocumented: false });

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

// --- Execute traps: emulate OS-ROM entry points in the host. Each is a bus
// trap registered on the machine (machine.intercept*/observe*); an interceptor
// returns this substitute opcode to RTS straight back to the caller, skipping
// the real ROM routine. ---
const RTS = 0x60;

function hex(value: number, width: number): string {
	return value.toString(16).toUpperCase().padStart(width, "0");
}

// Thrown by the GETBYT trap when the stdin line buffer is empty: the run loop
// catches it (around cpu.run()), awaits the next line, and retries the cycle.
const NEED_INPUT = Symbol("need-input");

// E: PUTBYT — an execute observer: copy the ATASCII character in A to stdout,
// then return (void) so the real ROM routine still runs and the text also lands
// in screen RAM (and the framebuffer).
function editorPutByte(): void {
	const c = cpu.A & 0xff;
	fs.writeSync(1, Buffer.from([c === 0x9b ? 0x0a : c])); // EOL → newline
}

// E: GETBYT — an execute interceptor: put the next stdin byte in A (as ATASCII)
// and return RTS so the CPU returns to the caller. Throws to suspend when no
// input is buffered yet — the run loop awaits a line and retries the fetch.
function editorGetByte(): number {
	if (stdinOffset >= stdinBuffer.length) {
		if (stdinClosed) process.exit(0); // stdin ended → end the session
		throw NEED_INPUT;
	}
	const c = stdinBuffer[stdinOffset++]!;
	cpu.A = c === 0x0a ? 0x9b : c; // newline → ATASCII EOL
	cpu.Y = 0x01; // IOCB status: success
	cpu.nFlag = false;
	cpu.zFlag = false;
	return RTS;
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
	machine.interceptExecute(getByte, editorGetByte);
	machine.observeExecute(putByte, editorPutByte);
}

// CIOV: every CIO call passes through here; on the first, HATABS is set up, so
// install the E: byte traps. Observe-only — the real OS routine still runs.
machine.observeExecute(0xe456, installEditorTraps);

// SIOV: serve D1: from the attached image (trap-based SIO); everything else
// times out, so without a disk the OS abandons the disk boot. The handler does
// the host-side work and returns a substitute RTS opcode to return to the caller.
const sio = createSioHandler({
	machine,
	cpu,
	getDisk: (unit) => (unit === 1 ? disk : undefined),
});
machine.interceptExecute(SIOV, sio);

// BLKBDV, the Memo Pad ("blackboard") entry: the OS jumps here when there is
// nothing left to run — e.g. a booted executable returned. Session over.
machine.observeExecute(0xe471, () => process.exit(0));

// --keys: arm on a write of 0 to CH (the program clearing it before polling),
// then substitute the next scripted code on the following CH read.
if (keyScript.length) {
	machine.observeWrite(CH, (_address, value) => {
		if (value === 0) keyWaitArmed = true;
	});
	machine.interceptRead(CH, () => {
		if (!keyWaitArmed) return undefined;
		keyWaitArmed = false;
		if (keyIndex >= keyScript.length) process.exit(0);
		const code = keyScript[keyIndex++]!;
		process.stderr.write(`[keys] CH <- $${hex(code, 2)}\n`);
		return code;
	});
}

// Hard cap on emulated cycles. The program normally exits long before this
// (BLKBDV, stdin close, or the --keys script running out); reaching it means
// something is stuck — re-run with --trace to see where.
const LIMIT = 1_000_000_000;
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

async function run(): Promise<void> {
	const ag = machine.anticGtia;

	while (cycles < LIMIT) {
		ag.beforeCpu();
		machine.cycle();
		cpu.NMI = ag.nmi;
		cpu.IRQ = machine.irq;
		cpu.RDY = ag.rdy;

		// --trace: print each committed instruction (not halted cycles, where the
		// CPU is frozen, or WSYNC-stalled re-fetches where RDY is low).
		if (trace && !ag.halt && cpu.RDY && cpu.state === DECODE) {
			process.stderr.write(traceLine(cpu, peek) + "\n");
		}

		// Traps live on the bus now (machine.intercept*/observe*) and fire during
		// the opcode fetch inside cpu.run() — interrupt-safe by construction, so
		// the old host-side NMI latch is gone. The E: GETBYT interceptor throws
		// NEED_INPUT to suspend when stdin is empty; catch it, pair afterCpu for
		// this cycle, await the next line, and retry the same (un-advanced) cycle.
		if (!ag.halt) {
			try {
				cpu.run();
			} catch (error) {
				if (error !== NEED_INPUT) throw error;
				ag.afterCpu(frame, machine.busData);
				cycles++;
				await new Promise<void>((resolve) => {
					onStdin = resolve;
				});
				continue;
			}
		}

		ag.afterCpu(frame, machine.busData);
		cycles++;

		if (cpu.crashed) {
			process.stderr.write(`\nCRASHED: ${cpu.describeState()}\n`);
			dumpRegisters();
			break;
		}
	}

	if (cycles >= LIMIT) {
		process.stderr.write(
			`\nReached LIMIT (${cycles} cycles) — likely stuck; re-run with --trace.\n`,
		);
		dumpRegisters();
	}
	rl.close();
}

await run();
