#!/usr/bin/env node
import {
	ReadOptions,
	Sfotty,
	traceLine,
	type Memory,
} from "@sfotty-pie/sfotty";
import fs from "node:fs";
import readline from "node:readline";
import { crashDump } from "./crash-dump.ts";

async function main() {
	const args = process.argv.slice(2);
	let index = args.findIndex((arg) => arg === "--" || !arg.startsWith("-"));
	if (args[index] === "--") {
		index++;
	}

	const filename = args[index];
	if (!filename) {
		console.error("No filename specified");
		process.exit(1);
	}

	// Read the file; its 6-byte magic determines whether it's a valid image.
	const buffer = await fs.promises.readFile(filename);

	const expected = Buffer.from("SFOTTY");
	if (!buffer.subarray(0, expected.length).equals(expected)) {
		console.error("File is not a Sfotty Pie executable");
		process.exit(1);
	}

	const ram = new Uint8Array(65536).fill(0);

	// Copy the vectors
	const vectors = buffer.subarray(10, 16);
	ram.set(vectors, 0xfffa);

	// Copy the program
	const program = buffer.subarray(16);
	ram.set(program, 0x0400);

	// Copy the command line args
	const userArgs =
		args
			.slice(index + 1)
			.join("\0")
			.slice(0, 254) + "\0\0";
	ram.set(Buffer.from(userArgs), 0x0300);

	// The CPU pulls bytes out of this buffer; when it runs dry it throws
	// BufferEmptyError and we wait for more input (or EOF) before retrying the
	// cycle.
	let stdinBuffer = Buffer.alloc(0);
	let stdinOffset = 0;
	let stdinClosed = false;
	let onStdin: (() => void) | null = null;

	function pushStdin(chunk: Buffer) {
		stdinBuffer = Buffer.concat([stdinBuffer.subarray(stdinOffset), chunk]);
		stdinOffset = 0;
		onStdin?.();
		onStdin = null;
	}

	function endStdin() {
		stdinClosed = true;
		onStdin?.();
		onStdin = null;
	}

	if (process.stdin.isTTY) {
		// Interactive: readline provides echo and line editing; input reaches
		// the guest a line at a time.
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		rl.on("line", (line) => pushStdin(Buffer.from(line + "\n")));
		rl.on("close", endStdin);
	} else {
		// Redirected: consume the stream byte-for-byte. No line mangling (CR
		// preservation, no invented trailing newline) and no readline, which
		// would echo piped input into a TTY stdout.
		process.stdin.on("data", pushStdin);
		process.stdin.on("end", endStdin);
	}

	const bus: Memory = {
		read(address, options): number {
			// A PEEK read (disassembler, debugger, crash dump) is side-effect-free:
			// it sees plain RAM everywhere, including under the I/O page, and never
			// triggers a break.
			if (options & ReadOptions.PEEK) {
				return ram[address]!;
			}

			if (address >= 0x0200 && address < 0x0300) {
				switch (address) {
					case 0x0201:
						if (stdinOffset < stdinBuffer.length) {
							return stdinBuffer[stdinOffset++]!;
						} else if (stdinClosed) {
							return 0;
						} else {
							throw new BufferEmptyError();
						}

					case 0x0240:
						return (Math.random() * 256) | 0;

					case 0x0241:
						// Block while the status is undecided (buffer empty but the
						// stream not yet ended); otherwise a check-FSTIN-then-read-STDIN
						// sequence could see "not EOF" and still read the EOF zero.
						if (stdinOffset >= stdinBuffer.length && !stdinClosed) {
							throw new BufferEmptyError();
						}
						return stdinOffset < stdinBuffer.length ? 0x00 : 0x80;

					default:
						console.error(`Unhandled read from ${address.toString(16)}`);
						dump();
						process.exit(2);
				}
			} else {
				const value = ram[address]!;
				// Break on a committed fetch (SYNC and not DUMMY) of a zero opcode.
				// Dummy reads (reset's fake stack reads, CIM's jam reads) also see
				// zero bytes and must pass through untouched.
				if (
					value === 0 &&
					options & ReadOptions.SYNC &&
					!(options & ReadOptions.DUMMY)
				) {
					throw new BreakError();
				}
				return value;
			}
		},
		write(address, value) {
			if (address >= 0x0200 && address < 0x0300) {
				switch (address) {
					case 0x0200:
						process.exit(value);
						break;

					case 0x0202:
						// Synchronous so output flushes before an EXIT process.exit().
						fs.writeSync(1, Buffer.from([value]));
						break;

					case 0x0203:
						process.stderr.write(Buffer.from([value]));
						break;

					default:
						console.error(`Unhandled write to address ${address.toString(16)}`);
						dump();
						process.exit(2);
				}
			} else {
				ram[address] = value;
			}
		},
	};

	const sfotty = new Sfotty(bus);

	let maxCycles = Infinity;
	let trace = false;

	const opts = args.slice(0, index);
	for (const opt of opts) {
		if (opt === "--trace") {
			trace = true;
		} else if (opt.startsWith("--max-cycles=")) {
			maxCycles = parseInt(opt.slice("--max-cycles=".length));
		} else {
			console.error(`Unrecognized option ${opt}`);
			process.exit(3);
		}
	}

	// Side-effect-free reader for the disassembler and the crash dump.
	const peek = (address: number) =>
		bus.read(address & 0xffff, ReadOptions.PEEK);

	// onFetch fires once per committed instruction: record the address in a
	// ring buffer for the crash dump (`head` points at the oldest entry once
	// the buffer is full) and emit the trace line when tracing.
	const RECENT_INSTRUCTIONS = 16;
	const recentPCs: number[] = [];
	let recentHead = 0;
	sfotty.onFetch = (pc) => {
		recentPCs[recentHead] = pc;
		recentHead = (recentHead + 1) % RECENT_INSTRUCTIONS;
		if (trace) {
			process.stderr.write(traceLine(sfotty, peek, pc) + "\n");
		}
	};

	// Post-mortem dump to stderr, shared by the CIM-crash path and the
	// unhandled-I/O exits in the bus handlers above.
	function dump() {
		console.error(
			crashDump(sfotty, peek, [
				...recentPCs.slice(recentHead),
				...recentPCs.slice(0, recentHead),
			]),
		);
	}

	// Construction arms the cold-reset sequence; the first seven cycles run it
	// and load PC from the reset vector already copied into RAM.
	while (!sfotty.crashed && maxCycles--) {
		try {
			sfotty.run();
		} catch (error) {
			if (error instanceof BreakError) {
				sfotty.PC = (sfotty.PC + 1) & 0xffff;
			} else if (error instanceof BufferEmptyError) {
				// Wait for the next line of input (or EOF), then retry the cycle.
				await new Promise<void>((resolve) => {
					onStdin = resolve;
				});
			} else {
				throw error;
			}
		}
	}

	if (sfotty.crashed) {
		console.error("Program crashed");
		dump();
		process.exit(2);
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(3);
});

class BufferEmptyError extends Error {
	constructor() {
		super("Buffer is empty");
		this.name = "BufferEmptyError";
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

class BreakError extends Error {
	constructor() {
		super("BRK encountered");
		this.name = "BreakError";
		Object.setPrototypeOf(this, new.target.prototype);
	}
}
