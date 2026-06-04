#!/usr/bin/env node
import { Sfotty } from "@sfotty-pie/sfotty";
import fs from "node:fs";
import readline from "node:readline";

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

	// Read the first 6 bytes of the file to determine the file type
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

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	// Standard input is consumed line by line as readline emits it. The CPU
	// pulls bytes out of this buffer; when it runs dry it throws BufferEmptyError
	// and we wait for the next line (or EOF) before retrying the cycle.
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

	const sfotty = new Sfotty({
		read(address, decode): number {
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
						return (Math.random() * 255) | 0;

					case 0x0241:
						return stdinClosed && stdinOffset >= stdinBuffer.length
							? 0x80
							: 0x00;

					default:
						console.error(`Unhandled read from ${address.toString(16)}`);
						process.exit(2);
				}
			} else {
				const value = ram[address]!;
				if (decode && value === 0) {
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
						process.exit(2);
				}
			} else {
				ram[address] = value;
			}
		},
	});

	let maxCycles = Infinity;

	const opts = args.slice(0, index);
	for (const opt of opts) {
		// if (opt === "--trace") {
		// 	sfotty.trace = true; // TODO: trace not implemented on the new core
		// } else
		if (opt.startsWith("--max-cycles=")) {
			maxCycles = parseInt(opt.slice("--max-cycles=".length));
		} else {
			console.error(`Unrecognized option ${opt}`);
			process.exit(3);
		}
	}

	// The new core doesn't run a reset sequence yet, so jump to the reset vector.
	sfotty.PC = ram[0xfffc]! | (ram[0xfffd]! << 8);

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

			// Not needed on the new core: a thrown bus access leaves CPU state
			// untouched, so the next run() retries the same cycle.
			// sfotty.cycleCounter--;
		}
	}

	if (sfotty.crashed) {
		console.error("Program crashed");
		// console.log(sfotty.print()); // TODO: print() not on the new core
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
		super("Buffer is empty");
		this.name = "BreakError";
		Object.setPrototypeOf(this, new.target.prototype);
	}
}
