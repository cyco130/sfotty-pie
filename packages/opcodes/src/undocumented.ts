import type { Opcode } from "./types";

export const UNDOCUMENTED_OPCODES: Opcode[] = [
	{
		opcode: 0x02,
		mnemonic: "CIM",
		altMnemonics: ["KIL", "JAM", "HLT"],
		mode: "imp",
	},

	{
		opcode: 0x03,
		mnemonic: "SLO",
		mode: "inx",
	},

	{
		opcode: 0x04,
		mnemonic: "NOP",
		altMnemonics: ["DOP", "SKB"],
		mode: "zpg",
	},

	{
		opcode: 0x07,
		mnemonic: "SLO",
		mode: "zpg",
	},

	{
		opcode: 0x0b,
		mnemonic: "ANC",
		altMnemonics: ["AAC"],
		mode: "imm",
	},

	{
		opcode: 0x0c,
		mnemonic: "NOP",
		altMnemonics: ["TOP", "SKW"],
		mode: "abs",
	},

	{
		opcode: 0x0f,
		mnemonic: "SLO",
		mode: "abs",
	},

	{
		opcode: 0x12,
		mnemonic: "CIM",
		altMnemonics: ["KIL", "JAM", "HLT"],
		mode: "imp",
	},

	{
		opcode: 0x13,
		mnemonic: "SLO",
		mode: "iny",
	},

	{
		opcode: 0x14,
		mnemonic: "NOP",
		altMnemonics: ["DOP", "SKB"],
		mode: "zpx",
	},

	{
		opcode: 0x17,
		mnemonic: "SLO",
		mode: "zpx",
	},

	{
		opcode: 0x1a,
		mnemonic: "NOP",
		mode: "imp",
	},

	{
		opcode: 0x1b,
		mnemonic: "SLO",
		mode: "aby",
	},

	{
		opcode: 0x1c,
		mnemonic: "NOP",
		altMnemonics: ["TOP", "SKW"],
		mode: "abx",
	},

	{
		opcode: 0x1f,
		mnemonic: "SLO",
		mode: "abx",
	},

	{
		opcode: 0x22,
		mnemonic: "CIM",
		altMnemonics: ["KIL", "JAM", "HLT"],
		mode: "imp",
	},

	{
		opcode: 0x23,
		mnemonic: "RLA",
		mode: "inx",
	},

	{
		opcode: 0x27,
		mnemonic: "RLA",
		mode: "zpg",
	},

	{
		opcode: 0x2b,
		mnemonic: "ANC",
		altMnemonics: ["AAC"],
		mode: "imm",
	},

	{
		opcode: 0x2f,
		mnemonic: "RLA",
		mode: "abs",
	},

	{
		opcode: 0x32,
		mnemonic: "CIM",
		altMnemonics: ["KIL", "JAM", "HLT"],
		mode: "imp",
	},

	{
		opcode: 0x33,
		mnemonic: "RLA",
		mode: "iny",
	},

	{
		opcode: 0x34,
		mnemonic: "NOP",
		altMnemonics: ["DOP", "SKB"],
		mode: "zpx",
	},

	{
		opcode: 0x37,
		mnemonic: "RLA",
		mode: "zpx",
	},

	{
		opcode: 0x3a,
		mnemonic: "NOP",
		mode: "imp",
	},

	{
		opcode: 0x3b,
		mnemonic: "RLA",
		mode: "aby",
	},

	{
		opcode: 0x3c,
		mnemonic: "NOP",
		altMnemonics: ["TOP", "SKW"],
		mode: "abx",
	},

	{
		opcode: 0x3f,
		mnemonic: "RLA",
		mode: "abx",
	},

	{
		opcode: 0x42,
		mnemonic: "CIM",
		altMnemonics: ["KIL", "JAM", "HLT"],
		mode: "imp",
	},

	{
		opcode: 0x43,
		mnemonic: "SRE",
		mode: "inx",
	},

	{
		opcode: 0x44,
		mnemonic: "NOP",
		altMnemonics: ["DOP", "SKB"],
		mode: "zpg",
	},

	{
		opcode: 0x47,
		mnemonic: "SRE",
		mode: "zpg",
	},

	{
		opcode: 0x4b,
		mnemonic: "ASR",
		altMnemonics: ["ALR"],
		mode: "imm",
	},

	{
		opcode: 0x4f,
		mnemonic: "SRE",
		mode: "abs",
	},

	{
		opcode: 0x52,
		mnemonic: "CIM",
		altMnemonics: ["KIL", "JAM", "HLT"],
		mode: "imp",
	},

	{
		opcode: 0x53,
		mnemonic: "SRE",
		mode: "iny",
	},

	{
		opcode: 0x54,
		mnemonic: "NOP",
		altMnemonics: ["DOP", "SKB"],
		mode: "zpx",
	},

	{
		opcode: 0x57,
		mnemonic: "SRE",
		mode: "zpx",
	},

	{
		opcode: 0x5a,
		mnemonic: "NOP",
		mode: "imp",
	},

	{
		opcode: 0x5b,
		mnemonic: "SRE",
		mode: "aby",
	},

	{
		opcode: 0x5c,
		mnemonic: "NOP",
		altMnemonics: ["TOP", "SKW"],
		mode: "abx",
	},

	{
		opcode: 0x5f,
		mnemonic: "SRE",
		mode: "abx",
	},

	{
		opcode: 0x62,
		mnemonic: "CIM",
		altMnemonics: ["KIL", "JAM", "HLT"],
		mode: "imp",
	},

	{
		opcode: 0x63,
		mnemonic: "RRA",
		mode: "inx",
	},

	{
		opcode: 0x64,
		mnemonic: "NOP",
		altMnemonics: ["DOP", "SKB"],
		mode: "zpg",
	},

	{
		opcode: 0x67,
		mnemonic: "RRA",
		mode: "zpg",
	},

	{
		opcode: 0x6b,
		mnemonic: "ARR",
		mode: "imm",
	},

	{
		opcode: 0x6f,
		mnemonic: "RRA",
		mode: "abs",
	},

	{
		opcode: 0x72,
		mnemonic: "CIM",
		altMnemonics: ["KIL", "JAM", "HLT"],
		mode: "imp",
	},

	{
		opcode: 0x73,
		mnemonic: "RRA",
		mode: "iny",
	},

	{
		opcode: 0x74,
		mnemonic: "NOP",
		altMnemonics: ["DOP", "SKB"],
		mode: "zpx",
	},

	{
		opcode: 0x77,
		mnemonic: "RRA",
		mode: "zpx",
	},

	{
		opcode: 0x7a,
		mnemonic: "NOP",
		mode: "imp",
	},

	{
		opcode: 0x7b,
		mnemonic: "RRA",
		mode: "aby",
	},

	{
		opcode: 0x7c,
		mnemonic: "NOP",
		altMnemonics: ["TOP", "SKW"],
		mode: "abx",
	},

	{
		opcode: 0x7f,
		mnemonic: "RRA",
		mode: "abx",
	},

	{
		opcode: 0x80,
		mnemonic: "NOP",
		altMnemonics: ["DOP", "SKB"],
		mode: "imm",
	},

	{
		opcode: 0x82,
		mnemonic: "NOP",
		altMnemonics: ["DOP", "SKB"],
		mode: "imm",
	},

	{
		opcode: 0x83,
		mnemonic: "SAX",
		mode: "inx",
	},

	{
		opcode: 0x87,
		mnemonic: "SAX",
		mode: "zpg",
	},

	{
		opcode: 0x89,
		mnemonic: "NOP",
		altMnemonics: ["DOP", "SKB"],
		mode: "imm",
	},

	{
		opcode: 0x8b,
		mnemonic: "ANE",
		mode: "imm",
	},

	{
		opcode: 0x8f,
		mnemonic: "SAX",
		mode: "abs",
	},

	{
		opcode: 0x92,
		mnemonic: "CIM",
		altMnemonics: ["KIL", "JAM", "HLT"],
		mode: "imp",
	},

	{
		opcode: 0x93,
		mnemonic: "SHA",
		mode: "iny",
	},

	{
		opcode: 0x97,
		mnemonic: "SAX",
		mode: "zpy",
	},

	{
		opcode: 0x9b,
		mnemonic: "SHS",
		mode: "aby",
	},

	{
		opcode: 0x9c,
		mnemonic: "SHY",
		mode: "abx",
	},

	{
		opcode: 0x9e,
		mnemonic: "SHX",
		mode: "aby",
	},

	{
		opcode: 0x9f,
		mnemonic: "SHA",
		mode: "aby",
	},

	{
		opcode: 0xa3,
		mnemonic: "LAX",
		mode: "iny",
	},

	{
		opcode: 0xa7,
		mnemonic: "LAX",
		mode: "zpg",
	},

	{
		opcode: 0xab,
		mnemonic: "LXA",
		altMnemonics: ["ANX", "ATX", "OAL"],
		mode: "imm",
	},

	{
		opcode: 0xaf,
		mnemonic: "LAX",
		mode: "abs",
	},

	{
		opcode: 0xb2,
		mnemonic: "CIM",
		altMnemonics: ["KIL", "JAM", "HLT"],
		mode: "imp",
	},

	{
		opcode: 0xb3,
		mnemonic: "LAX",
		mode: "iny",
	},

	{
		opcode: 0xb7,
		mnemonic: "LAX",
		mode: "zpy",
	},

	{
		opcode: 0xbb,
		mnemonic: "LAS",
		altMnemonics: ["LAR", "LAE"],
		mode: "aby",
	},

	{
		opcode: 0xbf,
		mnemonic: "LAX",
		mode: "abx",
	},

	{
		opcode: 0xc2,
		mnemonic: "NOP",
		altMnemonics: ["DOP", "SKB"],
		mode: "imm",
	},

	{
		opcode: 0xc3,
		mnemonic: "DCP",
		altMnemonics: ["DCM"],
		mode: "inx",
	},

	{
		opcode: 0xc7,
		mnemonic: "DCP",
		altMnemonics: ["DCM"],
		mode: "zpg",
	},

	{
		opcode: 0xcb,
		mnemonic: "SBX",
		mode: "imm",
	},

	{
		opcode: 0xcf,
		mnemonic: "DCP",
		altMnemonics: ["DCM"],
		mode: "abs",
	},

	{
		opcode: 0xd2,
		mnemonic: "CIM",
		altMnemonics: ["KIL", "JAM", "HLT"],
		mode: "imp",
	},

	{
		opcode: 0xd3,
		mnemonic: "DCP",
		altMnemonics: ["DCM"],
		mode: "iny",
	},

	{
		opcode: 0xd4,
		mnemonic: "NOP",
		altMnemonics: ["DOP", "SKB"],
		mode: "zpx",
	},

	{
		opcode: 0xd7,
		mnemonic: "DCP",
		altMnemonics: ["DCM"],
		mode: "zpx",
	},

	{
		opcode: 0xda,
		mnemonic: "NOP",
		mode: "imp",
	},

	{
		opcode: 0xdb,
		mnemonic: "DCP",
		altMnemonics: ["DCM"],
		mode: "aby",
	},

	{
		opcode: 0xdc,
		mnemonic: "NOP",
		altMnemonics: ["TOP", "SKW"],
		mode: "abx",
	},

	{
		opcode: 0xdf,
		mnemonic: "DCP",
		altMnemonics: ["DCM"],
		mode: "abx",
	},

	{
		opcode: 0xe2,
		mnemonic: "NOP",
		altMnemonics: ["DOP", "SKB"],
		mode: "imm",
	},

	{
		opcode: 0xe4,
		mnemonic: "ISB",
		altMnemonics: ["INS", "ISC"],
		mode: "inx",
	},

	{
		opcode: 0xe7,
		mnemonic: "ISB",
		altMnemonics: ["INS", "ISC"],
		mode: "zpg",
	},

	{
		opcode: 0xeb,
		mnemonic: "SBC",
		mode: "imm",
	},

	{
		opcode: 0xef,
		mnemonic: "ISB",
		altMnemonics: ["INS", "ISC"],
		mode: "abs",
	},

	{
		opcode: 0xf2,
		mnemonic: "CIM",
		altMnemonics: ["KIL", "JAM", "HLT"],
		mode: "imp",
	},

	{
		opcode: 0xf3,
		mnemonic: "ISB",
		altMnemonics: ["INS", "ISC"],
		mode: "iny",
	},

	{
		opcode: 0xf4,
		mnemonic: "NOP",
		altMnemonics: ["DOP", "SKB"],
		mode: "zpx",
	},

	{
		opcode: 0xf7,
		mnemonic: "ISB",
		altMnemonics: ["INS", "ISC"],
		mode: "zpx",
	},

	{
		opcode: 0xfa,
		mnemonic: "NOP",
		mode: "imp",
	},

	{
		opcode: 0xfb,
		mnemonic: "ISB",
		altMnemonics: ["INS", "ISC"],
		mode: "aby",
	},

	{
		opcode: 0xfc,
		mnemonic: "NOP",
		altMnemonics: ["TOP", "SKW"],
		mode: "abx",
	},

	{
		opcode: 0xff,
		mnemonic: "ISB",
		altMnemonics: ["INS", "IS"],
		mode: "abx",
	},
];
