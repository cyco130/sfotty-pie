import { writeFileSync } from "node:fs";
import { join } from "node:path";
import prettier from "prettier";
import { NMOS_INSTRUCTIONS } from "./nmos-instructions.generated.ts";

// Maps each microcode token to the SfottyCore op-method that implements it. This
// grows as op methods are added; an instruction is emitted only once every
// token it uses appears here — otherwise its states stay the badState filler.
const TOKEN_METHOD: Record<string, string> = {
	// Bus ops
	"r-pc++": "opReadOperand",
	"r-pc": "opReadPc",
	"r-brk": "opReadBreakByte",
	"r-ar": "opReadAddr",
	"r-ar++": "opReadAddrInc",
	"r-dr++": "opReadPointerInc",
	"r-dr": "opReadPointer",
	"w-ar": "opWriteAddr",
	"w-ar--": "opWriteAddrDec",

	// Address latch
	"ar=dr": "opAddrFromDr",
	"ah=dr": "opAddrHighFromDr",
	"ar+=x": "opAddX",
	"ar+=y": "opAddY",
	"ar+=x?": "opAddXCarry",
	"ar+=y?": "opAddYCarry",
	"ah++": "opIncAddrHigh",
	"?ah++": "opFixAddrHigh",
	"ar=sp": "opAddrFromSp",
	"ar=vector": "opAddrVector",
	"nmi-hold": "opNmiHold",
	"ar=ffff": "opAddrFFFF",
	"ar=fffe": "opAddrFFFE",
	"dr=al": "opDrFromAl",

	// Loads / stores
	"a=dr": "opLoadA",
	"x=dr": "opLoadX",
	"y=dr": "opLoadY",
	"dr=a": "opDrFromA",
	"dr=x": "opDrFromX",
	"dr=y": "opDrFromY",
	sta: "opDrFromA",
	stx: "opDrFromX",
	sty: "opDrFromY",
	sax: "opSax",
	sha: "opSha",
	shx: "opShx",
	shy: "opShy",
	shs: "opShs",

	// ALU read ops
	"ro-ora": "opOra",
	"ro-and": "opAnd",
	"ro-eor": "opEor",
	"ro-bit": "opBit",
	"ro-adc": "opAdc",
	"ro-sbc": "opSbc",
	"ro-cmp": "opCmp",
	"ro-cpx": "opCpx",
	"ro-cpy": "opCpy",
	"ro-lax": "opLax",
	"ro-anc": "opAnc",
	"ro-asr": "opAsr",
	"ro-arr": "opArr",
	"ro-sbx": "opSbx",
	"ro-ane": "opAne",
	"ro-lxa": "opLxa",
	"ro-las": "opLas",

	// Accumulator shifts/rotates
	asla: "opAslA",
	lsra: "opLsrA",
	rola: "opRolA",
	rora: "opRorA",

	// Read-modify-write
	"mo-asl": "opAsl",
	"mo-lsr": "opLsr",
	"mo-rol": "opRol",
	"mo-ror": "opRor",
	"mo-inc": "opInc",
	"mo-dec": "opDec",
	"mo-slo": "opSlo",
	"mo-rla": "opRla",
	"mo-sre": "opSre",
	"mo-rra": "opRra",
	"mo-dcp": "opDcp",
	"mo-isb": "opIsb",

	// Transfers and inc/dec
	"x=a": "opXFromA",
	"y=a": "opYFromA",
	"a=x": "opAFromX",
	"a=y": "opAFromY",
	"x=s": "opXFromS",
	"s=x": "opSFromX",
	"x++": "opIncX",
	"x--": "opDecX",
	"y++": "opIncY",
	"y--": "opDecY",

	// Flags
	"cf=0": "opClearCarry",
	"cf=1": "opSetCarry",
	"if=0": "opClearInterrupt",
	"if=1": "opSetInterrupt",
	"of=0": "opClearOverflow",
	"df=0": "opClearDecimal",
	"df=1": "opSetDecimal",

	// Stack / PC plumbing
	"dr=p": "opDrFromP",
	"dr=pi": "opDrFromP",
	"dr=pch": "opDrFromPch",
	"dr=pcl": "opDrFromPcl",
	"pcl=dr": "opPclFromDr",
	"pch=dr": "opPchFromDr",
	"pcl=al": "opPclFromAl",
	"pcl=s": "opPclFromS",
	"pch=fix": "opFixPch",
	"s=dr": "opSFromDr",
	"s=al": "opSFromAl",
	"p=dr": "opPFromDr",

	nop: "opNop",

	// Synthetic token (not in the instruction data): the interrupt poll,
	// injected below onto every cycle that can end an instruction.
	poll: "opPoll",
};

// Branch-condition tokens return whether the branch is taken.
const COND: Record<string, string> = {
	"cc?": "opCondCc",
	"cs?": "opCondCs",
	"ne?": "opCondNe",
	"eq?": "opCondEq",
	"pl?": "opCondPl",
	"mi?": "opCondMi",
	"vc?": "opCondVc",
	"vs?": "opCondVs",
};

function isKnown(token: string): boolean {
	return (
		token in TOKEN_METHOD ||
		token in COND ||
		token === "?" ||
		token === "pc+=dr?" ||
		token === "cc--"
	);
}

/**
 * Emit the body of one cycle's step function (its statements, unindented).
 *
 * Transitions are kept relative to the current microstate, never baking in the
 * opcode: a microstate is `(opcode << 3) | cycle` and `cycle` never reaches 8,
 * so advancing one cycle is `cpu.state++` and the page-cross skip is
 * `cpu.state += 2`. That makes every step opcode-independent, so steps that
 * share a microcode shape collapse onto one function.
 */
function emitBody(cycle: string[], ci: number, last: number): string {
	let next = ci === last ? "cpu.state = DECODE;" : "cpu.state++;";
	const lines: string[] = [];
	for (let k = 0; k < cycle.length; k++) {
		const token = cycle[k]!;
		if (k === 0) {
			// The bus op. A read returns false when RDY is low: the read was issued
			// but the cycle stalled, so bail without advancing `state`. Writes ignore
			// RDY and return void.
			const method = TOKEN_METHOD[token]!;
			lines.push(
				token.startsWith("r-")
					? `if (!cpu.${method}()) return;`
					: `cpu.${method}();`,
			);
		} else if (token === "cc--") {
			// Crash: flag it and repeat this cycle forever (state untouched).
			lines.push("cpu.opCrash();");
			next = "";
		} else if (token in COND) {
			// Branch not taken: skip the rest of the instruction.
			lines.push(`if (!cpu.${COND[token]!}()) { cpu.state = DECODE; return; }`);
		} else if (token === "pc+=dr?") {
			// No page cross: skip the fix-up cycle.
			lines.push(`if (!cpu.opBranchOffset()) { cpu.state = DECODE; return; }`);
		} else if (token === "?") {
			// Indexed read: page cross takes the re-read cycle; otherwise the
			// speculative read was valid, so finish and skip the next cycle.
			const crossOp = TOKEN_METHOD[cycle[k + 1]!]!;
			const valueOp = TOKEN_METHOD[cycle[k + 2]!]!;
			const nextNoCross =
				ci + 2 <= last ? "cpu.state += 2;" : "cpu.state = DECODE;";
			lines.push(
				`if (cpu.crossed) { cpu.${crossOp}(); cpu.state++; }` +
					` else { cpu.${valueOp}(); ${nextNoCross} }`,
				"return;",
			);
			return lines.join("\n"); // `?` consumes the rest of the cycle
		} else {
			lines.push(`cpu.${TOKEN_METHOD[token]!}();`);
		}
	}
	if (next) lines.push(next);
	return lines.join("\n");
}

interface StepDef {
	mnemonic: string;
	mode: string;
	cycle: number;
	opcode: number;
	body: string;
}

// Every (opcode, cycle) step, plus a grouping by base name. The base name drops
// the opcode (`mnemonic_mode_cycle`), so opcodes sharing a mnemonic and mode
// collapse onto it. The cycle in the name is the instruction-relative cycle
// number: `decode` (the opcode fetch) is cycle 0, so `code[i]` is cycle `i + 1`.
const steps: StepDef[] = [];
const byBaseName = new Map<string, StepDef[]>();

// Microstates whose bus access is a non-committing dummy (tagged with the
// "dummy" marker in the instruction data). Emitted as the DUMMY table so #read
// can set ReadOptions.DUMMY by state. (Implied/accumulator reads for now; stack,
// RMW, indexed and reset dummies are tagged in later steps.)
const dummyStates: number[] = [];

const baseName = (s: StepDef) => `${s.mnemonic}_${s.mode}_${s.cycle + 1}`;

for (const inst of NMOS_INSTRUCTIONS) {
	const last = inst.code.length - 1;
	const isBrk = inst.mnemonic.toUpperCase() === "BRK";
	inst.code.forEach((rawCycle, i) => {
		// Strip the "dummy" marker (not a real op): record the microstate so its
		// bus access gets ReadOptions.DUMMY, then proceed as if it weren't there.
		const cycle = rawCycle.includes("dummy")
			? rawCycle.filter((token) => token !== "dummy")
			: rawCycle;
		if (cycle !== rawCycle) dummyStates.push((inst.opcode << 3) | i);

		const unknown = cycle.find((token) => !isKnown(token));
		if (unknown !== undefined) {
			throw new Error(
				`opcode 0x${inst.opcode.toString(16).padStart(2, "0")} cycle ${i}: ` +
					`unknown microcode token "${unknown}"`,
			);
		}
		// Poll for interrupts on every cycle that can end an instruction — a plain
		// terminal cycle, a branch's condition cycle (ends when not taken), or an
		// indexed read's `?` cycle (ends when no page cross). Excludes BRK and the
		// interrupt sequence (never poll), CIM's `cc--` (never reaches a boundary),
		// and a taken branch's `pc+=dr?` PCL-add cycle. The `poll` goes right after
		// the bus op so it runs before any I-flag change (the SEI/CLI/PLP delay).
		const pollable =
			!isBrk &&
			!cycle.includes("pc+=dr?") &&
			!cycle.includes("cc--") &&
			(i === last || cycle.includes("?") || cycle.some((t) => t in COND));
		const tokens = pollable ? [cycle[0]!, "poll", ...cycle.slice(1)] : cycle;
		const step: StepDef = {
			mnemonic: inst.mnemonic.toLowerCase(),
			mode: inst.mode,
			cycle: i,
			opcode: inst.opcode,
			body: emitBody(tokens, i, last),
		};
		steps.push(step);
		const key = baseName(step);
		let group = byBaseName.get(key);
		if (!group) byBaseName.set(key, (group = []));
		group.push(step);
	});
}

// Reset's first five cycles are dummy reads (states 0x801..0x805: two reads at
// PC, then three fake-push stack reads); the last two (0x806/0x807) read the
// real reset vector. The sequence is hand-written below, not token-generated.
dummyStates.push(0x801, 0x802, 0x803, 0x804, 0x805);

// A base name is ambiguous when its steps don't all share one body — i.e. the
// body bakes in the opcode (via its next-state transition), so the colliding
// opcodes need distinct functions. Those re-add the opcode: `cim02_imp_0`.
// Unambiguous names cover both unique steps and opcode-independent ones (e.g.
// terminal cycles ending at DECODE), which dedupe onto a single function.
const ambiguous = new Set<string>();
for (const [key, group] of byBaseName) {
	if (new Set(group.map((s) => s.body)).size > 1) ambiguous.add(key);
}

const stepName = (s: StepDef) => {
	const key = baseName(s);
	if (!ambiguous.has(key)) return key;
	const hex = s.opcode.toString(16).padStart(2, "0");
	return `${s.mnemonic}${hex}_${s.mode}_${s.cycle + 1}`;
};

const funcs: string[] = [];
const emitted = new Set<string>();
const nameAt = new Map<number, string>();

for (const step of steps) {
	const name = stepName(step);
	if (!emitted.has(name)) {
		funcs.push(`function ${name}(cpu: SfottyCore): void {\n${step.body}\n}`);
		emitted.add(name);
	}
	nameAt.set((step.opcode << 3) | step.cycle, name);
}

// The dispatch table laid out positionally: index `(opcode << 3) | cycle`, so
// each opcode owns a block of 8 slots. Cycles past the instruction's length are
// filler (badState). DECODE (0x800) is the final slot, right after opcode 0xff.
const byOpcode = new Map(NMOS_INSTRUCTIONS.map((inst) => [inst.opcode, inst]));
const table: string[] = [];
for (let opcode = 0; opcode < 256; opcode++) {
	const inst = byOpcode.get(opcode)!;
	const hex = opcode.toString(16).padStart(2, "0");
	table.push(`// ${hex} ${inst.mnemonic.toUpperCase()} ${inst.mode}`);
	for (let cycle = 0; cycle < 8; cycle++) {
		table.push(`${nameAt.get((opcode << 3) | cycle) ?? "badState"},`);
	}
}
table.push("// 800 decode");
table.push("decode,");
table.push("// 801 reset (seven cycles, 801..807)");
table.push("reset_read,"); // 801: dummy read
table.push("reset_read,"); // 802: dummy read
table.push("reset_push,"); // 803: fake push (read), S--
table.push("reset_push,"); // 804: fake push (read), S--
table.push("reset_push,"); // 805: fake push (read), S--
table.push("reset_vector_low,"); // 806: read $FFFC into PCL, set I
table.push("reset_vector_high,"); // 807: read $FFFD into PCH, then decode

const source = `// Generated by generate-steps.ts — do not edit by hand.
// Regenerate with \`pnpm --filter @sfotty-pie/sfotty generate:steps\`.

import { DECODE, type Step } from "./microcode.ts";
import type { SfottyCore } from "./sfotty-core.ts";

/** Filler for unimplemented or invalid microstates: keeps MICROCODE dense. */
function badState(cpu: SfottyCore): void {
	throw new Error(\`Unimplemented microstate: \${cpu.describeState()}\`);
}

/** The shared opcode-decode cycle. */
function decode(cpu: SfottyCore): void {
	cpu.opReadDecode();
}

// The reset sequence (states RESET..RESET+6), launched by SfottyCore.reset(). It is
// hand-written rather than token-generated: reset isn't an opcode, and its stack
// accesses are reads (writes suppressed) vectoring from $FFFC.

/** Reset cycles 1–2: dummy reads at PC. */
function reset_read(cpu: SfottyCore): void {
	if (!cpu.opReadPc()) return;
	cpu.state++;
}

/** Reset cycles 3–5: dummy stack reads, decrementing S each time. */
function reset_push(cpu: SfottyCore): void {
	cpu.opAddrFromSp();
	if (!cpu.opReadAddr()) return;
	cpu.opDecS();
	cpu.state++;
}

/** Reset cycle 6: read the reset vector low byte into PCL and set I. */
function reset_vector_low(cpu: SfottyCore): void {
	cpu.opAddrFFFC();
	if (!cpu.opReadAddrInc()) return;
	cpu.opPclFromDr();
	cpu.opSetInterrupt();
	cpu.state++;
}

/** Reset cycle 7: read the reset vector high byte into PCH, then decode. */
function reset_vector_high(cpu: SfottyCore): void {
	if (!cpu.opReadAddr()) return;
	cpu.opPchFromDr();
	cpu.state = DECODE;
}

${funcs.join("\n\n")}

/**
 * The microcode dispatch table, indexed by microstate ((opcode << 3) | cycle).
 * Every slot is filled — cycles past an instruction's length get badState — so
 * the array stays densely packed (no holes → V8 keeps it a fast packed array)
 * and any jump to an unwired state throws instead of calling undefined.
 */
export const MICROCODE: Step[] = [
${table.join("\n")}
];

/**
 * Per-microstate flag: 1 if that cycle's bus access is a non-committing dummy
 * (e.g. the implied/accumulator "internal operation" read). The CPU ORs
 * ReadOptions.DUMMY into the access when set, so traps can tell real accesses
 * from speculative/discarded ones. Indexed by microstate, like MICROCODE.
 */
export const DUMMY: Uint8Array = /* @__PURE__ */ (() => {
	const table = new Uint8Array(MICROCODE.length);
	for (const state of [${dummyStates.sort((a, b) => a - b).join(", ")}]) {
		table[state] = 1;
	}
	return table;
})();
`;

const outPath = join(import.meta.dirname, "nmos-steps.generated.ts");
const config = await prettier.resolveConfig(outPath);
const formatted = await prettier.format(source, {
	...config,
	parser: "typescript",
});
writeFileSync(outPath, formatted);

// eslint-disable-next-line no-console
console.log(`Wrote ${funcs.length} step functions to ${outPath}`);
