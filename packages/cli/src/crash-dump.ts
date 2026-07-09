import {
	disassemble,
	traceLine,
	type PeekReader,
	type Sfotty,
} from "@sfotty-pie/sfotty";

function hex(value: number, width: number): string {
	return value.toString(16).toUpperCase().padStart(width, "0");
}

/**
 * Render a post-mortem dump of the CPU: the microstate it died in and a
 * disassembly of the last committed instructions, oldest first. The final
 * entry is the instruction the CPU died on; it alone is annotated with the
 * registers, which hold the state at death, not at that instruction's fetch.
 * `peek` must be side-effect-free; the disassembly reflects current memory,
 * so self-modified code may read differently than when it ran.
 */
export function crashDump(
	cpu: Sfotty,
	peek: PeekReader,
	recentPCs: number[],
): string {
	const lines = [`CPU state: ${cpu.describeState()}`];
	if (recentPCs.length > 0) {
		lines.push("Last instructions:");
		for (const [i, pc] of recentPCs.entries()) {
			if (i === recentPCs.length - 1) {
				lines.push(`  ${traceLine(cpu, peek, pc)}`);
			} else {
				const { text, bytes } = disassemble(peek, pc);
				const byteText = bytes
					.map((b) => hex(b, 2))
					.join(" ")
					.padEnd(8);
				lines.push(`  ${hex(pc, 4)}  ${byteText} ${text}`);
			}
		}
	}
	return lines.join("\n");
}
