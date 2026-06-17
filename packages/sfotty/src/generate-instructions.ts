import { writeFileSync } from "node:fs";
import { join } from "node:path";
import prettier from "prettier";
import { NMOS_OPCODES } from "./nmos-opcodes.ts";
import type { BusOp, InternalOp } from "./microcode.ts";

const ops: [m: BusOp, ...a: InternalOp[]][][] = [];

for (let opcode = 0; opcode <= 0xff; opcode++) {
	const entry = NMOS_OPCODES.find((op) => op.opcode === opcode);

	if (!entry) {
		throw new Error(
			`Missing opcode entry for 0x${opcode.toString(16).padStart(2, "0")}`,
		);
	}

	if (entry.opcode !== opcode) {
		throw new Error(
			`Opcode mismatch for 0x${opcode.toString(16).padStart(2, "0")}: expected 0x${entry.opcode.toString(16).padStart(2, "0")}`,
		);
	}

	switch (entry.mnemonic) {
		case "CIM":
			if (entry.mode !== "imp") {
				throw new Error(
					`Unexpected addressing mode ${entry.mode} for ${entry.mnemonic}`,
				);
			}

			ops[opcode] = [
				["r-pc", "ar=ffff"],
				["r-ar", "ar=fffe"],
				["r-ar", "ar=fffe"],
				["r-ar", "ar=ffff"],
				["r-ar", "cc--"],
			];
			break;

		case "BRK":
			if (entry.mode !== "imp") {
				throw new Error(
					`Unexpected addressing mode ${entry.mode} for ${entry.mnemonic}`,
				);
			}

			// 1    PC     R  fetch opcode, increment PC
			// 2    PC     R  read next instruction byte (and throw it away),
			//                increment PC
			// 3  $0100,S  W  push PCH on stack (with B flag set), decrement S
			// 4  $0100,S  W  push PCL on stack, decrement S
			// 5  $0100,S  W  push P on stack, decrement S
			// 6   $FFFE   R  fetch PCL
			// 7   $FFFF   R  fetch PCH

			// Shared with the IRQ/NMI sequence (forced by decode on a pending
			// interrupt). `r-brk` advances PC only on a software BRK, and `dr=pi`
			// pushes P with B reflecting bFlag — so a hardware interrupt pushes the
			// interrupted PC with B clear, while a real BRK skips the signature byte
			// with B set.
			ops[opcode] = [
				["r-brk", "dummy", "ar=sp", "dr=pch"], // read next byte, thrown away
				["w-ar--", "dr=pcl"],
				["w-ar--", "dr=pi", "if=1"],
				["w-ar--", "s=al", "ar=vector"],
				["r-ar++", "pcl=dr"],
				["r-ar", "pch=dr", "nmi-hold"],
			];
			break;

		case "JSR":
			if (entry.mode !== "abs") {
				throw new Error(
					`Unexpected addressing mode ${entry.mode} for ${entry.mnemonic}`,
				);
			}

			// 1    PC     R  fetch opcode, increment PC
			// 2    PC     R  fetch low address byte, increment PC
			// 3  $0100,S  R  internal operation (predecrement S?)
			// 4  $0100,S  W  push PCH on stack, decrement S
			// 5  $0100,S  W  push PCL on stack, decrement S
			// 6    PC     R  copy low address byte to PCL, fetch high address
			//                byte to PCH

			ops[opcode] = [
				["r-pc++", "ar=sp", "s=dr"],
				["r-ar", "dummy", "dr=pch"], // internal stack read, value discarded
				["w-ar--", "dr=pcl"],
				["w-ar--"],
				["r-pc", "pcl=s", "s=al", "pch=dr"],
			];

			break;

		case "JMP":
			switch (entry.mode) {
				case "abs":
					// 1    PC     R  fetch opcode, increment PC
					// 2    PC     R  fetch low address byte, increment PC
					// 3    PC     R  copy low address byte to PCL, fetch high address
					//                byte to PCH

					ops[opcode] = [
						["r-pc++", "ar=dr"],
						["r-pc", "pcl=al", "pch=dr"],
					];

					break;

				case "ind":
					// 1     PC      R  fetch opcode, increment PC
					// 2     PC      R  fetch pointer address low, increment PC
					// 3     PC      R  fetch pointer address high, increment PC
					// 4   pointer   R  fetch low address to latch
					// 5  pointer+1* R  fetch PCH, copy latch to PCL

					// * The PCH will always be fetched from the same page
					//   than PCL, i.e. page boundary crossing is not handled.

					ops[opcode] = [
						["r-pc++", "ar=dr"],
						["r-pc++", "ah=dr"],
						["r-ar++", "pcl=dr"],
						["r-ar", "pch=dr"],
					];
					break;

				default:
					throw new Error(
						`Unexpected addressing mode ${entry.mode} for ${entry.mnemonic}`,
					);
			}

			break;

		case "RTI":
			if (entry.mode !== "imp") {
				throw new Error(
					`Unexpected addressing mode ${entry.mode} for ${entry.mnemonic}`,
				);
			}

			// 1    PC     R  fetch opcode, increment PC
			// 2    PC     R  read next instruction byte (and throw it away)
			// 3  $0100,S  R  increment S
			// 4  $0100,S  R  pull P from stack, increment S
			// 5  $0100,S  R  pull PCL from stack, increment S
			// 6  $0100,S  R  pull PCH from stack

			ops[opcode] = [
				["r-pc", "dummy", "ar=sp"], // read next byte, thrown away
				["r-ar++", "dummy"], // increment S (stack read discarded)
				["r-ar++", "p=dr"],
				["r-ar++", "pcl=dr"],
				["r-ar", "pch=dr", "s=al"],
			];

			break;

		case "RTS":
			if (entry.mode !== "imp") {
				throw new Error(
					`Unexpected addressing mode ${entry.mode} for ${entry.mnemonic}`,
				);
			}

			// 1    PC     R  fetch opcode, increment PC
			// 2    PC     R  read next instruction byte (and throw it away)
			// 3  $0100,S  R  increment S
			// 4  $0100,S  R  pull PCL from stack, increment S
			// 5  $0100,S  R  pull PCH from stack
			// 6    PC     R  increment PC

			ops[opcode] = [
				["r-pc", "dummy", "ar=sp"], // read next byte, thrown away
				["r-ar++", "dummy"], // increment S (stack read discarded)
				["r-ar++", "pcl=dr"],
				["r-ar", "pch=dr", "s=al"],
				["r-pc++", "dummy"], // increment PC (PC read discarded)
			];

			break;

		case "PHP":
			if (entry.mode !== "imp") {
				throw new Error(
					`Unexpected addressing mode ${entry.mode} for ${entry.mnemonic}`,
				);
			}

			// 1    PC     R  fetch opcode, increment PC
			// 2    PC     R  read next instruction byte (and throw it away)
			// 3  $0100,S  W  push register on stack, decrement S
			ops[opcode] = [
				["r-pc", "dummy", "ar=sp", "dr=p"], // read next byte, thrown away
				["w-ar--", "s=al"],
			];
			break;

		case "PHA":
			if (entry.mode !== "imp") {
				throw new Error(
					`Unexpected addressing mode ${entry.mode} for ${entry.mnemonic}`,
				);
			}

			// 1    PC     R  fetch opcode, increment PC
			// 2    PC     R  read next instruction byte (and throw it away)
			// 3  $0100,S  W  push register on stack, decrement S
			ops[opcode] = [
				["r-pc", "dummy", "ar=sp", "dr=a"], // read next byte, thrown away
				["w-ar--", "s=al"],
			];
			break;

		case "PLP":
			if (entry.mode !== "imp") {
				throw new Error(
					`Unexpected addressing mode ${entry.mode} for ${entry.mnemonic}`,
				);
			}

			// 1    PC     R  fetch opcode, increment PC
			// 2    PC     R  read next instruction byte (and throw it away)
			// 3  $0100,S  R  increment S
			// 4  $0100,S  R  pull register from stack

			ops[opcode] = [
				["r-pc", "dummy", "ar=sp"], // read next byte, thrown away
				["r-ar++", "dummy"], // increment S (stack read discarded)
				["r-ar", "s=al", "p=dr"],
			];
			break;

		case "PLA":
			if (entry.mode !== "imp") {
				throw new Error(
					`Unexpected addressing mode ${entry.mode} for ${entry.mnemonic}`,
				);
			}

			// 1    PC     R  fetch opcode, increment PC
			// 2    PC     R  read next instruction byte (and throw it away)
			// 3  $0100,S  R  increment S
			// 4  $0100,S  R  pull register from stack

			ops[opcode] = [
				["r-pc", "dummy", "ar=sp"], // read next byte, thrown away
				["r-ar++", "dummy"], // increment S (stack read discarded)
				["r-ar", "s=al", "a=dr"],
			];
			break;

		case "ORA":
		case "AND":
		case "EOR":
		case "BIT":
		case "ADC":
		case "SBC":
		case "CMP":
		case "CPX":
		case "CPY":
		case "LDA":
		case "LDX":
		case "LDY":
		case "NOP":
		case "ANC":
		case "ASR":
		case "ARR":
		case "ANE":
		case "LAX":
		case "LXA":
		case "LAS":
		case "SBX":
			{
				const operation = (
					{
						ORA: "ro-ora",
						AND: "ro-and",
						EOR: "ro-eor",
						BIT: "ro-bit",
						ADC: "ro-adc",
						SBC: "ro-sbc",
						CMP: "ro-cmp",
						CPX: "ro-cpx",
						CPY: "ro-cpy",
						LDA: "a=dr",
						LDX: "x=dr",
						LDY: "y=dr",
						NOP: "nop",
						ANC: "ro-anc",
						ASR: "ro-asr",
						ARR: "ro-arr",
						ANE: "ro-ane",
						LAX: "ro-lax",
						LXA: "ro-lxa",
						LAS: "ro-las",
						SBX: "ro-sbx",
					} as const
				)[entry.mnemonic];

				switch (entry.mode) {
					case "imp":
						if (entry.mnemonic !== "NOP") {
							throw new Error(
								`Unexpected implied addressing for ${entry.mnemonic}`,
							);
						}
						ops[opcode] = [
							//
							["r-pc", "dummy"], // Do nothing (dummy read of PC)
						];
						break;
					case "imm":
						ops[opcode] = [["r-pc++", operation]];
						break;
					case "zpg":
						ops[opcode] = readZeropage(operation);
						break;
					case "abs":
						ops[opcode] = readAbsolute(operation);
						break;
					case "zpx":
						ops[opcode] = readZeropageX(operation);
						break;
					case "zpy":
						ops[opcode] = readZeropageY(operation);
						break;
					case "abx":
						ops[opcode] = readAbsoluteX(operation);
						break;
					case "aby":
						ops[opcode] = readAbsoluteY(operation);
						break;
					case "inx":
						ops[opcode] = readIndirectX(operation);
						break;
					case "iny":
						ops[opcode] = readIndirectY(operation);
						break;
					default:
						throw new Error(
							`Unexpected addressing mode ${entry.mode} for ${entry.mnemonic}`,
						);
				}
			}
			break;

		case "CLC":
		case "SEC":
		case "CLI":
		case "SEI":
		case "CLV":
		case "CLD":
		case "SED":
		case "TAX":
		case "TAY":
		case "TYA":
		case "TXA":
		case "TXS":
		case "TSX":
		case "INX":
		case "DEX":
		case "INY":
		case "DEY":
			{
				const operation = (
					{
						CLC: "cf=0",
						SEC: "cf=1",
						CLI: "if=0",
						SEI: "if=1",
						CLV: "of=0",
						CLD: "df=0",
						SED: "df=1",
						TAX: "x=a",
						TAY: "y=a",
						TYA: "a=y",
						TXA: "a=x",
						TXS: "s=x",
						TSX: "x=s",
						INX: "x++",
						DEX: "x--",
						INY: "y++",
						DEY: "y--",
					} as const
				)[entry.mnemonic];

				if (entry.mode !== "imp") {
					throw new Error(
						`Unexpected addressing mode ${entry.mode} for ${entry.mnemonic}`,
					);
				}

				ops[opcode] = [["r-pc", "dummy", operation]];
			}
			break;

		case "DEC":
		case "INC":
		case "ASL":
		case "LSR":
		case "ROL":
		case "ROR":
		case "SLO":
		case "RLA":
		case "SRE":
		case "RRA":
		case "DCP":
		case "ISB":
			{
				const operation = (
					{
						DEC: "mo-dec",
						INC: "mo-inc",
						ASL: "mo-asl",
						LSR: "mo-lsr",
						ROL: "mo-rol",
						ROR: "mo-ror",
						SLO: "mo-slo",
						RLA: "mo-rla",
						SRE: "mo-sre",
						RRA: "mo-rra",
						DCP: "mo-dcp",
						ISB: "mo-isb",
					} as const
				)[entry.mnemonic];

				switch (entry.mode) {
					case "acc":
						switch (entry.mnemonic) {
							case "ASL":
								ops[opcode] = [["r-pc", "dummy", "asla"]];
								break;
							case "LSR":
								ops[opcode] = [["r-pc", "dummy", "lsra"]];
								break;
							case "ROL":
								ops[opcode] = [["r-pc", "dummy", "rola"]];
								break;
							case "ROR":
								ops[opcode] = [["r-pc", "dummy", "rora"]];
								break;

							default:
								throw new Error(
									`Unexpected accumulator addressing for ${entry.mnemonic}`,
								);
						}
						break;
					case "zpg":
						ops[opcode] = rmwZeropage(operation);
						break;
					case "abs":
						ops[opcode] = rmwAbsolute(operation);
						break;
					case "zpx":
						ops[opcode] = rmwZeropageX(operation);
						break;
					case "zpy":
						ops[opcode] = rmwZeropageY(operation);
						break;
					case "abx":
						ops[opcode] = rmwAbsoluteX(operation);
						break;
					case "aby":
						ops[opcode] = rmwAbsoluteY(operation);
						break;
					case "inx":
						ops[opcode] = rmwIndirectX(operation);
						break;
					case "iny":
						ops[opcode] = rmwIndirectY(operation);
						break;
					default:
						throw new Error(
							`Unexpected addressing mode ${entry.mode} for ${entry.mnemonic}`,
						);
				}
			}
			break;

		case "BCC":
		case "BCS":
		case "BNE":
		case "BEQ":
		case "BPL":
		case "BMI":
		case "BVC":
		case "BVS":
			{
				const operation = (
					{
						BCC: "cc?",
						BCS: "cs?",
						BNE: "ne?",
						BEQ: "eq?",
						BPL: "pl?",
						BMI: "mi?",
						BVC: "vc?",
						BVS: "vs?",
					} as const
				)[entry.mnemonic];
				ops[opcode] = relative(operation);
			}
			break;

		case "STA":
		case "STX":
		case "STY":
		case "SAX":
		case "SHA":
		case "SHX":
		case "SHY":
		case "SHS":
			{
				const operation = (
					{
						STA: "sta",
						STX: "stx",
						STY: "sty",
						SAX: "sax",
						SHA: "sha",
						SHX: "shx",
						SHY: "shy",
						SHS: "shs",
					} as const
				)[entry.mnemonic];

				switch (entry.mode) {
					case "zpg":
						ops[opcode] = storeZeropage(operation);
						break;

					case "abs":
						ops[opcode] = storeAbsolute(operation);
						break;

					case "abx":
						ops[opcode] = storeAbsoluteX(operation);
						break;

					case "aby":
						ops[opcode] = storeAbsoluteY(operation);
						break;

					case "zpx":
						ops[opcode] = storeZeropageX(operation);
						break;

					case "zpy":
						ops[opcode] = storeZeropageY(operation);
						break;

					case "inx":
						ops[opcode] = storeIndirectX(operation);
						break;

					case "iny":
						ops[opcode] = storeIndirectY(operation);
						break;

					default:
						throw new Error(
							`Unexpected addressing mode ${entry.mode} for ${entry.mnemonic}`,
						);
				}
			}
			break;

		default:
			throw new Error(
				`Unexpected mnemonic ${entry.mnemonic} for opcode 0x${opcode.toString(16).padStart(2, "0")}`,
			);
	}
}

const entries: string[] = [];
for (const [opcode, operation] of ops.entries()) {
	const entry = NMOS_OPCODES.find((op) => op.opcode === opcode)!;

	const newEntry = { ...entry, code: operation };

	const hex = opcode.toString(16).toUpperCase().padStart(2, "0");
	// Indent the JSON so the first property lands on its own line: Prettier
	// preserves an object's expanded state, so every entry stays multiline
	// (short inner `code` arrays are still re-collapsed by Prettier).
	entries.push(
		`// ${hex} ${newEntry.mnemonic} ${newEntry.mode}\n${JSON.stringify(newEntry, null, "\t")},`,
	);
}

const source = `// Generated by generate-instructions.ts — do not edit by hand.
// Regenerate with \`pnpm --filter @sfotty-pie/sfotty generate:instructions\`.

import type { Instruction } from "./microcode.ts";

export const NMOS_INSTRUCTIONS: Instruction[] = [
${entries.join("\n")}
];
`;

const outPath = join(import.meta.dirname, "nmos-instructions.generated.ts");
const config = await prettier.resolveConfig(outPath);
const formatted = await prettier.format(source, {
	...config,
	parser: "typescript",
});
writeFileSync(outPath, formatted);

// eslint-disable-next-line no-console
console.log(`Wrote ${ops.length} instructions to ${outPath}`);

function readZeropage(operation: InternalOp): [BusOp, ...InternalOp[]][] {
	// 1    PC     R  fetch opcode, increment PC
	// 2    PC     R  fetch address, increment PC
	// 3  address  R  read from effective address

	return [
		["r-pc++", "ar=dr"],
		["r-ar", operation],
	];
}

function readAbsolute(operation: InternalOp): [BusOp, ...InternalOp[]][] {
	// 1    PC     R  fetch opcode, increment PC
	// 2    PC     R  fetch low byte of address, increment PC
	// 3    PC     R  fetch high byte of address, increment PC
	// 4  address  R  read from effective address

	return [
		["r-pc++", "ar=dr"],
		["r-pc++", "ah=dr"],
		["r-ar", operation],
	];
}

function readZeropageX(operation: InternalOp): [BusOp, ...InternalOp[]][] {
	// 1     PC      R  fetch opcode, increment PC
	// 2     PC      R  fetch address, increment PC
	// 3   address   R  read from address, add index register to it
	// 4  address+I* R  read from effective address

	// * The high byte of the effective address is always zero,
	//   i.e. page boundary crossings are not handled.

	return [
		["r-pc++", "ar=dr"],
		["r-ar", "ar+=x"],
		["r-ar", operation],
	];
}

function readZeropageY(operation: InternalOp): [BusOp, ...InternalOp[]][] {
	// 1     PC      R  fetch opcode, increment PC
	// 2     PC      R  fetch address, increment PC
	// 3   address   R  read from address, add index register to it
	// 4  address+I* R  read from effective address

	// * The high byte of the effective address is always zero,
	//   i.e. page boundary crossings are not handled.

	return [
		["r-pc++", "ar=dr"],
		["r-ar", "ar+=y"],
		["r-ar", operation],
	];
}

function readAbsoluteX(operation: InternalOp): [BusOp, ...InternalOp[]][] {
	// 1     PC      R  fetch opcode, increment PC
	// 2     PC      R  fetch low byte of address, increment PC
	// 3     PC      R  fetch high byte of address,
	//                  add index register to low address byte,
	//                  increment PC
	// 4  address+I* R  read from effective address,
	//                  fix the high byte of effective address
	// 5+ address+I  R  re-read from effective address

	// * The high byte of the effective address may be invalid
	//   at this time, i.e. it may be smaller by $100.
	//
	// + This cycle will be executed only if the effective address
	//   was invalid during cycle #4, i.e. page boundary was crossed.

	return [
		["r-pc++", "ar=dr"],
		["r-pc++", "ah=dr", "ar+=x?"],
		["r-ar", "?", "ah++", operation],
		["r-ar", operation],
	];
}

function readAbsoluteY(operation: InternalOp): [BusOp, ...InternalOp[]][] {
	// 1     PC      R  fetch opcode, increment PC
	// 2     PC      R  fetch low byte of address, increment PC
	// 3     PC      R  fetch high byte of address,
	//                  add index register to low address byte,
	//                  increment PC
	// 4  address+I* R  read from effective address,
	//                  fix the high byte of effective address
	// 5+ address+I  R  re-read from effective address

	// * The high byte of the effective address may be invalid
	//   at this time, i.e. it may be smaller by $100.
	//
	// + This cycle will be executed only if the effective address
	//   was invalid during cycle #4, i.e. page boundary was crossed.

	return [
		["r-pc++", "ar=dr"],
		["r-pc++", "ah=dr", "ar+=y?"],
		["r-ar", "?", "ah++", operation],
		["r-ar", operation],
	];
}

function readIndirectX(operation: InternalOp): [BusOp, ...InternalOp[]][] {
	// 1      PC       R  fetch opcode, increment PC
	// 2      PC       R  fetch pointer address, increment PC
	// 3    pointer    R  read from the address, add X to it
	// 4   pointer+X   R  fetch effective address low
	// 5  pointer+X+1  R  fetch effective address high
	// 6    address    R  read from effective address

	return [
		["r-pc++", "ar=dr"],
		["r-ar", "ar+=x", "dr=al"],
		["r-dr++"], // AL = read(DR++);
		["r-dr"], // AH = read(DR);
		["r-ar", operation],
	];
}

function readIndirectY(operation: InternalOp): [BusOp, ...InternalOp[]][] {
	// 1      PC       R  fetch opcode, increment PC
	// 2      PC       R  fetch pointer address, increment PC
	// 3    pointer    R  fetch effective address low
	// 4   pointer+1   R  fetch effective address high,
	//                    add Y to low byte of effective address
	// 5   address+Y*  R  read from effective address,
	//                    fix high byte of effective address
	// 6+  address+Y   R  read from effective address

	//       * The high byte of the effective address may be invalid
	//         at this time, i.e. it may be smaller by $100.
	//
	//       + This cycle will be executed only if the effective address
	//         was invalid during cycle #5, i.e. page boundary was crossed.

	return [
		["r-pc++", "ar=dr"],
		["r-dr++"],
		["r-dr", "ar+=y?"],
		["r-ar", "?", "ah++", operation],
		["r-ar", operation],
	];
}

function rmwZeropage(operation: InternalOp): [BusOp, ...InternalOp[]][] {
	// 1    PC     R  fetch opcode, increment PC
	// 2    PC     R  fetch address, increment PC
	// 3  address  R  read from effective address
	// 4  address  W  write the value back to effective address,
	//                and do the operation on it
	// 5  address  W  write the new value to effective address

	return [["r-pc++", "ar=dr"], ["r-ar"], ["w-ar", operation], ["w-ar"]];
}

function rmwAbsolute(operation: InternalOp): [BusOp, ...InternalOp[]][] {
	// 1    PC     R  fetch opcode, increment PC
	// 2    PC     R  fetch low byte of address, increment PC
	// 3    PC     R  fetch high byte of address, increment PC
	// 4  address  R  read from effective address
	// 5  address  W  write the value back to effective address,
	//                and do the operation on it
	// 6  address  W  write the new value to effective address

	return [
		["r-pc++", "ar=dr"],
		["r-pc++", "ah=dr"],
		["r-ar"],
		["w-ar", operation],
		["w-ar"],
	];
}

function rmwZeropageX(operation: InternalOp): [BusOp, ...InternalOp[]][] {
	// 1     PC      R  fetch opcode, increment PC
	// 2     PC      R  fetch address, increment PC
	// 3   address   R  read from address, add index register X to it
	// 4  address+X* R  read from effective address
	// 5  address+X* W  write the value back to effective address,
	//                  and do the operation on it
	// 6  address+X* W  write the new value to effective address

	// * The high byte of the effective address is always zero,
	//   i.e. page boundary crossings are not handled.

	return [
		["r-pc++", "ar=dr"],
		["r-ar", "ar+=x"],
		["r-ar"],
		["w-ar", operation],
		["w-ar"],
	];
}

function rmwZeropageY(operation: InternalOp): [BusOp, ...InternalOp[]][] {
	// 1     PC      R  fetch opcode, increment PC
	// 2     PC      R  fetch address, increment PC
	// 3   address   R  read from address, add index register Y to it
	// 4  address+Y* R  read from effective address
	// 5  address+Y* W  write the value back to effective address,
	//                  and do the operation on it
	// 6  address+Y* W  write the new value to effective address

	// * The high byte of the effective address is always zero,
	//   i.e. page boundary crossings are not handled.

	return [
		["r-pc++", "ar=dr"],
		["r-ar", "ar+=y"],
		["r-ar"],
		["w-ar", operation],
		["w-ar"],
	];
}

function rmwAbsoluteX(operation: InternalOp): [BusOp, ...InternalOp[]][] {
	// 1    PC       R  fetch opcode, increment PC
	// 2    PC       R  fetch low byte of address, increment PC
	// 3    PC       R  fetch high byte of address,
	//                  add index register X to low address byte,
	//                  increment PC
	// 4  address+X* R  read from effective address,
	//                  fix the high byte of effective address
	// 5  address+X  R  re-read from effective address
	// 6  address+X  W  write the value back to effective address,
	//                  and do the operation on it
	// 7  address+X  W  write the new value to effective address

	// * The high byte of the effective address may be invalid
	//   at this time, i.e. it may be smaller by $100.
	return [
		["r-pc++", "ar=dr"],
		["r-pc++", "ah=dr", "ar+=x?"],
		["r-ar", "?ah++"],
		["r-ar"],
		["w-ar", operation],
		["w-ar"],
	];
}

function rmwAbsoluteY(operation: InternalOp): [BusOp, ...InternalOp[]][] {
	// 1    PC       R  fetch opcode, increment PC
	// 2    PC       R  fetch low byte of address, increment PC
	// 3    PC       R  fetch high byte of address,
	//                  add index register Y to low address byte,
	//                  increment PC
	// 4  address+Y* R  read from effective address,
	//                  fix the high byte of effective address
	// 5  address+Y  R  re-read from effective address
	// 6  address+Y  W  write the value back to effective address,
	//                  and do the operation on it
	// 7  address+Y  W  write the new value to effective address

	// * The high byte of the effective address may be invalid
	//   at this time, i.e. it may be smaller by $100.
	return [
		["r-pc++", "ar=dr"],
		["r-pc++", "ah=dr", "ar+=y?"],
		["r-ar", "?ah++"],
		["r-ar"],
		["w-ar", operation],
		["w-ar"],
	];
}

function rmwIndirectX(operation: InternalOp): [BusOp, ...InternalOp[]][] {
	// 1      PC       R  fetch opcode, increment PC
	// 2      PC       R  fetch pointer address, increment PC
	// 3    pointer    R  read from the address, add X to it
	// 4   pointer+X   R  fetch effective address low
	// 5  pointer+X+1  R  fetch effective address high
	// 6    address    R  read from effective address
	// 7    address    W  write the value back to effective address,
	//                    and do the operation on it
	// 8    address    W  write the new value to effective address
	return [
		["r-pc++", "ar=dr"],
		["r-ar", "ar+=x", "dr=al"],
		["r-dr++"], // AL = read(DR++);
		["r-dr"], // AH = read(DR);
		["r-ar"],
		["w-ar", operation],
		["w-ar"],
	];
}

function rmwIndirectY(operation: InternalOp): [BusOp, ...InternalOp[]][] {
	// 1      PC       R  fetch opcode, increment PC
	// 2      PC       R  fetch pointer address, increment PC
	// 3    pointer    R  fetch effective address low
	// 4   pointer+1   R  fetch effective address high,
	//                    add Y to low byte of effective address
	// 5   address+Y*  R  read from effective address,
	//                    fix high byte of effective address
	// 6   address+Y   R  read from effective address
	// 7   address+Y   W  write the value back to effective address,
	//                    and do the operation on it
	// 8   address+Y   W  write the new value to effective address

	// * The high byte of the effective address may be invalid
	//   at this time, i.e. it may be smaller by $100.

	return [
		["r-pc++", "ar=dr"],
		["r-dr++"],
		["r-dr", "ar+=y?"],
		["r-ar", "?ah++"],
		["r-ar"],
		["w-ar", operation],
		["w-ar"],
	];
}

function relative(operation: InternalOp): [BusOp, ...InternalOp[]][] {
	// 1     PC      R  fetch opcode, increment PC
	// 2     PC      R  fetch operand, increment PC
	// 3     PC      R  Fetch opcode of next instruction,
	//                  If branch is taken, add operand to PCL.
	//                  Otherwise increment PC.
	// 4+    PC*     R  Fetch opcode of next instruction.
	//                  Fix PCH. If it did not change, increment PC.
	// 5!    PC      R  Fetch opcode of next instruction,
	//                  increment PC.

	// * The high byte of Program Counter (PCH) may be invalid
	//   at this time, i.e. it may be smaller or bigger by $100.
	//
	// + If branch is taken, this cycle will be executed.
	//
	// ! If branch occurs to different page, this cycle will be
	//   executed.

	return [
		["r-pc++", operation],
		["r-pc", "pc+=dr?"],
		["r-pc", "pch=fix"],
	];
}

function storeZeropage(operation: InternalOp): [BusOp, ...InternalOp[]][] {
	// 1    PC     R  fetch opcode, increment PC
	// 2    PC     R  fetch address, increment PC
	// 3  address  W  write register to effective address

	return [
		//

		["r-pc++", "ar=dr", operation],
		["w-ar"],
	];
}

function storeAbsolute(operation: InternalOp): [BusOp, ...InternalOp[]][] {
	// 1    PC     R  fetch opcode, increment PC
	// 2    PC     R  fetch low byte of address, increment PC
	// 3    PC     R  fetch high byte of address, increment PC
	// 4  address  W  write register to effective address

	return [["r-pc++", "ar=dr"], ["r-pc++", "ah=dr", operation], ["w-ar"]];
}

function storeZeropageX(operation: InternalOp): [BusOp, ...InternalOp[]][] {
	// 1     PC      R  fetch opcode, increment PC
	// 2     PC      R  fetch address, increment PC
	// 3   address   R  read from address, add index register to it
	// 4  address+I* W  write to effective address

	// * The high byte of the effective address is always zero,
	//   i.e. page boundary crossings are not handled.

	return [["r-pc++", "ar=dr"], ["r-ar", "ar+=x", operation], ["w-ar"]];
}

function storeZeropageY(operation: InternalOp): [BusOp, ...InternalOp[]][] {
	// 1     PC      R  fetch opcode, increment PC
	// 2     PC      R  fetch address, increment PC
	// 3   address   R  read from address, add index register to it
	// 4  address+I* W  write to effective address

	// * The high byte of the effective address is always zero,
	//   i.e. page boundary crossings are not handled.

	return [["r-pc++", "ar=dr"], ["r-ar", "ar+=y", operation], ["w-ar"]];
}

function storeAbsoluteX(operation: InternalOp): [BusOp, ...InternalOp[]][] {
	// 1     PC      R  fetch opcode, increment PC
	// 2     PC      R  fetch low byte of address, increment PC
	// 3     PC      R  fetch high byte of address,
	//                  add index register to low address byte,
	//                  increment PC
	// 4  address+I* R  read from effective address,
	//                  fix the high byte of effective address
	// 5  address+I  W  write to effective address

	// * The high byte of the effective address may be invalid
	//   at this time, i.e. it may be smaller by $100. Because
	//   the processor cannot undo a write to an invalid
	//   address, it always reads from the address first.

	return [
		["r-pc++", "ar=dr"],
		["r-pc++", "ah=dr", "ar+=x?"],
		["r-ar", "dummy", "?ah++", operation],
		["w-ar"],
	];
}

function storeAbsoluteY(operation: InternalOp): [BusOp, ...InternalOp[]][] {
	// 1     PC      R  fetch opcode, increment PC
	// 2     PC      R  fetch low byte of address, increment PC
	// 3     PC      R  fetch high byte of address,
	//                  add index register to low address byte,
	//                  increment PC
	// 4  address+I* R  read from effective address,
	//                  fix the high byte of effective address
	// 5  address+I  W  write to effective address

	// * The high byte of the effective address may be invalid
	//   at this time, i.e. it may be smaller by $100. Because
	//   the processor cannot undo a write to an invalid
	//   address, it always reads from the address first.

	return [
		["r-pc++", "ar=dr"],
		["r-pc++", "ah=dr", "ar+=y?"],
		["r-ar", "dummy", "?ah++", operation],
		["w-ar"],
	];
}

function storeIndirectX(operation: InternalOp): [BusOp, ...InternalOp[]][] {
	// 1      PC       R  fetch opcode, increment PC
	// 2      PC       R  fetch pointer address, increment PC
	// 3    pointer    R  read from the address, add X to it
	// 4   pointer+X   R  fetch effective address low
	// 5  pointer+X+1  R  fetch effective address high
	// 6    address    W  write to effective address

	return [
		["r-pc++", "ar=dr"],
		["r-ar", "ar+=x", "dr=al"],
		["r-dr++"], // AL = read(DR++);
		["r-dr", operation], // AH = read(DR);
		["w-ar"],
	];
}

function storeIndirectY(operation: InternalOp): [BusOp, ...InternalOp[]][] {
	// 1      PC       R  fetch opcode, increment PC
	// 2      PC       R  fetch pointer address, increment PC
	// 3    pointer    R  fetch effective address low
	// 4   pointer+1   R  fetch effective address high,
	//                    add Y to low byte of effective address
	// 5   address+Y*  R  read from effective address,
	//                    fix high byte of effective address
	// 6   address+Y   W  write to effective address

	// * The high byte of the effective address may be invalid
	//   at this time, i.e. it may be smaller by $100.

	return [
		["r-pc++", "ar=dr"],
		["r-dr++"],
		["r-dr", "ar+=y?"],
		["r-ar", "dummy", "?ah++", operation],
		["w-ar"],
	];
}
