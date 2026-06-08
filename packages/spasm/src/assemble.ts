import { encodeInstruction } from "./encode.ts";
import { evaluate, type EvalEnv } from "./evaluate.ts";
import {
	getExpressionLocation,
	parse,
	type Expression,
	type Message,
	type Operand,
	type Statement,
	type StatementContent,
} from "./parser.ts";
import { SourceFile } from "./source-file.ts";
import { SymbolTable } from "./symbols.ts";
import type { Value } from "./value.ts";

export interface AssembleResult {
	output: Uint8Array;
	symbols: Map<string, Value>;
	diagnostics: Message[];
}

type Reporter = (message: string, span: readonly [number, number]) => void;

export function assemble(source: string, name = "input"): AssembleResult {
	const sourceFile = new SourceFile(name, source);
	const { module, errors } = parse(sourceFile);
	const statements = module.statements;

	const symbols = new SymbolTable();
	let output: number[] = [];
	let diagnostics: Message[] = [];

	// Pessimistic shrink-only sizing is monotone, so it settles in at most one
	// pass per shrinkable instruction; the cap is just a backstop.
	const cap = Math.max(statements.length + 1, 8);
	let converged = false;

	for (let pass = 0; pass < cap; pass++) {
		const snapshot = symbols.snapshot();
		symbols.beginPass();
		output = [];
		diagnostics = [];
		runPass(statements, symbols, output, diagnostics);
		if (!symbols.changedSince(snapshot)) {
			converged = true;
			break;
		}
	}

	if (!converged) {
		// The last pass's state is valid (pessimistic), just possibly suboptimal.
		diagnostics.push({
			type: "warning",
			start: 0,
			end: 0,
			message: `Assembly did not converge after ${cap} passes; some operands may be larger than necessary.`,
		});
	}

	return {
		output: new Uint8Array(output),
		symbols: symbols.resolved(),
		diagnostics: [...errors, ...diagnostics],
	};
}

function runPass(
	statements: Statement[],
	symbols: SymbolTable,
	output: number[],
	diagnostics: Message[],
): void {
	const report: Reporter = (message, span) => {
		diagnostics.push({ type: "error", start: span[0], end: span[1], message });
	};

	let location = 0n;
	for (const statement of statements) {
		for (const label of statement.labels) {
			define(symbols, label.identifier, location, report);
		}
		if (statement.content) {
			location = processContent(
				statement.content,
				symbols,
				location,
				output,
				report,
			);
		}
	}
}

function define(
	symbols: SymbolTable,
	identifier: { text: string; start: number; end: number },
	value: Value | undefined,
	report: Reporter,
): void {
	const span: readonly [number, number] = [identifier.start, identifier.end];
	if (symbols.define(identifier.text, value, span)) {
		report(`Symbol "${identifier.text}" is already defined`, span);
	}
}

/** Process a statement's content, returning the new location counter. */
function processContent(
	content: StatementContent,
	symbols: SymbolTable,
	location: bigint,
	output: number[],
	report: Reporter,
): bigint {
	const env: EvalEnv = {
		resolve: (name) => symbols.resolve(name),
		locationCounter: location,
		report,
		strict: true,
	};

	switch (content.type) {
		case "assignment":
			define(
				symbols,
				content.identifier,
				evaluate(content.expression, env),
				report,
			);
			return location;

		case "org": {
			const value = evaluate(content.expression, env);
			if (value === undefined) return location; // keep; resolves later
			if (typeof value !== "bigint") {
				report(
					"`.org` requires a numeric address",
					getExpressionLocation(content.expression),
				);
				return location;
			}
			return value;
		}

		case "byte":
		case "word": {
			const size = content.type === "byte" ? 1 : 2;
			const before = output.length;
			for (const [expr] of content.list)
				emitData(expr, env, output, size, report);
			return location + BigInt(output.length - before);
		}

		case "instruction": {
			const expr = operandExpression(content.operand);
			const value = expr ? evaluate(expr, env) : undefined;
			const bytes = encodeInstruction(content, value, { location, report });
			output.push(...bytes);
			return location + BigInt(bytes.length);
		}
	}
}

function operandExpression(operand: Operand | null): Expression | null {
	if (operand === null || operand.type === "accumulator-operand") return null;
	return operand.expression;
}

function emitData(
	expr: Expression,
	env: EvalEnv,
	output: number[],
	size: 1 | 2,
	report: Reporter,
): void {
	const value = evaluate(expr, env);
	const span = getExpressionLocation(expr);

	if (value === undefined) {
		for (let i = 0; i < size; i++) output.push(0); // placeholder
		return;
	}

	if (typeof value === "string") {
		if (size === 2) {
			report("A string is not allowed in `.word`", span);
			output.push(0, 0);
			return;
		}
		for (const byte of new TextEncoder().encode(value)) output.push(byte);
		return;
	}

	if (size === 1) {
		if (value < -128n || value > 255n)
			report(`Byte value out of range: ${value}`, span);
		output.push(Number(value & 0xffn));
	} else {
		if (value < -32768n || value > 65535n)
			report(`Word value out of range: ${value}`, span);
		const word = Number(value & 0xffffn);
		output.push(word & 0xff, (word >> 8) & 0xff);
	}
}
