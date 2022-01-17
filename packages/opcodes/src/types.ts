export interface Opcode {
	opcode: number;
	mnemonic: string;
	altMnemonics?: string[];
	mode:
		| "imp" // Implied
		| "acc" // Accumulator
		| "imm" // #Immediate
		| "abs" // Absolute
		| "abx" // Absolute,X
		| "aby" // Absolute,Y
		| "ind" // (Indirect)
		| "inx" // (Indirect,X)
		| "iny" // (Indirect),Y
		| "rel" // Relative
		| "zpg" // Zero Page
		| "zpx" // Zero Page,X
		| "zpy"; // Zero Page,Y
}
