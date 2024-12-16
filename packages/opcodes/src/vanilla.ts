import type { Opcode } from "./types";

export const VANILLA_OPCODES: Opcode[] = [
	{
		opcode: 0x00,
		mnemonic: "BRK",
		mode: "imp",
	},

	{
		opcode: 0x01,
		mnemonic: "ORA",
		mode: "inx",
	},

	{
		opcode: 0x05,
		mnemonic: "ORA",
		mode: "zpg",
	},

	{
		opcode: 0x06,
		mnemonic: "ASL",
		mode: "zpg",
	},

	{
		opcode: 0x08,
		mnemonic: "PHP",
		mode: "imp",
	},

	{
		opcode: 0x09,
		mnemonic: "ORA",
		mode: "imm",
	},

	{
		opcode: 0x0a,
		mnemonic: "ASL",
		mode: "acc",
	},

	{
		opcode: 0x0d,
		mnemonic: "ORA",
		mode: "abs",
	},

	{
		opcode: 0x0e,
		mnemonic: "ASL",
		mode: "abs",
	},

	{
		opcode: 0x10,
		mnemonic: "BPL",
		mode: "rel",
	},

	{
		opcode: 0x11,
		mnemonic: "ORA",
		mode: "iny",
	},

	{
		opcode: 0x15,
		mnemonic: "ORA",
		mode: "zpx",
	},

	{
		opcode: 0x16,
		mnemonic: "ASL",
		mode: "zpx",
	},

	{
		opcode: 0x18,
		mnemonic: "CLC",
		mode: "imp",
	},

	{
		opcode: 0x19,
		mnemonic: "ORA",
		mode: "aby",
	},

	{
		opcode: 0x1d,
		mnemonic: "ORA",
		mode: "abx",
	},

	{
		opcode: 0x1e,
		mnemonic: "ASL",
		mode: "abx",
	},

	{
		opcode: 0x20,
		mnemonic: "JSR",
		mode: "abs",
	},

	{
		opcode: 0x21,
		mnemonic: "AND",
		mode: "inx",
	},

	{
		opcode: 0x24,
		mnemonic: "BIT",
		mode: "zpg",
	},

	{
		opcode: 0x25,
		mnemonic: "AND",
		mode: "zpg",
	},

	{
		opcode: 0x26,
		mnemonic: "ROL",
		mode: "zpg",
	},

	{
		opcode: 0x28,
		mnemonic: "PLP",
		mode: "imp",
	},

	{
		opcode: 0x29,
		mnemonic: "AND",
		mode: "imm",
	},

	{
		opcode: 0x2a,
		mnemonic: "ROL",
		mode: "acc",
	},

	{
		opcode: 0x2c,
		mnemonic: "BIT",
		mode: "abs",
	},

	{
		opcode: 0x2d,
		mnemonic: "AND",
		mode: "abs",
	},

	{
		opcode: 0x2e,
		mnemonic: "ROL",
		mode: "abs",
	},

	{
		opcode: 0x30,
		mnemonic: "BMI",
		mode: "rel",
	},

	{
		opcode: 0x31,
		mnemonic: "AND",
		mode: "iny",
	},

	{
		opcode: 0x35,
		mnemonic: "AND",
		mode: "zpx",
	},

	{
		opcode: 0x36,
		mnemonic: "ROL",
		mode: "zpx",
	},

	{
		opcode: 0x38,
		mnemonic: "SEC",
		mode: "imp",
	},

	{
		opcode: 0x39,
		mnemonic: "AND",
		mode: "aby",
	},

	{
		opcode: 0x3d,
		mnemonic: "AND",
		mode: "abx",
	},

	{
		opcode: 0x3e,
		mnemonic: "ROL",
		mode: "abx",
	},

	{
		opcode: 0x40,
		mnemonic: "RTI",
		mode: "imp",
	},

	{
		opcode: 0x41,
		mnemonic: "EOR",
		mode: "inx",
	},

	{
		opcode: 0x45,
		mnemonic: "EOR",
		mode: "zpg",
	},

	{
		opcode: 0x46,
		mnemonic: "LSR",
		mode: "zpg",
	},

	{
		opcode: 0x48,
		mnemonic: "PHA",
		mode: "imp",
	},

	{
		opcode: 0x49,
		mnemonic: "EOR",
		mode: "imm",
	},

	{
		opcode: 0x4a,
		mnemonic: "LSR",
		mode: "acc",
	},

	{
		opcode: 0x4c,
		mnemonic: "JMP",
		mode: "abs",
	},

	{
		opcode: 0x4d,
		mnemonic: "EOR",
		mode: "abs",
	},

	{
		opcode: 0x4e,
		mnemonic: "LSR",
		mode: "abs",
	},

	{
		opcode: 0x50,
		mnemonic: "BVC",
		mode: "rel",
	},

	{
		opcode: 0x51,
		mnemonic: "EOR",
		mode: "iny",
	},

	{
		opcode: 0x55,
		mnemonic: "EOR",
		mode: "zpx",
	},

	{
		opcode: 0x56,
		mnemonic: "LSR",
		mode: "zpx",
	},

	{
		opcode: 0x58,
		mnemonic: "CLI",
		mode: "imp",
	},

	{
		opcode: 0x59,
		mnemonic: "EOR",
		mode: "aby",
	},

	{
		opcode: 0x5d,
		mnemonic: "EOR",
		mode: "abx",
	},

	{
		opcode: 0x5e,
		mnemonic: "LSR",
		mode: "abx",
	},

	{
		opcode: 0x60,
		mnemonic: "RTS",
		mode: "imp",
	},

	{
		opcode: 0x61,
		mnemonic: "ADC",
		mode: "inx",
	},

	{
		opcode: 0x65,
		mnemonic: "ADC",
		mode: "zpg",
	},

	{
		opcode: 0x66,
		mnemonic: "ROR",
		mode: "zpg",
	},

	{
		opcode: 0x68,
		mnemonic: "PLA",
		mode: "imp",
	},

	{
		opcode: 0x69,
		mnemonic: "ADC",
		mode: "imm",
	},

	{
		opcode: 0x6a,
		mnemonic: "ROR",
		mode: "acc",
	},

	{
		opcode: 0x6c,
		mnemonic: "JMP",
		mode: "ind",
	},

	{
		opcode: 0x6d,
		mnemonic: "ADC",
		mode: "abs",
	},

	{
		opcode: 0x6e,
		mnemonic: "ROR",
		mode: "abs",
	},

	{
		opcode: 0x70,
		mnemonic: "BVS",
		mode: "rel",
	},

	{
		opcode: 0x71,
		mnemonic: "ADC",
		mode: "iny",
	},

	{
		opcode: 0x75,
		mnemonic: "ADC",
		mode: "zpx",
	},

	{
		opcode: 0x76,
		mnemonic: "ROR",
		mode: "zpx",
	},

	{
		opcode: 0x78,
		mnemonic: "SEI",
		mode: "imp",
	},

	{
		opcode: 0x79,
		mnemonic: "ADC",
		mode: "aby",
	},

	{
		opcode: 0x7d,
		mnemonic: "ADC",
		mode: "abx",
	},

	{
		opcode: 0x7e,
		mnemonic: "ROR",
		mode: "abx",
	},

	{
		opcode: 0x81,
		mnemonic: "STA",
		mode: "inx",
	},

	{
		opcode: 0x84,
		mnemonic: "STY",
		mode: "zpg",
	},

	{
		opcode: 0x85,
		mnemonic: "STA",
		mode: "zpg",
	},

	{
		opcode: 0x86,
		mnemonic: "STX",
		mode: "zpg",
	},

	{
		opcode: 0x88,
		mnemonic: "DEY",
		mode: "imp",
	},

	{
		opcode: 0x8a,
		mnemonic: "TXA",
		mode: "imp",
	},

	{
		opcode: 0x8c,
		mnemonic: "STY",
		mode: "abs",
	},

	{
		opcode: 0x8d,
		mnemonic: "STA",
		mode: "abs",
	},

	{
		opcode: 0x8e,
		mnemonic: "STX",
		mode: "abs",
	},

	{
		opcode: 0x90,
		mnemonic: "BCC",
		mode: "rel",
	},

	{
		opcode: 0x91,
		mnemonic: "STA",
		mode: "iny",
	},

	{
		opcode: 0x94,
		mnemonic: "STY",
		mode: "zpx",
	},

	{
		opcode: 0x95,
		mnemonic: "STA",
		mode: "zpx",
	},

	{
		opcode: 0x96,
		mnemonic: "STX",
		mode: "zpy",
	},

	{
		opcode: 0x98,
		mnemonic: "TYA",
		mode: "imp",
	},

	{
		opcode: 0x99,
		mnemonic: "STA",
		mode: "aby",
	},

	{
		opcode: 0x9a,
		mnemonic: "TXS",
		mode: "imp",
	},

	{
		opcode: 0x9d,
		mnemonic: "STA",
		mode: "abx",
	},

	{
		opcode: 0xa0,
		mnemonic: "LDY",
		mode: "imm",
	},

	{
		opcode: 0xa1,
		mnemonic: "LDA",
		mode: "inx",
	},

	{
		opcode: 0xa2,
		mnemonic: "LDX",
		mode: "imm",
	},

	{
		opcode: 0xa4,
		mnemonic: "LDY",
		mode: "zpg",
	},

	{
		opcode: 0xa5,
		mnemonic: "LDA",
		mode: "zpg",
	},

	{
		opcode: 0xa6,
		mnemonic: "LDX",
		mode: "zpg",
	},

	{
		opcode: 0xa8,
		mnemonic: "TAY",
		mode: "imp",
	},

	{
		opcode: 0xa9,
		mnemonic: "LDA",
		mode: "imm",
	},

	{
		opcode: 0xaa,
		mnemonic: "TAX",
		mode: "imp",
	},

	{
		opcode: 0xac,
		mnemonic: "LDY",
		mode: "abs",
	},

	{
		opcode: 0xad,
		mnemonic: "LDA",
		mode: "abs",
	},

	{
		opcode: 0xae,
		mnemonic: "LDX",
		mode: "abs",
	},

	{
		opcode: 0xb0,
		mnemonic: "BCS",
		mode: "rel",
	},

	{
		opcode: 0xb1,
		mnemonic: "LDA",
		mode: "iny",
	},

	{
		opcode: 0xb4,
		mnemonic: "LDY",
		mode: "zpx",
	},

	{
		opcode: 0xb5,
		mnemonic: "LDA",
		mode: "zpx",
	},

	{
		opcode: 0xb6,
		mnemonic: "LDX",
		mode: "zpy",
	},

	{
		opcode: 0xb8,
		mnemonic: "CLV",
		mode: "imp",
	},

	{
		opcode: 0xb9,
		mnemonic: "LDA",
		mode: "aby",
	},

	{
		opcode: 0xba,
		mnemonic: "TSX",
		mode: "imp",
	},

	{
		opcode: 0xbc,
		mnemonic: "LDY",
		mode: "abx",
	},

	{
		opcode: 0xbd,
		mnemonic: "LDA",
		mode: "abx",
	},

	{
		opcode: 0xbe,
		mnemonic: "LDX",
		mode: "aby",
	},

	{
		opcode: 0xc0,
		mnemonic: "CPY",
		mode: "imm",
	},

	{
		opcode: 0xc1,
		mnemonic: "CMP",
		mode: "inx",
	},

	{
		opcode: 0xc4,
		mnemonic: "CPY",
		mode: "zpg",
	},

	{
		opcode: 0xc5,
		mnemonic: "CMP",
		mode: "zpg",
	},

	{
		opcode: 0xc6,
		mnemonic: "DEC",
		mode: "zpg",
	},

	{
		opcode: 0xc8,
		mnemonic: "INY",
		mode: "imp",
	},

	{
		opcode: 0xc9,
		mnemonic: "CMP",
		mode: "imm",
	},

	{
		opcode: 0xca,
		mnemonic: "DEX",
		mode: "imp",
	},

	{
		opcode: 0xcc,
		mnemonic: "CPY",
		mode: "abs",
	},

	{
		opcode: 0xcd,
		mnemonic: "CMP",
		mode: "abs",
	},

	{
		opcode: 0xce,
		mnemonic: "DEC",
		mode: "abs",
	},

	{
		opcode: 0xd0,
		mnemonic: "BNE",
		mode: "rel",
	},

	{
		opcode: 0xd1,
		mnemonic: "CMP",
		mode: "iny",
	},

	{
		opcode: 0xd5,
		mnemonic: "CMP",
		mode: "zpx",
	},

	{
		opcode: 0xd6,
		mnemonic: "DEC",
		mode: "zpx",
	},

	{
		opcode: 0xd8,
		mnemonic: "CLD",
		mode: "imp",
	},

	{
		opcode: 0xd9,
		mnemonic: "CMP",
		mode: "aby",
	},

	{
		opcode: 0xdd,
		mnemonic: "CMP",
		mode: "abx",
	},

	{
		opcode: 0xde,
		mnemonic: "DEC",
		mode: "abx",
	},

	{
		opcode: 0xe0,
		mnemonic: "CPX",
		mode: "imm",
	},

	{
		opcode: 0xe1,
		mnemonic: "SBC",
		mode: "inx",
	},

	{
		opcode: 0xe4,
		mnemonic: "CPX",
		mode: "zpg",
	},

	{
		opcode: 0xe5,
		mnemonic: "SBC",
		mode: "zpg",
	},

	{
		opcode: 0xe6,
		mnemonic: "INC",
		mode: "zpg",
	},

	{
		opcode: 0xe8,
		mnemonic: "INX",
		mode: "imp",
	},

	{
		opcode: 0xe9,
		mnemonic: "SBC",
		mode: "imm",
	},

	{
		opcode: 0xea,
		mnemonic: "NOP",
		mode: "imp",
	},

	{
		opcode: 0xec,
		mnemonic: "CPX",
		mode: "abs",
	},

	{
		opcode: 0xed,
		mnemonic: "SBC",
		mode: "abs",
	},

	{
		opcode: 0xee,
		mnemonic: "INC",
		mode: "abs",
	},

	{
		opcode: 0xf0,
		mnemonic: "BEQ",
		mode: "rel",
	},

	{
		opcode: 0xf1,
		mnemonic: "SBC",
		mode: "iny",
	},

	{
		opcode: 0xf5,
		mnemonic: "SBC",
		mode: "zpx",
	},

	{
		opcode: 0xf6,
		mnemonic: "INC",
		mode: "zpx",
	},

	{
		opcode: 0xf8,
		mnemonic: "SED",
		mode: "imp",
	},

	{
		opcode: 0xf9,
		mnemonic: "SBC",
		mode: "aby",
	},

	{
		opcode: 0xfd,
		mnemonic: "SBC",
		mode: "abx",
	},

	{
		opcode: 0xfe,
		mnemonic: "INC",
		mode: "abx",
	},
];
