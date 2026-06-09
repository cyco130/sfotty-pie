import { describe, test, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { assemble, type Host } from "@sfotty-pie/spasm";
import { Sfotty } from "@sfotty-pie/sfotty";

const samplesDir = resolve(import.meta.dirname, "samples");

const host: Host = {
	resolve: (specifier, fromId) => resolve(dirname(fromId), specifier),
	read: (id) => readFile(id, "utf8"),
};

interface RunOptions {
	args?: string[];
	stdin?: string;
	rand?: number;
}

/** Assemble a sample with spasm and run the image on the core, like the CLI. */
async function runSample(name: string, options: RunOptions = {}) {
	const result = await assemble(resolve(samplesDir, `${name}.s`), host);
	expect(result.diagnostics.map((d) => d.message)).toEqual([]);

	const ram = new Uint8Array(65536);
	ram.set(result.output.subarray(10, 16), 0xfffa); // vectors
	ram.set(result.output.subarray(16), 0x0400); // program
	const argBytes = new TextEncoder().encode(
		(options.args ?? []).join("\0") + "\0\0",
	);
	ram.set(argBytes.subarray(0, 254), 0x0300);

	const input = new TextEncoder().encode(options.stdin ?? "");
	let inPos = 0;
	let stdout = "";
	let exitCode: number | null = null;

	const sfotty = new Sfotty({
		read(address: number) {
			if (address === 0x0240) return options.rand ?? 0; // RAND
			if (address === 0x0201) return inPos < input.length ? input[inPos++]! : 0; // STDIN
			if (address === 0x0241) return inPos >= input.length ? 0x80 : 0x00; // FSTIN EOF
			return ram[address]!;
		},
		write(address: number, value: number) {
			if (address === 0x0200)
				exitCode = value; // EXIT
			else if (address === 0x0202)
				stdout += String.fromCharCode(value); // STDOUT
			else ram[address] = value;
		},
	});
	sfotty.PC = ram[0xfffc]! | (ram[0xfffd]! << 8);

	let cycles = 0;
	while (exitCode === null && !sfotty.crashed && cycles++ < 5_000_000) {
		sfotty.run();
	}
	return { stdout, exitCode, crashed: sfotty.crashed };
}

describe("sample programs (assembled with spasm, run on the core)", () => {
	test("hello prints a greeting", async () => {
		expect(await runSample("hello")).toMatchObject({
			stdout: "Hello world!\n",
			exitCode: 0,
			crashed: false,
		});
	});

	test("echo joins its arguments with spaces", async () => {
		const r = await runSample("echo", { args: ["one", "two", "three"] });
		expect(r.stdout).toBe("one two three \n");
		expect(r.exitCode).toBe(0);
	});

	test("cat echoes stdin to stdout", async () => {
		const r = await runSample("cat", { stdin: "line 1\nline 2\n" });
		expect(r.stdout).toBe("line 1\nline 2\n");
		expect(r.exitCode).toBe(0);
	});

	test("guess plays the number game", async () => {
		// RAND=$64 -> target 50; guess 25 (too low) then 50 (win).
		const r = await runSample("guess", { rand: 0x64, stdin: "25\n50\n" });
		expect(r.stdout).toContain("Too low");
		expect(r.stdout).toContain("You got it!");
		expect(r.exitCode).toBe(0);
	});
});
