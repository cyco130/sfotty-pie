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

		for (;;) {
			const token = this.#token;
			// A lone `:` is an anonymous label, referred to by `:+` / `:-`. It
			// carries the placeholder name `ANONYMOUS_LABEL` until the resolver
			// numbers it, so it needs no separate AST shape.
			if (token.type === ":") {
				labels.push({
					type: "label",
					identifier: { ...token, type: "identifier", text: ANONYMOUS_LABEL },
					colonToken: token,
				});
				this.#consume();
				continue;
			}

			const colonToken = this.#lookahead;
			if (token.type !== "identifier" || colonToken.type !== ":") break;

			// `bne :+` is an instruction with an anonymous-label operand, not a
			// label named `bne`. A sign hugging the colon binds rightwards, and
			// nothing else can follow a label's colon that way - no statement
			// starts with `+` or `-`.
			const saved = this.#save();
			this.#consume();
			this.#consume();
			const sign = this.#token;
			if (
				(sign.type === "+" || sign.type === "-") &&
				sign.start === colonToken.end
			) {
				this.#restore(saved);
				break;
			}

			labels.push({ type: "label", identifier: token, colonToken });
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
					expression: this.#expression(1),
				};
			}

			case "push": {
				this.#consume();
				return {
					type: "push",
					pushToken: token,
					expression: this.#expression(1),
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
					const nameTokenParam = this.#expect("identifier");
					// `name = operand` - a default argument. Parsed as an
					// operand, since that is what an argument is: `= 5`,
					// `= "RODATA"`, and `= #5` all work.
					let defaultOperand: Operand | undefined;
					if ((this.#token.type as TokenType) === "=") {
						this.#consume();
						defaultOperand = this.#operand() ?? undefined;
						if (!defaultOperand) {
							throw new ParseError(this.#token, ["operand"]);
						}
					}
					params.push({
						outToken,
						nameToken: nameTokenParam,
						defaultOperand,
					});
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
		const argNames: (Token<"identifier"> | undefined)[] = [];
		let sawName = false;

		// `name: operand` - a keyword argument (macro calls only; a keyword
		// arg list is a braceless dict literal, sharing the `:` association
		// mark). The colon must not start `::`, `:=`, or a hugging `:+`/`:-`.
		const argName = (): Token<"identifier"> | undefined => {
			if (this.#token.type !== "identifier") return undefined;
			const colon = this.#lookahead;
			if (colon.type !== ":") return undefined;
			const name = this.#token;
			const saved = this.#save();
			this.#consume();
			this.#consume();
			const next = this.#token as Token;
			if (
				(next.type === "+" || next.type === "-") &&
				next.start === colon.end
			) {
				this.#restore(saved); // `name :+` - an anonymous-label operand
				return undefined;
			}
			return name;
		};

		const one = (): boolean => {
			const name = argName();
			const operand = this.#operand();
			if (!operand) {
				if (name) throw new ParseError(this.#token, ["an operand"]);
				return false;
			}
			operands.push(operand);
			argNames.push(name);
			if (name) sawName = true;
			return true;
		};

		if (one()) {
			while (this.#token.type === ",") {
				this.#consume();
				if (!one()) {
					throw new ParseError(this.#token, ["an operand"]);
				}
			}
		}

		return {
			type: "instruction",
			mnemonic,
			operands,
			argNames: sawName ? argNames : undefined,
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

			case "x":
			case "y": {
				const registerToken = token;
				this.#consume();
				return { type: "register-operand", registerToken };
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
			// `:+` / `:++` / `:-` ... - the next or previous anonymous label.
			// Adjacency is required, and that is what keeps `key: +1` in a
			// dictionary or an attribute tail a keyed entry with a signed value:
			// there the `:` is consumed by the entry rule, never reaching here.
			case ":": {
				this.#consume();
				const sign = this.#token.type;
				if ((sign !== "+" && sign !== "-") || this.#token.start !== token.end) {
					throw new ParseError(this.#token, ['"+"', '"-"']);
				}
				let text: string = ":";
				let end = token.end;
				while (this.#token.type === sign && this.#token.start === end) {
					text += sign;
					end = this.#token.end;
					this.#consume();
				}
				return { ...token, type: "identifier", text, end };
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

			// `.segment()` - the current segment's name. The parens keep the
			// statement and expression forms apart and leave room for the
			// future `.segment("NAME")` segment-value form.
			case "segment": {
				this.#consume();
				const openingBracketToken = this.#expect("(");
				const closingBracketToken = this.#expect(")");
				return {
					type: "segment-expression",
					segmentToken: token,
					openingBracketToken,
					closingBracketToken,
				};
			}

			case "a_operand":
			case "x_operand":
			case "y_operand":
			case "immediate_operand":
			case "x_indexed_operand":
			case "y_indexed_operand":
			case "indirect_operand":
			case "x_indexed_indirect_operand":
			case "indirect_y_indexed_operand":
			case "is_a_operand":
			case "is_x_operand":
			case "is_y_operand":
			case "is_immediate_operand":
			case "is_x_indexed_operand":
			case "is_y_indexed_operand":
			case "is_indirect_operand":
			case "is_x_indexed_indirect_operand":
			case "is_indirect_y_indexed_operand":
			case "is_simple_operand":
			case "is_integer":
			case "is_string":
			case "is_dictionary":
			case "is_function":
			case "is_operand":
			case "is_null":
			case "operand_value": {
				this.#consume();
				const openingBracketToken = this.#expect("(");
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
				return {
					type: "builtin-call",
					nameToken: token,
					openingBracketToken,
					args,
					closingBracketToken,
				};
			}

			case "null": {
				this.#consume();
				return { type: "null-literal", nullToken: token };
			}

			// `.pop()` - the value on top of the module's `.push` stack.
			// Expression builtins are calls; statements take bare arguments.
			case "pop": {
				this.#consume();
				const openingBracketToken = this.#expect("(");
				const closingBracketToken = this.#expect(")");
				return {
					type: "pop-expression",
					popToken: token,
					openingBracketToken,
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
		params: FunctionParam[];
		operatorToken: Token<"=">;
	} | null {
		this.#consume(); // the "("
		const params: FunctionParam[] = [];
		while (this.#token.type === "identifier") {
			const nameToken = this.#token;
			this.#consume();
			// `name = expr` - a default argument.
			let defaultExpression: Expression | undefined;
			if ((this.#token.type as TokenType) === "=") {
				this.#consume();
				try {
					defaultExpression = this.#expression(1);
				} catch (error) {
					if (error instanceof ParseError) return null; // not a param list
					throw error;
				}
			}
			params.push({ nameToken, defaultExpression });
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
		params: FunctionParam[] | null,
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
		case "call-expression":
			return [
				getExpressionLocation(expression.callee)[0],
				expression.closingBracketToken.end,
			];
		case "segment-expression":
			return [
				expression.segmentToken.start,
				expression.closingBracketToken.end,
			];
		case "pop-expression":
			return [expression.popToken.start, expression.closingBracketToken.end];
		case "builtin-call":
			return [expression.nameToken.start, expression.closingBracketToken.end];
		case "operand-literal":
			return getOperandLocation(expression.operand);
		case "null-literal":
			return [expression.nullToken.start, expression.nullToken.end];
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

/**
 * The hygiene origin of an expression's leftmost token - the module whose
 * source `getExpressionLocation(expression)[0]` indexes into (undefined means
 * the containing module). Diagnostics spanning an expression attribute with
 * this so span and file agree even in macro-expanded statements, where an
 * operand's tokens may come from a different file than the statement around
 * it.
 */
export function getExpressionOrigin(
	expression: Expression,
): string | undefined {
	return getExpressionAnchorToken(expression)?.origin;
}

/**
 * The expression's *anchor* token: the leftmost token that can carry hygiene
 * metadata (`origin`, `substitutedAt`). Splicing writes there and diagnostics
 * read there, so the two always meet on the same token.
 */
export function getExpressionAnchorToken(
	expression: Expression,
): Token | undefined {
	switch (expression.type) {
		case "decimal":
		case "hexadecimal":
		case "binary":
		case "identifier":
		case "string":
		case "character":
		case "*":
			return expression;
		case "member-expression":
			return getExpressionAnchorToken(expression.object);
		// Only identifiers (and a few keywords) get hygiene stamps, so for
		// wrappers whose leftmost token is punctuation, the inner expression
		// is the informative one - its tokens come from the same source text.
		case "grouped-expression":
		case "prefix-expression":
			return getExpressionAnchorToken(expression.expression);
		case "dict-literal":
			return expression.openingBraceToken;
		case "call-expression":
			return getExpressionAnchorToken(expression.callee);
		case "infix-expression":
			return getExpressionAnchorToken(expression.left);
		case "segment-expression":
			return expression.segmentToken;
		case "pop-expression":
			return expression.popToken;
		case "builtin-call":
			return expression.nameToken;
		case "null-literal":
			return expression.nullToken;
		case "operand-literal": {
			const operand = expression.operand;
			if (operand.type === "accumulator-operand") {
				return operand.accumulatorToken;
			}
			if (operand.type === "register-operand") return operand.registerToken;
			return getExpressionAnchorToken(operand.expression);
		}
		default:
			impossible(expression);
	}
}

/** Visit every identifier token in expression position (path keys are not
 * identifiers in this sense - only a path's root resolves as a name). */
export function forEachIdentifier(
	expression: Expression,
	visit: (token: Token<"identifier">) => void,
): void {
	switch (expression.type) {
		case "identifier":
			visit(expression);
			return;
		case "member-expression":
			forEachIdentifier(expression.object, visit);
			return;
		case "grouped-expression":
		case "prefix-expression":
			forEachIdentifier(expression.expression, visit);
			return;
		case "infix-expression":
			forEachIdentifier(expression.left, visit);
			forEachIdentifier(expression.right, visit);
			return;
		case "call-expression":
			forEachIdentifier(expression.callee, visit);
			for (const argument of expression.args) {
				forEachIdentifier(argument, visit);
			}
			return;
		case "dict-literal":
			for (const entry of expression.entries) {
				forEachIdentifier(entry.value, visit);
			}
			return;
		case "builtin-call":
			for (const argument of expression.args) {
				forEachIdentifier(argument, visit);
			}
			return;
		case "operand-literal":
			if (
				expression.operand.type !== "accumulator-operand" &&
				expression.operand.type !== "register-operand"
			) {
				forEachIdentifier(expression.operand.expression, visit);
			}
			return;
		case "null-literal":
			return;
		default:
			return; // literals and `*`
	}
}

export function getOperandLocation(
	operand: Operand,
): [start: number, end: number] {
	switch (operand.type) {
		case "accumulator-operand":
			return [operand.accumulatorToken.start, operand.accumulatorToken.end];
		case "register-operand":
			return [operand.registerToken.start, operand.registerToken.end];
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
	/**
	 * For a statement cloned out of a macro body: the chain of call sites it
	 * was expanded through, innermost first - `trail[0]` is the call that
	 * produced this statement, `trail[at the end]` the original source-level
	 * call. Diagnostics walk it to narrate the expansion path.
	 */
	expansionTrail?: readonly ExpansionSite[];
}

/** One hop of a macro-expansion trail: the call to `macro` at this span. */
export interface ExpansionSite {
	macro: string;
	file: string;
	start: number;
	end: number;
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
	| ErrorDirective
	| Push;

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

/**
 * One `key: value` in a definition's attribute tail (`X := $0300, size: 2`).
 * The tail is parsed and its keys are checked, but the value is currently
 * discarded and never evaluated - attribute semantics wait on the
 * address-vs-number value split (see design.md, "What's deferred").
 */
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
	params: FunctionParam[] | null;
}

/** One expression-macro parameter, with an optional default. */
export interface FunctionParam {
	nameToken: Token<"identifier">;
	defaultExpression?: Expression;
}

/**
 * The placeholder name the parser gives a lone `:`. It can't be spelled as an
 * identifier, so it never collides; `resolveAnonymousLabels` replaces it with
 * a numbered name (`:0`, `:1`, ...) and rewrites the `:+` / `:-` references
 * that point at it.
 */
export const ANONYMOUS_LABEL = ":";

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
	/**
	 * Parallel to `operands`: each argument's keyword name (`aux1: #4`), or
	 * `undefined` for positional ones. Absent when every argument is
	 * positional. Keyword arguments only mean something on macro calls;
	 * encode rejects them on real instructions.
	 */
	argNames?: (Token<"identifier"> | undefined)[];
}

export type Operand =
	| AccumulatorOperand
	| RegisterOperand
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

/** A bare `x` or `y` operand. No instruction accepts one - they exist as
 * macro-argument currency (register-shaped operand values). */
export interface RegisterOperand {
	type: "register-operand";
	registerToken: Token<"x"> | Token<"y">;
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
	/** The segment name: a string literal, or any string-valued expression
	 * (`.segment .pop` restores a saved name). */
	expression: Expression;
}

/** `.push expr` - push a value onto the module's value stack. */
export interface Push {
	type: "push";
	pushToken: Token<"push">;
	expression: Expression;
}

/** `.segment()` in expression position: the current segment's name. */
export interface SegmentExpression {
	type: "segment-expression";
	segmentToken: Token<"segment">;
	openingBracketToken: Token<"(">;
	closingBracketToken: Token<")">;
}

/** The operand/value builtin names, callable in expression position. */
export const BUILTIN_NAMES = [
	"a_operand",
	"x_operand",
	"y_operand",
	"immediate_operand",
	"x_indexed_operand",
	"y_indexed_operand",
	"indirect_operand",
	"x_indexed_indirect_operand",
	"indirect_y_indexed_operand",
	"is_a_operand",
	"is_x_operand",
	"is_y_operand",
	"is_immediate_operand",
	"is_x_indexed_operand",
	"is_y_indexed_operand",
	"is_indirect_operand",
	"is_x_indexed_indirect_operand",
	"is_indirect_y_indexed_operand",
	"is_simple_operand",
	"is_integer",
	"is_string",
	"is_dictionary",
	"is_function",
	"is_operand",
	"operand_value",
	"is_null",
] as const;

export type BuiltinName = (typeof BUILTIN_NAMES)[number];

/** A builtin call (`.immediate_operand(3)`, `.is_string(v)`). */
export interface BuiltinCall {
	type: "builtin-call";
	nameToken: Token<BuiltinName>;
	openingBracketToken: Token<"(">;
	args: Expression[];
	closingBracketToken: Token<")">;
}

/**
 * A shaped operand spliced into expression position by macro substitution -
 * never parsed from source. Evaluates to an `OperandValue`.
 */
export interface OperandLiteral {
	type: "operand-literal";
	operand: Operand;
}

/** `.null`: the null value. A bare literal, not a call - like `*`, it *is*
 * rather than *does*, so it takes no parens. */
export interface NullLiteral {
	type: "null-literal";
	nullToken: Token<"null">;
}

/** `.pop()` in expression position: the value on top of the module's stack. */
export interface PopExpression {
	type: "pop-expression";
	popToken: Token<"pop">;
	openingBracketToken: Token<"(">;
	closingBracketToken: Token<")">;
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
	/** `name = operand` - the default argument, definition-side (its free
	 * names resolve in the defining module). Trailing params only. */
	defaultOperand?: Operand;
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
	| CallExpression
	| SegmentExpression
	| PopExpression
	| BuiltinCall
	| OperandLiteral
	| NullLiteral;

/** Function application: `DOUBLE(2)`, `lib::DOUBLE(2)`. */
export interface CallExpression {
	type: "call-expression";
	callee: Expression;
	openingBracketToken: Token<"(">;
	args: Expression[];
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
