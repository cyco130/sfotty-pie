// Generated from @sfotty-pie/sfotty's NMOS_OPCODES by generate-opcodes.ts.
// Do not edit by hand — run `pnpm generate:opcodes` to regenerate.
// Documented NMOS 6502 opcodes only; undocumented opcodes are excluded for now.

export type Mode =
	| "imp"
	| "acc"
	| "imm"
	| "zpg"
	| "zpx"
	| "zpy"
	| "abs"
	| "abx"
	| "aby"
	| "rel"
	| "ind"
	| "inx"
	| "iny";

/** Mnemonic to (addressing mode to opcode), e.g. `OPCODES.LDA.abs === 0xAD`. */
export const OPCODES: Record<string, Partial<Record<Mode, number>>> = {
	ADC: {
		imm: 0x69,
		zpg: 0x65,
		zpx: 0x75,
		abs: 0x6d,
		abx: 0x7d,
		aby: 0x79,
		inx: 0x61,
		iny: 0x71,
	},
	AND: {
		imm: 0x29,
		zpg: 0x25,
		zpx: 0x35,
		abs: 0x2d,
		abx: 0x3d,
		aby: 0x39,
		inx: 0x21,
		iny: 0x31,
	},
	ASL: {
		acc: 0x0a,
		zpg: 0x06,
		zpx: 0x16,
		abs: 0x0e,
		abx: 0x1e,
	},
	BCC: {
		rel: 0x90,
	},
	BCS: {
		rel: 0xb0,
	},
	BEQ: {
		rel: 0xf0,
	},
	BIT: {
		zpg: 0x24,
		abs: 0x2c,
	},
	BMI: {
		rel: 0x30,
	},
	BNE: {
		rel: 0xd0,
	},
	BPL: {
		rel: 0x10,
	},
	BRK: {
		imp: 0x00,
	},
	BVC: {
		rel: 0x50,
	},
	BVS: {
		rel: 0x70,
	},
	CLC: {
		imp: 0x18,
	},
	CLD: {
		imp: 0xd8,
	},
	CLI: {
		imp: 0x58,
	},
	CLV: {
		imp: 0xb8,
	},
	CMP: {
		imm: 0xc9,
		zpg: 0xc5,
		zpx: 0xd5,
		abs: 0xcd,
		abx: 0xdd,
		aby: 0xd9,
		inx: 0xc1,
		iny: 0xd1,
	},
	CPX: {
		imm: 0xe0,
		zpg: 0xe4,
		abs: 0xec,
	},
	CPY: {
		imm: 0xc0,
		zpg: 0xc4,
		abs: 0xcc,
	},
	DEC: {
		zpg: 0xc6,
		zpx: 0xd6,
		abs: 0xce,
		abx: 0xde,
	},
	DEX: {
		imp: 0xca,
	},
	DEY: {
		imp: 0x88,
	},
	EOR: {
		imm: 0x49,
		zpg: 0x45,
		zpx: 0x55,
		abs: 0x4d,
		abx: 0x5d,
		aby: 0x59,
		inx: 0x41,
		iny: 0x51,
	},
	INC: {
		zpg: 0xe6,
		zpx: 0xf6,
		abs: 0xee,
		abx: 0xfe,
	},
	INX: {
		imp: 0xe8,
	},
	INY: {
		imp: 0xc8,
	},
	JMP: {
		abs: 0x4c,
		ind: 0x6c,
	},
	JSR: {
		abs: 0x20,
	},
	LDA: {
		imm: 0xa9,
		zpg: 0xa5,
		zpx: 0xb5,
		abs: 0xad,
		abx: 0xbd,
		aby: 0xb9,
		inx: 0xa1,
		iny: 0xb1,
	},
	LDX: {
		imm: 0xa2,
		zpg: 0xa6,
		zpy: 0xb6,
		abs: 0xae,
		aby: 0xbe,
	},
	LDY: {
		imm: 0xa0,
		zpg: 0xa4,
		zpx: 0xb4,
		abs: 0xac,
		abx: 0xbc,
	},
	LSR: {
		acc: 0x4a,
		zpg: 0x46,
		zpx: 0x56,
		abs: 0x4e,
		abx: 0x5e,
	},
	NOP: {
		imp: 0xea,
	},
	ORA: {
		imm: 0x09,
		zpg: 0x05,
		zpx: 0x15,
		abs: 0x0d,
		abx: 0x1d,
		aby: 0x19,
		inx: 0x01,
		iny: 0x11,
	},
	PHA: {
		imp: 0x48,
	},
	PHP: {
		imp: 0x08,
	},
	PLA: {
		imp: 0x68,
	},
	PLP: {
		imp: 0x28,
	},
	ROL: {
		acc: 0x2a,
		zpg: 0x26,
		zpx: 0x36,
		abs: 0x2e,
		abx: 0x3e,
	},
	ROR: {
		acc: 0x6a,
		zpg: 0x66,
		zpx: 0x76,
		abs: 0x6e,
		abx: 0x7e,
	},
	RTI: {
		imp: 0x40,
	},
	RTS: {
		imp: 0x60,
	},
	SBC: {
		imm: 0xe9,
		zpg: 0xe5,
		zpx: 0xf5,
		abs: 0xed,
		abx: 0xfd,
		aby: 0xf9,
		inx: 0xe1,
		iny: 0xf1,
	},
	SEC: {
		imp: 0x38,
	},
	SED: {
		imp: 0xf8,
	},
	SEI: {
		imp: 0x78,
	},
	STA: {
		zpg: 0x85,
		zpx: 0x95,
		abs: 0x8d,
		abx: 0x9d,
		aby: 0x99,
		inx: 0x81,
		iny: 0x91,
	},
	STX: {
		zpg: 0x86,
		zpy: 0x96,
		abs: 0x8e,
	},
	STY: {
		zpg: 0x84,
		zpx: 0x94,
		abs: 0x8c,
	},
	TAX: {
		imp: 0xaa,
	},
	TAY: {
		imp: 0xa8,
	},
	TSX: {
		imp: 0xba,
	},
	TXA: {
		imp: 0x8a,
	},
	TXS: {
		imp: 0x9a,
	},
	TYA: {
		imp: 0x98,
	},
};
