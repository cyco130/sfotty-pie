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
				// the outer `while (… !== "eof")`); recovery can reach eof at a final
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
		const possibleMewline = this.#expect("newline", "eof");
		const newline = possibleMewline.type === "newline" ? possibleMewline : null;

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

				const possibleEqualsToken = this.#token;
				if (possibleEqualsToken.type === "=") {
					this.#consume();
					return {
						type: "assignment",
						identifier,
						equalsToken: possibleEqualsToken,
						expression: this.#expression(1),
					};
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
		}

		return null;
	}

	#instruction(identifier: Token<"identifier">): Instruction {
		const mnemonic = identifier;
		const operand = this.#operand();

		return {
			type: "instruction",
			mnemonic,
			operand,
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

					// "(expr), Y" — indirect-indexed
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
					// computed value instead — "(sym + 2) * 2" is absolute, not indirect.
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
						// "(expr), X" / "(expr) * 2, Y" — grouped value, indexed
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
						// Nothing followed "(expr)" — indirect addressing.
						return {
							type: "indirect-operand",
							openingBracketToken,
							expression,
							closingBracketToken,
						};
					}

					// Grouped expression with a tail — a computed value operand.
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
			// Primary expressions
			case "identifier":
			case "decimal":
			case "hexadecimal":
			case "string":
			case "*": {
				this.#consume();
				return token;
			}

			// Unary prefixes
			case "+":
			case "-":
			case "<":
			case ">":
			case "!": {
				const operator = token;
				this.#consume();
				const expression = this.#expression(100);

				return {
					type: "prefix-expression",
					operator,
					expression,
				};
			}

			// Grouping parantheses
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

			case "+":
			case "-":
				return this.#infix(this.#token, precedence, 5, head);

			case "*":
			case "/":
			case "%":
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

export interface Message {
	type: "error" | "warning" | "info";
	start: number;
	end: number;
	message: string;
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
	message: string;
	start: number;
	end: number;
}

export function getExpressionLocation(
	expression: Expression,
): [start: number, end: number] {
	switch (expression.type) {
		case "decimal":
		case "hexadecimal":
		case "identifier":
		case "string":
		case "*":
			return [expression.start, expression.end];
		case "grouped-expression":
			return [
				expression.openingBracketToken.start,
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

export type StatementContent = Instruction | Org | Byte | Word | Assignment;

export interface Assignment {
	type: "assignment";
	identifier: Token<"identifier">;
	equalsToken: Token<"=">;
	expression: Expression;
}

export interface Label {
	type: "label";
	identifier: Token<"identifier">;
	colonToken: Token<":">;
}

export interface Instruction {
	type: "instruction";
	mnemonic: Token<"identifier">;
	operand: null | Operand;
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

export type Expression =
	| Token<"identifier">
	| Token<"string">
	| Token<"*">
	| IntegerLiteral
	| GroupedExpression
	| PrefixExpression
	| InfixExpression;

export type IntegerLiteral = Token<"decimal"> | Token<"hexadecimal">;

export interface GroupedExpression {
	type: "grouped-expression";
	openingBracketToken: Token<"(">;
	expression: Expression;
	closingBracketToken: Token<")">;
}

export interface PrefixExpression {
	type: "prefix-expression";
	operator: Token<"+" | "-" | "<" | ">" | "!">;
	expression: Expression;
}

export interface InfixExpression {
	type: "infix-expression";
	left: Expression;
	operator: Token<
		"*" | "/" | "%" | "+" | "-" | "=" | "!=" | "<" | ">" | "||" | "&&"
	>;
	right: Expression;
}
