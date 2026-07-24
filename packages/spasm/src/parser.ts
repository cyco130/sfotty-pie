import { Codes } from "./codes.ts";
import {
	DOT_KEYWORDS,
	Lexer,
	type SkippedToken,
	type Token,
	type TokenType,
} from "./lexer.ts";
import { SourceFile } from "./source-file.ts";
import { impossible } from "./utils.ts";

export function parse(sourceFile: SourceFile): ParsedModule {
	return new Parser(sourceFile).parse();
}

class Parser {
	constructor(sourceFile: SourceFile) {
		this.#sourceFile = sourceFile;
		this.#lexer = new Lexer(sourceFile.source);

		this.#lookahead = this.#screen();
		this.#consume();

		this.#errors = [];
	}

	parse(): ParsedModule {
		const module = this.#module();
		return {
			sourceFile: this.#sourceFile,
			module,
			errors: this.#errors,
		};
	}

	#module(): Module {
		const statements: Statement[] = [];

		while (this.#token.type !== "eof") {
			try {
				statements.push(this.#statement());
			} catch (error) {
				if (!(error instanceof ParseError)) {
					throw error;
				}

				this.#errors.push(error);

				// Try to recover by ignoring everything until newline or EOF.
				// The cast defeats TS narrowing `#token.type` to exclude "eof" (from
				// the outer `while (... !== "eof")`); recovery can reach eof at a final
				// statement with no trailing newline.
				while (
					this.#token.type !== "newline" &&
					(this.#token.type as TokenType) !== "eof"
				) {
					this.#consume();
				}

				if (this.#token.type === "newline") {
					this.#consume();
				}
			}
		}

		return {
			type: "module",
			statements,
			eof: this.#token,
		};
	}

	#statement(): Statement {
		const labels: Label[] = [];

		while (this.#token.type === "identifier" && this.#lookahead.type === ":") {
			labels.push({
				type: "label",
				identifier: this.#token,
				colonToken: this.#lookahead,
			});

			this.#consume();
			this.#consume();
		}

		const content = this.#statementContent();

		// Newline after any other statement is mandatory
		const possibleNewline = this.#expect("newline", "eof");
		const newline = possibleNewline.type === "newline" ? possibleNewline : null;

		// TODO: Report labels on unlabelable statements
		return {
			type: "statement",
			labels,
			content,
			newline,
		};
	}

	#statementContent(): StatementContent | null {
		const token = this.#token;

		switch (token.type) {
			case "identifier": {
				const identifier = token;
				this.#consume();

				// `NAME(params) = expr` - an expression macro (a function-valued
				// symbol). Speculative: `(` after an identifier in statement
				// position is usually a macro-call operand (`mva (src),y`), so on
				// any shape mismatch we back up and reparse as an instruction.
				if (this.#token.type === "(") {
					const saved = this.#save();
					const fn = this.#tryFunctionParams();
					if (fn) {
						return this.#finishAssignment(
							identifier,
							fn.operatorToken,
							fn.params,
						);
					}
					this.#restore(saved);
				}

				// `=` defines a constant, `:=` defines a label (an address).
				const operator = this.#token;
				if (operator.type === "=" || operator.type === ":=") {
					this.#consume();
					// `name = .import "m"` - a namespaced import: the module's
					// export dict binds to `name`.
					if (operator.type === "=" && this.#token.type === "import") {
						const importToken = this.#token;
						this.#consume();
						return {
							type: "import",
							importToken,
							specToken: this.#expect("string"),
							binding: identifier,
						};
					}
					return this.#finishAssignment(identifier, operator, null);
				}

				// `ns::name args` - a namespaced macro call (no opcode has a path).
				if (operator.type === "::") {
					const memberTokens: Token<"identifier">[] = [];
					while (this.#token.type === "::") {
						this.#consume();
						memberTokens.push(this.#expect("identifier"));
					}
					return { ...this.#instruction(identifier), memberTokens };
				}

				return this.#instruction(identifier);
			}

			case "org": {
				const org = token;
				this.#consume();
				const expression = this.#expression(1);
				return {
					type: "org",
					org,
					expression,
				};
			}

			case "byte": {
				this.#consume();

				return {
					type: "byte",
					byteToken: token,
					list: this.#expressionList(),
				};
			}

			case "word": {
				this.#consume();

				return {
					type: "word",
					wordToken: token,
					list: this.#expressionList(),
				};
			}

			case "define_segment": {
				this.#consume();
				return {
					type: "define-segment",
					defineSegmentToken: token,
					nameToken: this.#expect("string"),
				};
			}

			case "segment": {
				this.#consume();
				return {
					type: "segment",
					segmentToken: token,
					nameToken: this.#expect("string"),
				};
			}

			case "emit": {
				this.#consume();
				return {
					type: "emit",
					emitToken: token,
					nameToken: this.#expect("string"),
				};
			}

			case "emplace": {
				this.#consume();
				return {
					type: "emplace",
					emplaceToken: token,
					nameToken: this.#expect("string"),
				};
			}

			case "discard": {
				this.#consume();
				return {
					type: "discard",
					discardToken: token,
					nameToken: this.#expect("string"),
				};
			}

			case "import": {
				this.#consume();
				return {
					type: "import",
					importToken: token,
					specToken: this.#expect("string"),
					binding: null,
				};
			}

			case "export": {
				this.#consume();
				if (this.#token.type === "identifier") {
					// `.export name:` defines a label here AND exports it;
					// `.export name` exports a definition made elsewhere (a name
					// may be exported only once - checked at assemble). `.export
					// name = ...` / `name := ...` / `name(...) = ...` still parse
					// as exported definitions below.
					if (this.#lookahead.type === ":") {
						const nameToken = this.#token;
						this.#consume();
						this.#consume();
						return {
							type: "export",
							exportToken: token,
							content: null,
							nameToken,
							definesLabel: true,
						};
					}
					if (
						this.#lookahead.type !== "=" &&
						this.#lookahead.type !== ":=" &&
						this.#lookahead.type !== "("
					) {
						const nameToken = this.#token;
						this.#consume();
						return {
							type: "export",
							exportToken: token,
							content: null,
							nameToken,
						};
					}
				}
				const content = this.#statementContent();
				if (!content) {
					throw new ParseError(this.#token, ["a definition to export"]);
				}
				return { type: "export", exportToken: token, content };
			}

			case "res": {
				this.#consume();
				return { type: "res", resToken: token, count: this.#expression(1) };
			}

			case "code":
			case "rodata":
			case "data":
			case "bss":
			case "zeropage": {
				this.#consume();
				return { type: "segment-shorthand", keyword: token };
			}

			case "if":
				return this.#ifBlock(token);

			case "error": {
				this.#consume();
				return {
					type: "error-directive",
					errorToken: token,
					message: this.#expression(1),
				};
			}

			// An arm/end keyword only appears inside `#ifBlock`'s body loop; in
			// statement position it's stray (or carries a label, which arms and
			// `.endif` can't).
			case "elseif":
			case "else":
			case "endif": {
				const error = new ParseError(token, ["a statement"]);
				error.code = Codes.StrayConditionalKeyword;
				error.message = `\`.${token.type}\` without a matching \`.if\``;
				throw error;
			}

			case "macro": {
				this.#consume();
				const nameToken = this.#expect("identifier");
				const params: MacroParam[] = [];
				while (
					this.#token.type === "identifier" ||
					this.#token.type === "out"
				) {
					let outToken: Token<"out"> | null = null;
					if (this.#token.type === "out") {
						outToken = this.#token;
						this.#consume();
					}
					params.push({ outToken, nameToken: this.#expect("identifier") });
					// Separating commas are optional, matching the call site.
					if ((this.#token.type as TokenType) === ",") this.#consume();
				}
				this.#expect("newline");
				const body: Statement[] = [];
				while (
					this.#token.type !== "endmacro" &&
					(this.#token.type as TokenType) !== "eof"
				) {
					body.push(this.#statement());
				}
				this.#expect("endmacro");
				return { type: "macro", macroToken: token, nameToken, params, body };
			}
		}

		return null;
	}

	// `.if cond ... [.elseif cond ...]* [.else ...] .endif` - a conditional
	// block. Arms hold ordinary statements; nested `.if`s consume their own
	// `.endif` recursively via `#statement`.
	#ifBlock(ifToken: Token<"if">): IfBlock {
		this.#consume();
		const arms: IfArm[] = [];
		let arm: IfArm = {
			keyword: ifToken,
			condition: this.#expression(1),
			body: [],
		};
		this.#expect("newline");

		for (;;) {
			const token = this.#token;
			switch (token.type) {
				case "elseif": {
					if (arm.condition === null) {
						throw new ParseError(token, ['".endif" (".else" is final)']);
					}
					arms.push(arm);
					this.#consume();
					arm = { keyword: token, condition: this.#expression(1), body: [] };
					this.#expect("newline");
					break;
				}
				case "else": {
					if (arm.condition === null) {
						throw new ParseError(token, ['".endif" (".else" is final)']);
					}
					arms.push(arm);
					this.#consume();
					arm = { keyword: token, condition: null, body: [] };
					this.#expect("newline");
					break;
				}
				case "endif": {
					arms.push(arm);
					this.#consume();
					return { type: "if-block", arms, endifToken: token };
				}
				case "eof":
					throw new ParseError(token, ['".endif"']);
				default:
					arm.body.push(this.#statement());
			}
		}
	}

	// Operands are comma-separated. A comma followed by a register name binds
	// to the preceding operand as its indexed suffix (registers are reserved
	// words, so this is unambiguous - `#operand` consumes those commas itself);
	// any other comma separates operands. Real mnemonics take at most one
	// operand (the encoder enforces arity); macro calls take any number.
	#instruction(identifier: Token<"identifier">): Instruction {
		const mnemonic = identifier;
		const operands: Operand[] = [];
		const first = this.#operand();
		if (first) {
			operands.push(first);
			while (this.#token.type === ",") {
				this.#consume();
				const next = this.#operand();
				if (!next) {
					throw new ParseError(this.#token, ["an operand"]);
				}
				operands.push(next);
			}
		}

		return {
			type: "instruction",
			mnemonic,
			operands,
		};
	}

	#operand(): Operand | null {
		const token = this.#token;
		switch (token.type) {
			case "newline":
			case "eof":
				return null;

			case "#": {
				const hashToken = token;
				this.#consume();
				const expression = this.#expression(1);
				return {
					type: "immediate-operand",
					hashToken,
					expression,
				};
			}

			case "a": {
				const accumulatorToken = token;
				this.#consume();
				return {
					type: "accumulator-operand",
					accumulatorToken,
				};
			}

			case "(":
				{
					const openingBracketToken = token;
					this.#consume();
					const expression = this.#expression(1);

					const possibleInsideComma = this.#token;
					if (possibleInsideComma.type === ",") {
						// Indexed-indirect operand "(expr, X)"
						const commaToken = possibleInsideComma;
						this.#consume();
						const register = this.#expect("x");
						const closingBracketToken = this.#expect(")");

						return {
							type: "indexed-indirect-operand",
							openingBracketToken,
							expression,
							commaToken,
							register,
							closingBracketToken,
						};
					}

					const closingBracketToken = this.#expect(")");

					// "(expr), Y" - indirect-indexed
					if (this.#token.type === "," && this.#lookahead.type === "y") {
						const commaToken = this.#token;
						this.#consume();
						const register = this.#expect("y");

						return {
							type: "indirect-indexed-operand",
							openingBracketToken,
							expression,
							closingBracketToken,
							commaToken,
							register,
						};
					}

					// Otherwise "(expr)" is a grouped expression. Extend it with any
					// infix tail; if nothing follows, the whole operand was "(expr)" and
					// it's indirect addressing. A tail (or a trailing ",X") makes it a
					// computed value instead - "(sym + 2) * 2" is absolute, not indirect.
					const grouped: GroupedExpression = {
						type: "grouped-expression",
						openingBracketToken,
						expression,
						closingBracketToken,
					};

					let head: Expression = grouped;
					for (;;) {
						const next = this.#expressionTail(1, head);
						if (!next) break;
						head = next;
					}

					if (
						this.#token.type === "," &&
						(this.#lookahead.type === "x" || this.#lookahead.type === "y")
					) {
						// "(expr), X" / "(expr) * 2, Y" - grouped value, indexed
						const commaToken = this.#token;
						this.#consume();
						const register = this.#expect("x", "y");

						return {
							type: "indexed-operand",
							expression: head,
							commaToken,
							register,
						};
					}

					if (head === grouped) {
						// Nothing followed "(expr)" - indirect addressing.
						return {
							type: "indirect-operand",
							openingBracketToken,
							expression,
							closingBracketToken,
						};
					}

					// Grouped expression with a tail - a computed value operand.
					return {
						type: "simple-operand",
						expression: head,
					};
				}
				break;

			default: {
				const expression = this.#expression(1);
				const possibleComma = this.#token;

				if (possibleComma.type === ",") {
					const commaToken = possibleComma;
					const possibleRegister = this.#lookahead;
					if (possibleRegister.type === "x" || possibleRegister.type === "y") {
						this.#consume();
						this.#consume();
						const register = possibleRegister;
						return {
							type: "indexed-operand",
							expression,
							commaToken,
							register,
						};
					}
				}

				return {
					type: "simple-operand",
					expression,
				};
			}
		}

		return null;
	}

	#expressionList(): [Expression, Token<",">?][] {
		const result: [Expression, Token<",">?][] = [];
		let head = this.#expression(1);

		for (;;) {
			let comma: Token<","> | undefined;
			if (this.#token.type === ",") {
				comma = this.#token;
				this.#consume();
			}
			result.push([head, comma]);
			const next = this.#maybeExpression(1);

			if (!next) break;

			head = next;
		}

		return result;
	}

	#expression(precedence: number): Expression {
		const expression = this.#maybeExpression(precedence);
		if (!expression) {
			throw new ParseError(this.#token, ["expression"]);
		}

		return expression;
	}

	#maybeExpression(precedence: number): Expression | null {
		let head = this.#expressionHead();
		if (!head) return null;

		for (;;) {
			const tail = this.#expressionTail(precedence, head);

			if (!tail) {
				break;
			}

			head = tail;
		}

		return head;
	}

	#expressionHead(): Expression | null {
		const token = this.#token;
		switch (token.type) {
			// Primary expressions. An identifier (or `::` path) hugging `(` is a
			// function application.
			case "identifier": {
				this.#consume();
				return this.#callTail(this.#memberTail(token));
			}
			case "decimal":
			case "hexadecimal":
			case "binary":
			case "string":
			case "character":
			case "*": {
				this.#consume();
				return this.#memberTail(token);
			}

			// Unary prefixes
			case "+":
			case "-":
			case "<":
			case ">":
			case "!":
			case "~": {
				const operator = token;
				this.#consume();
				const expression = this.#expression(100);

				return {
					type: "prefix-expression",
					operator,
					expression,
				};
			}

			// Builtin calls: a dot-keyword hugging `(` is the call meaning of the
			// parenthesis. `.attributes(X)` yields the symbol's attribute dict
			// (member-accessed with `::`); `.sizeof(X)` is its `size` shorthand.
			case "attributes":
			case "sizeof": {
				const keyword = token;
				this.#consume();
				const openingBracketToken = this.#expect("(");
				const argument = this.#expression(1);
				const closingBracketToken = this.#expect(")");
				return this.#memberTail({
					type: "builtin-call",
					keyword,
					openingBracketToken,
					argument,
					closingBracketToken,
				});
			}

			// Dictionary literal. `{` opens a context where newlines separate
			// entries like commas do (each nesting level handles its own), and
			// `key: value` uses the call-site association mark - a keyword-arg
			// list is a braceless dict literal.
			case "{": {
				const openingBraceToken = token;
				this.#consume();
				const entries: DictEntry[] = [];
				this.#skipNewlines();
				while (this.#token.type !== "}") {
					const key = this.#expect("identifier");
					const colonToken = this.#expect(":");
					const value = this.#expression(1);
					let commaToken: Token<","> | undefined;
					let separated = false;
					if (this.#token.type === ",") {
						commaToken = this.#token;
						this.#consume();
						separated = true;
					}
					if ((this.#token.type as TokenType) === "newline") {
						this.#skipNewlines();
						separated = true;
					}
					entries.push({ key, colonToken, value, commaToken });
					if (!separated && (this.#token.type as TokenType) !== "}") {
						throw new ParseError(this.#token, ['","', "newline", '"}"']);
					}
				}
				const closingBraceToken = this.#expect("}");
				return {
					type: "dict-literal",
					openingBraceToken,
					entries,
					closingBraceToken,
				};
			}

			// Grouping parentheses
			case "(": {
				const openingBracketToken = token;
				this.#consume();
				const expression = this.#expression(1);
				const closingBracketToken = this.#expect(")");

				return {
					type: "grouped-expression",
					openingBracketToken,
					expression,
					closingBracketToken,
				};
			}

			default:
				return null;
		}
	}

	// Apply any `::member` scope-resolution postfixes (tightest binding).
	// `callee(arg, ...)` - function application; chains for a call returning a
	// function.
	#callTail(callee: Expression): Expression {
		if (this.#token.type !== "(") return callee;
		const openingBracketToken = this.#token;
		this.#consume();
		const args: Expression[] = [];
		if ((this.#token.type as TokenType) !== ")") {
			for (;;) {
				args.push(this.#expression(1));
				if ((this.#token.type as TokenType) === ",") {
					this.#consume();
					continue;
				}
				break;
			}
		}
		const closingBracketToken = this.#expect(")");
		return this.#callTail({
			type: "call-expression",
			callee,
			openingBracketToken,
			args,
			closingBracketToken,
		});
	}

	#memberTail(object: Expression): Expression {
		let head = object;
		while (this.#token.type === "::") {
			const colonColonToken = this.#token;
			this.#consume();
			head = {
				type: "member-expression",
				object: head,
				colonColonToken,
				member: this.#expect("identifier"),
			};
		}
		return head;
	}

	#expressionTail(precedence: number, head: Expression): Expression | null {
		switch (this.#token.type) {
			// Left-associative infix operators, lowest to highest precedence:
			// || < && < comparison/equality < additive < multiplicative.
			case "||":
				return this.#infix(this.#token, precedence, 2, head);

			case "&&":
				return this.#infix(this.#token, precedence, 3, head);

			case "=":
			case "!=":
			case "<":
			case ">":
				return this.#infix(this.#token, precedence, 4, head);

			// `|` sits with the additive operators, `& ^ << >>` with the
			// multiplicative ones - the ca65 split.
			case "+":
			case "-":
			case "|":
				return this.#infix(this.#token, precedence, 5, head);

			case "*":
			case "/":
			case "%":
			case "^":
			case "&":
			case "<<":
			case ">>":
				return this.#infix(this.#token, precedence, 6, head);
		}

		return null;
	}

	#infix(
		operator: InfixExpression["operator"],
		precedence: number,
		operatorPrecedence: number,
		left: Expression,
	): InfixExpression | null {
		if (operatorPrecedence <= precedence) {
			return null;
		}

		this.#consume();

		const right = this.#expression(operatorPrecedence);

		return {
			type: "infix-expression",
			left,
			operator,
			right,
		};
	}

	#expect<T extends TokenType[]>(...types: T) {
		if (!types.includes(this.#token.type)) {
			throw new ParseError(
				this.#token,
				types.map((t) => (DOT_KEYWORDS.includes(t as any) ? `.${t}` : t)),
			);
		}

		return this.#consume() as Token<T[number]>;
	}

	#skipNewlines(): void {
		while (this.#token.type === "newline") this.#consume();
	}

	// Speculation support: snapshot/restore the lexer position and the two
	// buffered tokens, so a tentative parse can back out without side effects.
	#save(): { position: number; token: Token; lookahead: Token } {
		return {
			position: this.#lexer.position,
			token: this.#token,
			lookahead: this.#lookahead,
		};
	}

	#restore(state: { position: number; token: Token; lookahead: Token }): void {
		this.#lexer.position = state.position;
		this.#token = state.token;
		this.#lookahead = state.lookahead;
	}

	// At `(` after a statement-position identifier: try to read a function
	// parameter list followed by `=`. Returns null (without consuming the `=`
	// check's token) when the shape doesn't match - the caller restores.
	#tryFunctionParams(): {
		params: Token<"identifier">[];
		operatorToken: Token<"=">;
	} | null {
		this.#consume(); // the "("
		const params: Token<"identifier">[] = [];
		while (this.#token.type === "identifier") {
			params.push(this.#token);
			this.#consume();
			// Separating commas are optional, matching macro params.
			if ((this.#token.type as TokenType) === ",") this.#consume();
		}
		if ((this.#token.type as TokenType) !== ")") return null;
		this.#consume();
		if (this.#token.type !== "=") return null;
		const operatorToken = this.#token;
		this.#consume();
		return { params, operatorToken };
	}

	// The shared back half of a definition: RHS expression plus the attribute
	// tail (`, key: value, ...` - unambiguous, the RHS never consumes a
	// top-level comma).
	#finishAssignment(
		identifier: Token<"identifier">,
		operatorToken: Token<"=" | ":=">,
		params: Token<"identifier">[] | null,
	): Assignment {
		const expression = this.#expression(1);
		const attributes: Attribute[] = [];
		while (this.#token.type === ",") {
			this.#consume();
			const key = this.#expect("identifier");
			const colonToken = this.#expect(":");
			attributes.push({ key, colonToken, value: this.#expression(1) });
		}
		return {
			type: "assignment",
			identifier,
			operatorToken,
			expression,
			attributes,
			params,
		};
	}

	// Call the lexer, skipping whitespace tokens
	#screen(): Token {
		const skipped: SkippedToken[] = [];
		const prev = this.#token as Token | undefined;
		for (;;) {
			const token = this.#lexer.next();
			if (token.type !== "whitespace" && token.type !== "comment") {
				if (skipped.length) {
					token.before = skipped;
					if (prev) {
						prev.after = skipped;
					}
				}

				return token;
			}
			skipped.push(token);
		}
	}

	#consume(): Token {
		const consumed = this.#token;
		this.#token = this.#lookahead;
		this.#lookahead = this.#screen();

		return consumed;
	}

	#sourceFile: SourceFile;
	#lexer: Lexer;
	#token!: Token;
	#lookahead: Token;
	#errors: ParseError[] = [];
}

export interface ParsedModule {
	sourceFile: SourceFile;
	module: Module;
	errors: ParseError[];
}

/**
 * A secondary span attached to a `Message` - "previously defined here",
 * "imported here", and the like. Notes carry no notes of their own.
 */
export interface MessageNote {
	start: number;
	end: number;
	message: string;
	/** Module id the span refers into, for file:line:col attribution. */
	file?: string;
}

export interface Message {
	type: "error" | "warning" | "info";
	/** The diagnostic's stable code ("SP2001", ...) - see src/codes.ts. */
	code: string;
	start: number;
	end: number;
	message: string;
	/** Module id the span refers into, for file:line:col attribution. */
	file?: string;
	/** For symbol-related diagnostics (undefined symbol, ...): the qualified
	 * symbol name, machine-readable (dictionary paths NUL-joined). */
	symbol?: string;
	/** Related locations, rendered as `note:` lines after the message. */
	notes?: MessageNote[];
	/**
	 * Pre-rendered `file:line:col - type: message` + source excerpt with a
	 * squiggle marker, followed by one such block per note.
	 */
	formatted?: string;
	/** Like `formatted`, with ANSI colors - print when stderr is a tty. */
	formattedColor?: string;
}

export class ParseError implements Message {
	constructor(found: Token, expected: string[]) {
		let list: string;
		if (expected.length === 1) {
			list = expected[0]!;
		} else if (expected.length === 2) {
			list = expected.join(" or ");
		} else {
			const head = expected.slice(0, -1);
			const last = expected[expected.length - 1];
			list = `${head.join(", ")} or ${last}`;
		}

		const upper = list[0]?.toUpperCase();
		if (list[0] !== upper) {
			list = upper + list.slice(1);
		}

		this.message = `${list} expected`;
		this.start = found.start;
		this.end = found.end;
	}

	type = "error" as const;
	code: string = Codes.Expected;
	message: string;
	start: number;
	end: number;
	file?: string;
	formatted?: string;
}

export function getExpressionLocation(
	expression: Expression,
): [start: number, end: number] {
	switch (expression.type) {
		case "decimal":
		case "hexadecimal":
		case "binary":
		case "identifier":
		case "string":
		case "character":
		case "*":
			return [expression.start, expression.end];
		case "member-expression":
			return [
				getExpressionLocation(expression.object)[0],
				expression.member.end,
			];
		case "grouped-expression":
			return [
				expression.openingBracketToken.start,
				expression.closingBracketToken.end,
			];
		case "dict-literal":
			return [
				expression.openingBraceToken.start,
				expression.closingBraceToken.end,
			];
		case "builtin-call":
			return [expression.keyword.start, expression.closingBracketToken.end];
		case "call-expression":
			return [
				getExpressionLocation(expression.callee)[0],
				expression.closingBracketToken.end,
			];
		case "prefix-expression":
			return [
				expression.operator.start,
				getExpressionLocation(expression.expression)[1],
			];
		case "infix-expression":
			return [
				getExpressionLocation(expression.left)[0],
				getExpressionLocation(expression.right)[1],
			];
		default:
			impossible(expression);
	}
}

export function getOperandLocation(
	operand: Operand,
): [start: number, end: number] {
	switch (operand.type) {
		case "accumulator-operand":
			return [operand.accumulatorToken.start, operand.accumulatorToken.end];
		case "simple-operand":
			return getExpressionLocation(operand.expression);
		case "immediate-operand":
			return [
				operand.hashToken.start,
				getExpressionLocation(operand.expression)[1],
			];
		case "indexed-operand":
			return [
				getExpressionLocation(operand.expression)[0],
				operand.register.end,
			];
		case "indirect-operand":
			return [
				operand.openingBracketToken.start,
				operand.closingBracketToken.end,
			];
		case "indexed-indirect-operand":
			return [
				operand.openingBracketToken.start,
				operand.closingBracketToken.end,
			];
		case "indirect-indexed-operand":
			return [operand.openingBracketToken.start, operand.register.end];

		default:
			impossible(operand);
	}
}

export interface Module {
	type: "module";
	statements: Statement[];
	eof: Token<"eof">;
}

export interface Statement {
	type: "statement";
	labels: Label[];
	content: StatementContent | null;
	newline: Token<"newline"> | null;
}

export type StatementContent =
	| Instruction
	| Org
	| Byte
	| Word
	| Assignment
	| DefineSegment
	| Segment
	| Emit
	| Emplace
	| Discard
	| Import
	| Export
	| Res
	| SegmentShorthand
	| Macro
	| IfBlock
	| ErrorDirective;

/**
 * One arm of an `.if` block: the opening keyword, its condition (null for
 * `.else`), and the arm's statements. Names defined inside an arm are local
 * to it (see the arm-scoping pass in macros.ts).
 */
export interface IfArm {
	keyword: Token<"if" | "elseif" | "else">;
	condition: Expression | null;
	body: Statement[];
}

/**
 * `.if cond ... [.elseif cond ...]* [.else ...] .endif`. Arm selection is
 * re-decided every pass: the first arm whose condition is resolved and
 * nonzero wins; an unresolved condition is skipped, so everything falls to
 * `.else` until the conditions settle - write the `.else` arm as the
 * pessimistic (always-correct) form.
 */
export interface IfBlock {
	type: "if-block";
	arms: IfArm[];
	endifToken: Token<"endif">;
}

/** `.error expr` - report the (string) message when collected, on the
 * converged pass only. */
export interface ErrorDirective {
	type: "error-directive";
	errorToken: Token<"error">;
	message: Expression;
}

/** One `key: value` in a definition's attribute tail (`X := $0300, size: 2`). */
export interface Attribute {
	key: Token<"identifier">;
	colonToken: Token<":">;
	value: Expression;
}

export interface Assignment {
	type: "assignment";
	identifier: Token<"identifier">;
	operatorToken: Token<"=" | ":=">;
	expression: Expression;
	/** Placement attributes; only `:=` definitions may carry them. */
	attributes: Attribute[];
	/** Parameters of an expression macro (`DOUBLE(x) = 2 * x`); null for a
	 * plain definition. */
	params: Token<"identifier">[] | null;
}

export interface Label {
	type: "label";
	identifier: Token<"identifier">;
	colonToken: Token<":">;
}

export interface Instruction {
	type: "instruction";
	mnemonic: Token<"identifier">;
	/** Path segments of a namespaced macro call (`ns::m args`); real
	 * instructions never carry these. */
	memberTokens?: Token<"identifier">[];
	operands: Operand[];
}

export type Operand =
	| AccumulatorOperand
	| SimpleOperand
	| ImmediateOperand
	| IndexedOperand
	| IndirectOperand
	| IndexedIndirectOperand
	| IndirectIndexedOperand;

export interface AccumulatorOperand {
	type: "accumulator-operand";
	accumulatorToken: Token<"a">;
}

export interface SimpleOperand {
	type: "simple-operand";
	expression: Expression;
}

export interface ImmediateOperand {
	type: "immediate-operand";
	hashToken: Token<"#">;
	expression: Expression;
}

export interface IndexedOperand {
	type: "indexed-operand";
	expression: Expression;
	commaToken: Token<",">;
	register: Token<"x" | "y">;
}

export interface IndirectOperand {
	type: "indirect-operand";
	openingBracketToken: Token<"(">;
	expression: Expression;
	closingBracketToken: Token<")">;
}

export interface IndexedIndirectOperand {
	type: "indexed-indirect-operand";
	openingBracketToken: Token<"(">;
	expression: Expression;
	commaToken: Token<",">;
	register: Token<"x">;
	closingBracketToken: Token<")">;
}

export interface IndirectIndexedOperand {
	type: "indirect-indexed-operand";
	openingBracketToken: Token<"(">;
	expression: Expression;
	closingBracketToken: Token<")">;
	commaToken: Token<",">;
	register: Token<"y">;
}

export interface Org {
	type: "org";
	org: Token<"org">;
	expression: Expression;
}

export interface Byte {
	type: "byte";
	byteToken: Token<"byte">;
	list: [Expression, Token<",">?][];
}

export interface Word {
	type: "word";
	wordToken: Token<"word">;
	list: [Expression, Token<",">?][];
}

export interface DefineSegment {
	type: "define-segment";
	defineSegmentToken: Token<"define_segment">;
	nameToken: Token<"string">;
}

export interface Segment {
	type: "segment";
	segmentToken: Token<"segment">;
	nameToken: Token<"string">;
}

export interface Emit {
	type: "emit";
	emitToken: Token<"emit">;
	nameToken: Token<"string">;
}

export interface Emplace {
	type: "emplace";
	emplaceToken: Token<"emplace">;
	nameToken: Token<"string">;
}

/** `.discard "X"` - deliberately drop a segment (satisfies the every-segment-
 * is-consumed check without placing it). */
export interface Discard {
	type: "discard";
	discardToken: Token<"discard">;
	nameToken: Token<"string">;
}

export interface Import {
	type: "import";
	importToken: Token<"import">;
	specToken: Token<"string">;
	/** `name = .import "m"` binds the module's export dict; null = splat. */
	binding: Token<"identifier"> | null;
}

export interface Export {
	type: "export";
	exportToken: Token<"export">;
	/** The exported definition; null for the name forms below. */
	content: StatementContent | null;
	/** `.export name` (export an existing definition) or `.export name:`
	 * (define a label here and export it). */
	nameToken?: Token<"identifier">;
	definesLabel?: boolean;
}

export interface Res {
	type: "res";
	resToken: Token<"res">;
	count: Expression;
}

export interface SegmentShorthand {
	type: "segment-shorthand";
	keyword: Token<"code" | "rodata" | "data" | "bss" | "zeropage">;
}

/** A macro parameter; `.out` marks the outward channel (the caller's plain
 * identifier receives a definition made by the body). */
export interface MacroParam {
	outToken: Token<"out"> | null;
	nameToken: Token<"identifier">;
}

export interface Macro {
	type: "macro";
	macroToken: Token<"macro">;
	nameToken: Token<"identifier">;
	params: MacroParam[];
	body: Statement[];
}

export type Expression =
	| Token<"identifier">
	| Token<"string">
	| Token<"character">
	| Token<"*">
	| IntegerLiteral
	| GroupedExpression
	| PrefixExpression
	| InfixExpression
	| MemberExpression
	| DictLiteral
	| BuiltinCall
	| CallExpression;

/** Function application: `DOUBLE(2)`, `lib::DOUBLE(2)`. */
export interface CallExpression {
	type: "call-expression";
	callee: Expression;
	openingBracketToken: Token<"(">;
	args: Expression[];
	closingBracketToken: Token<")">;
}

/** `.attributes(X)` / `.sizeof(X)` - attribute-reading builtins. */
export interface BuiltinCall {
	type: "builtin-call";
	keyword: Token<"attributes" | "sizeof">;
	openingBracketToken: Token<"(">;
	argument: Expression;
	closingBracketToken: Token<")">;
}

export interface DictEntry {
	// Keys are ordinary identifiers - register names stay reserved here too,
	// because a future namespace-splat must be able to turn any key into a
	// bare symbol. Keys and scope names share one name grammar.
	key: Token<"identifier">;
	colonToken: Token<":">;
	value: Expression;
	commaToken?: Token<",">;
}

/**
 * `{ key: value, ... }` - a dictionary (namespace) literal. Only valid as the
 * whole right-hand side of a `=` definition; entries lower to qualified
 * symbols accessed with `::`.
 */
export interface DictLiteral {
	type: "dict-literal";
	openingBraceToken: Token<"{">;
	entries: DictEntry[];
	closingBraceToken: Token<"}">;
}

/** Dictionary access: `object::member`, e.g. `NOTES::C4` or nested paths. */
export interface MemberExpression {
	type: "member-expression";
	object: Expression;
	colonColonToken: Token<"::">;
	member: Token<"identifier">;
}

export type IntegerLiteral =
	| Token<"decimal">
	| Token<"hexadecimal">
	| Token<"binary">;

export interface GroupedExpression {
	type: "grouped-expression";
	openingBracketToken: Token<"(">;
	expression: Expression;
	closingBracketToken: Token<")">;
}

export interface PrefixExpression {
	type: "prefix-expression";
	operator: Token<"+" | "-" | "<" | ">" | "!" | "~">;
	expression: Expression;
}

export interface InfixExpression {
	type: "infix-expression";
	left: Expression;
	operator: Token<
		| "*"
		| "/"
		| "%"
		| "^"
		| "&"
		| "<<"
		| ">>"
		| "+"
		| "-"
		| "|"
		| "="
		| "!="
		| "<"
		| ">"
		| "||"
		| "&&"
	>;
	right: Expression;
}
