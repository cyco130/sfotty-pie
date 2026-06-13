/* eslint-disable no-console -- this module's whole job is to print to the console */
import { disassemble, ReadOptions } from "@sfotty-pie/sfotty";
import { setCommandTrace } from "./commands.ts";
import type { EmulatorHost } from "./host.ts";
import { builtinLibrary } from "./library.ts";

function hex(value: number, width: number): string {
	return value.toString(16).padStart(width, "0");
}

/**
 * Install `window.a8`: a poor-man's monitor for the browser console — live
 * machine/cpu access, peek/poke, a disassembler, and the CPU/command traces.
 *
 *   a8.trace.cpu(true); …reproduce…; a8.trace.dump(300)
 *   a8.peek(0x0244)        a8.disasm(a8.cpu.PC)
 */
export function installDevConsole(host: EmulatorHost): void {
	const peek = (address: number) =>
		host.emulator.machine.read(address & 0xffff, ReadOptions.PEEK);

	const a8 = {
		get emulator() {
			return host.emulator;
		},
		get machine() {
			return host.emulator.machine;
		},
		get cpu() {
			return host.emulator.cpu;
		},
		peek,
		poke: (address: number, value: number) =>
			host.emulator.machine.write(address & 0xffff, value & 0xff),
		disasm: (address: number, count = 16) => {
			let pc = address & 0xffff;
			const lines: string[] = [];
			for (let i = 0; i < count; i++) {
				const { text, length } = disassemble(peek, pc);
				lines.push(`${hex(pc, 4)}  ${text}`);
				pc = (pc + length) & 0xffff;
			}
			console.log(lines.join("\n"));
		},
		// The built-in image library (merged committed + local folders).
		get library() {
			return builtinLibrary;
		},
		trace: {
			cpu: (enabled: boolean) => host.setCpuTrace(enabled),
			commands: (enabled: boolean) => setCommandTrace(enabled),
			clear: () => host.clearCpuTrace(),
			// No count → the whole capture (after a reset, the captured boot).
			dump: (count?: number) =>
				console.log(host.dumpCpuTrace(count).join("\n")),
		},
	};

	Object.assign(window, { a8 });
	console.log("Dev console ready: window.a8 (try a8.trace.cpu(true))");
}
