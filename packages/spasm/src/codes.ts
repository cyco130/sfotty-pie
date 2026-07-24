/**
 * The diagnostic code registry. Every diagnostic carries one of these codes
 * (`Message.code`), printed tsc-style in the formatted output
 * (`error SP2001: ...`) - a stable, searchable identity that survives message
 * rewording, and the hook for a future error-reference page and LSP
 * diagnostics.
 *
 * Codes are append-only: never renumber or reuse one. The numbering is
 * loosely grouped for the reader's benefit (1xxx lexing/parsing, 2xxx
 * symbols/values/evaluation, 3xxx encoding/layout/segments, 4xxx macros,
 * 5xxx modules) but the grouping carries no meaning - match on the code, not
 * the range.
 */
export const Codes = {
	// 1xxx - lexing and parsing
	Expected: "SP1001",
	StrayConditionalKeyword: "SP1002",
	UnknownEscape: "SP1003",

	// 2xxx - symbols, values, and evaluation
	UndefinedSymbol: "SP2001",
	AlreadyDefined: "SP2002",
	AlreadyExported: "SP2003",
	ExportNeverDefined: "SP2004",
	NotAFunction: "SP2005",
	FunctionArity: "SP2006",
	ApplicationTooDeep: "SP2007",
	ExpectedNumber: "SP2008",
	DivisionByZero: "SP2009",
	NegativeShift: "SP2010",
	CharacterNotSingleByte: "SP2011",
	ScopeResolutionOnValue: "SP2012",
	AttributesNeedsMember: "SP2013",
	UnknownAttributeKey: "SP2014",
	OnlyLabelsHaveAttributes: "SP2015",
	AttributesArgument: "SP2016",
	DictionaryPosition: "SP2017",
	DictionaryIsAValue: "SP2018",
	SizeRequiresNumber: "SP2019",
	SizeNegative: "SP2020",
	SizeAlreadySet: "SP2021",
	FunctionAsData: "SP2022",
	OnlyDefinitionExportable: "SP2023",

	// 3xxx - encoding, layout, and segments
	UnknownMnemonic: "SP3001",
	TooManyOperands: "SP3002",
	NoSuchAddressingMode: "SP3003",
	ByteOutOfRange: "SP3004",
	WordOutOfRange: "SP3005",
	BranchOutOfRange: "SP3006",
	OperandType: "SP3007",
	OrgRequiresNumber: "SP3008",
	ResRequiresNumber: "SP3009",
	ResOverflow: "SP3010",
	UnknownSegment: "SP3011",
	CircularPlacement: "SP3012",
	PlacedMoreThanOnce: "SP3013",
	NeverPlaced: "SP3014",
	DiscardedButPlaced: "SP3015",
	AlreadyDiscarded: "SP3016",
	EmplacedContent: "SP3017",
	EmitInsideEmplaced: "SP3018",
	StringInWord: "SP3019",
	IfConditionType: "SP3020",
	ErrorMessageType: "SP3021",
	UserError: "SP3022",
	DidNotConverge: "SP3023",

	// 4xxx - macros
	MacroAlreadyDefined: "SP4001",
	UnknownMacro: "SP4002",
	MacroArity: "SP4003",
	OutArgumentShape: "SP4004",
	OutNeverDefined: "SP4005",
	ParamNeedsOut: "SP4006",
	ParamDefinedInArm: "SP4007",
	ExpansionTooDeep: "SP4008",
	DirectiveInMacroBody: "SP4009",
	DirectiveInIfArm: "SP4010",
	ShapedArgumentInExpression: "SP4011",
	ArgumentMustBeIdentifier: "SP4012",
	UndefinedInMacroBody: "SP4013",

	// 5xxx - modules
	ImportCycle: "SP5001",
	ModuleReadFailed: "SP5002",
	ModuleResolveFailed: "SP5003",
} as const;

/** One of the `Codes` values ("SP1001", ...). */
export type Code = (typeof Codes)[keyof typeof Codes];
