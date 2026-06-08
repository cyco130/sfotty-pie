// Dev-only generator: emits `src/opcodes.ts` from sfotty's NMOS_OPCODES.
// Run with `pnpm generate:opcodes`.
//
// It imports the sibling package's *source* directly (a relative path, not the
// built `@sfotty-pie/sfotty`). That's fine here because this is dev tooling that
// never ships: the generated `opcodes.ts` is plain data with no dependency, so
// the published package stays decoupled. The opcode table is a frozen historical
// fact, so this is essentially run-once.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import prettier from "prettier";
import { NMOS_OPCODES } from "../../sfotty/src/nmos-opcodes.ts";

// Emission order for a mnemonic's modes (only the ones it has are emitted).
const MODE_ORDER = [
	"imp",
	"acc",
	"imm",
	"zpg",
	"zpx",
	"zpy",
	"abs",
	"abx",
	"aby",
	"rel",
	"ind",
	"inx",
	"iny",
] as const;

type Mode = (typeof MODE_ORDER)[number];

// mnemonic -> mode -> opcode, documented opcodes only.
const table = new Map<string, Map<Mode, number>>();

let documented = 0;
for (const op of NMOS_OPCODES) {
	if (op.undocumented) continue;
	documented++;

	let modes = table.get(op.mnemonic);
	if (!modes) {
		modes = new Map();
		table.set(op.mnemonic, modes);
	}

	// Faithful-inverse guard: each (mnemonic, mode) must map to one opcode.
	const existing = modes.get(op.mode);
	if (existing !== undefined) {
		throw new Error(
			`Duplicate ${op.mnemonic} ${op.mode}: ` +
				`${existing.toString(16)} vs ${op.opcode.toString(16)}`,
		);
	}
	modes.set(op.mode, op.opcode);
}

// Every documented opcode must have landed in exactly one slot.
let slots = 0;
for (const modes of table.values()) slots += modes.size;
if (slots !== documented) {
	throw new Error(`Expected ${documented} slots, got ${slots}`);
}

const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(2, "0")}`;

const entries = [...table.keys()].sort().map((mnemonic) => {
	const modes = table.get(mnemonic)!;
	// Emit each entry already broken (newline after `{`) so prettier keeps every
	// entry multiline — short ones included — rather than collapsing them inline.
	const lines = MODE_ORDER.filter((m) => modes.has(m)).map(
		(m) => `\t\t${m}: ${hex(modes.get(m)!)},`,
	);
	return `\t${mnemonic}: {\n${lines.join("\n")}\n\t},`;
});

const output = `// Generated from @sfotty-pie/sfotty's NMOS_OPCODES by generate-opcodes.ts.
// Do not edit by hand — run \`pnpm generate:opcodes\` to regenerate.
// Documented NMOS 6502 opcodes only; undocumented opcodes are excluded for now.

export type Mode =
${MODE_ORDER.map((m) => `\t| "${m}"`).join("\n")};

/** Mnemonic to (addressing mode to opcode), e.g. \`OPCODES.LDA.abs === 0xAD\`. */
export const OPCODES: Record<string, Partial<Record<Mode, number>>> = {
${entries.join("\n")}
};
`;

const outPath = join(import.meta.dirname, "opcodes.ts");
const config = await prettier.resolveConfig(outPath);
const formatted = await prettier.format(output, {
	...config,
	parser: "typescript",
});
writeFileSync(outPath, formatted);
process.stdout.write(
	`Wrote opcodes.ts: ${table.size} mnemonics, ${slots} opcodes.\n`,
);
