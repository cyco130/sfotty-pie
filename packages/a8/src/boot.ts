import { ReadOptions, traceLine } from "@sfotty-pie/sfotty";
import fs from "node:fs";
import readline from "node:readline";
import { basename } from "node:path";
import { AtrImage } from "./atr.ts";
import { Cartridge } from "./cartridge.ts";
import { detectFileFormat } from "./detect-file-format.ts";
import { Headless, type InputSource } from "./headless.ts";
import { Atari } from "./machine.ts";
import { buildBootDisk } from "./xex-boot.ts";

// Usage: boot.ts --os <file> [--basic <file>] [--xl | --xe] [--pal] [--trace] [--dump-frame] [file]
// `--os`/`--basic` are paths to the OS and BASIC ROM images. `file` is an XEX,
// ATR, or cartridge image; like the web emulator's Load, booting a file is
// boot-image semantics — the 800's BASIC cart comes out. This is a thin CLI over
// the headless host (machine + OS-ROM HLE traps + run loop); console I/O is wired
// to stdin/stdout here, and the run loop lives in Headless.
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
const trace = argv.includes("--trace");
// The positional file is the first non-flag arg that isn't a flag's value.
const flagValueIndices = new Set(
	["--os", "--basic"]
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

if (disk) machine.insertDisk(disk);

const peek = (address: number) => machine.read(address, ReadOptions.PEEK);

function hex(value: number, width: number): string {
	return value.toString(16).toUpperCase().padStart(width, "0");
}

// --- Console input via readline (line-buffered stdin) — good enough for BASIC.
// Exposed to the host as an InputSource: read() pops the next buffered byte;
// wait() resolves when a line arrives, or false when stdin closes. ---
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});
let stdinBuffer = Buffer.alloc(0);
let stdinOffset = 0;
let stdinClosed = false;
let onStdin: ((more: boolean) => void) | null = null;
rl.on("line", (line) => {
	stdinBuffer = Buffer.concat([
		stdinBuffer.subarray(stdinOffset),
		Buffer.from(line + "\n"),
	]);
	stdinOffset = 0;
	onStdin?.(true);
	onStdin = null;
});
rl.on("close", () => {
	stdinClosed = true;
	onStdin?.(false);
	onStdin = null;
});

const input: InputSource = {
	read() {
		return stdinOffset < stdinBuffer.length
			? stdinBuffer[stdinOffset++]!
			: undefined;
	},
	wait() {
		if (stdinOffset < stdinBuffer.length) return Promise.resolve(true);
		if (stdinClosed) return Promise.resolve(false);
		return new Promise<boolean>((resolve) => {
			onStdin = resolve;
		});
	},
};

if (argv.includes("--dump-frame")) {
	// Render the last frame as ASCII art on exit. Hooked on the exit event so it
	// runs whichever way the process ends.
	process.on("exit", dumpFrame);
}

function dumpFrame(): void {
	const frame = machine.frame;
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
	const cpu = machine.cpu;
	process.stderr.write(
		`  PC=${hex(cpu.PC, 4)} A=${hex(cpu.A, 2)} X=${hex(cpu.X, 2)} ` +
			`Y=${hex(cpu.Y, 2)} S=${hex(cpu.S, 2)} P=${hex(cpu.getP(), 2)}\n`,
	);
}

const headless = new Headless({
	machine,
	output: (byte) => {
		fs.writeSync(1, Buffer.from([byte]));
	},
	input,
	...(trace
		? {
				onInstruction: (pc: number) =>
					process.stderr.write(traceLine(machine.cpu, peek, pc) + "\n"),
			}
		: {}),
});

const result = await headless.run();

if (machine.cpu.crashed) {
	process.stderr.write(`\nCRASHED: ${machine.cpu.describeState()}\n`);
	dumpRegisters();
} else if (result.reachedLimit) {
	process.stderr.write(
		`\nReached LIMIT (${result.cycles} cycles) — likely stuck; re-run with --trace.\n`,
	);
	dumpRegisters();
}

rl.close();
process.exit(0);
