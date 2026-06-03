import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import prettier from "prettier";
import { NMOS_INSTRUCTIONS } from "./nmos.ts";

// Maps each microcode token to the Sfotty op-method that implements it. This
// grows as op methods are added; an instruction is emitted only once every
// token it uses appears here — otherwise its states stay the badState filler.
const TOKEN_METHOD: Record<string, string> = {
	// Bus ops
	"r-pc++": "opReadOperand",
	"r-pc": "opReadPc",
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

function cap(s: string): string {
	return s[0]!.toUpperCase() + s.slice(1);
}

function isKnown(token: string): boolean {
	return (
		token in TOKEN_METHOD ||
		token in COND ||
		token === "?" ||
		token === "pc+=dr?" ||
		token === "cc--"
	);
}

/** Emit the body of one cycle's step function (its statements, unindented). */
function emitBody(
	cycle: string[],
	opcode: number,
	ci: number,
	last: number,
): string {
	const hex = `0x${opcode.toString(16).padStart(2, "0")}`;
	let next = ci === last ? "DECODE" : `(${hex} << 3) | ${ci + 1}`;
	const lines: string[] = [];
	for (let k = 0; k < cycle.length; k++) {
		const token = cycle[k]!;
		if (k === 0) {
			lines.push(`cpu.${TOKEN_METHOD[token]!}();`); // bus op
		} else if (token === "cc--") {
			// Jam: flag the crash and repeat this cycle forever.
			lines.push("cpu.opJam();");
			next = `(${hex} << 3) | ${ci}`;
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
				ci + 2 <= last ? `(${hex} << 3) | ${ci + 2}` : "DECODE";
			lines.push(
				`if (cpu.crossed) { cpu.${crossOp}(); cpu.state = (${hex} << 3) | ${ci + 1}; }` +
					` else { cpu.${valueOp}(); cpu.state = ${nextNoCross}; }`,
				"return;",
			);
			return lines.join("\n"); // `?` consumes the rest of the cycle
		} else {
			lines.push(`cpu.${TOKEN_METHOD[token]!}();`);
		}
	}
	lines.push(`cpu.state = ${next};`);
	return lines.join("\n");
}

const funcs: string[] = [];
const assigns: string[] = ["MICROCODE[DECODE] = decode;"];
const generated: number[] = [];

for (const inst of NMOS_INSTRUCTIONS) {
	if (!inst.code.every((cycle) => cycle.every(isKnown))) continue;
	generated.push(inst.opcode);

	const hex = `0x${inst.opcode.toString(16).padStart(2, "0")}`;
	const upperHex = inst.opcode.toString(16).toUpperCase().padStart(2, "0");

	inst.code.forEach((cycle, i) => {
		const name = `${inst.mnemonic.toLowerCase()}${cap(inst.mode)}${upperHex}C${i}`;
		const body = emitBody(cycle, inst.opcode, i, inst.code.length - 1);
		funcs.push(`function ${name}(cpu: Sfotty): void {\n${body}\n}`);
		assigns.push(`MICROCODE[(${hex} << 3) | ${i}] = ${name};`);
	});
}

const source = `// Generated by generate-step.ts — do not edit by hand.
// Regenerate with \`pnpm --filter @sfotty-pie/sfotty generate:step\`.

import { DECODE, type Step } from "./microcode.ts";
import type { Sfotty } from "./sfotty.ts";

/** Filler for unimplemented or invalid microstates: keeps MICROCODE dense. */
function badState(cpu: Sfotty): void {
	throw new Error(\`Unimplemented microstate: \${cpu.describeState()}\`);
}

/** The shared opcode-decode cycle. */
function decode(cpu: Sfotty): void {
	cpu.decode();
}

${funcs.join("\n\n")}

/**
 * The microcode dispatch table, indexed by microstate. Pre-filled densely with
 * badState so V8 keeps it a fast packed array (no holes → no dictionary mode)
 * and any jump to an unwired state throws instead of calling undefined.
 */
export const MICROCODE: Step[] = new Array<Step>(DECODE + 1).fill(badState);
${assigns.join("\n")}

/** Opcodes whose microcode is fully generated — scopes the Harte test runner. */
export const GENERATED_OPCODES: number[] = [${generated
	.map((o) => `0x${o.toString(16).padStart(2, "0")}`)
	.join(", ")}];
`;

const outPath = fileURLToPath(new URL("./nmos-step.ts", import.meta.url));
const config = await prettier.resolveConfig(outPath);
const formatted = await prettier.format(source, {
	...config,
	parser: "typescript",
});
writeFileSync(outPath, formatted);

// eslint-disable-next-line no-console
console.log(`Wrote ${assigns.length} microcode entries to ${outPath}`);
