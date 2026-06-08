import { encodeInstruction } from "./encode.ts";
import { evaluate, type EvalEnv } from "./evaluate.ts";
import { render, Segment } from "./layout.ts";
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
import { SymbolTable, type SymbolKind } from "./symbols.ts";
import { decodeStringLiteral, type Value } from "./value.ts";

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
	let bases = new Map<string, bigint>(); // segment bases from the previous render

	// Pessimistic shrink-only sizing is monotone, so it settles in at most one
	// pass per shrinkable instruction; the cap is just a backstop.
	const cap = Math.max(statements.length + 1, 8);
	let converged = false;

	for (let pass = 0; pass < cap; pass++) {
		const snapshot = symbols.snapshot();
		symbols.beginPass();
		diagnostics = [];
		const report: Reporter = (message, span) => {
			diagnostics.push({
				type: "error",
				start: span[0],
				end: span[1],
				message,
			});
		};

		// Collect content into segments (defining constants), then render OUTPUT
		// to bytes (defining labels). Everything evaluates against the previous
		// pass's symbol values and segment bases; this pass produces the new ones.
		const segments = collect(statements, symbols, report, bases);
		const result = render(
			segments,
			"OUTPUT",
			(labelName, value, kind, span) => {
				if (symbols.define(labelName, value, kind, span)) {
					report(`Symbol "${labelName}" is already defined`, span);
				}
			},
			report,
		);
		output = result.bytes;
		bases = result.bases;

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

/**
 * Walk the statements, routing content into the current segment (OUTPUT by
 * default, switched by `.segment`) and defining constants. Returns the segment
 * map for rendering. Each segment tracks a running location counter — starting
 * at its base from the previous render — so instructions get a pc for branch
 * offsets (same-segment branches are base-invariant, so this converges).
 */
function collect(
	statements: Statement[],
	symbols: SymbolTable,
	report: Reporter,
	bases: Map<string, bigint>,
): Map<string, Segment> {
	const segments = new Map<string, Segment>();
	const getSegment = (name: string): Segment => {
		let segment = segments.get(name);
		if (!segment) {
			segment = new Segment(name);
			segments.set(name, segment);
		}
		return segment;
	};

	let current = getSegment("OUTPUT");
	const locations = new Map<string, bigint>();
	const locationOf = (name: string) =>
		locations.get(name) ?? bases.get(name) ?? 0n;

	for (const statement of statements) {
		for (const label of statement.labels) {
			current.items.push({
				kind: "label",
				name: label.identifier.text,
				symbolKind: "label",
				span: [label.identifier.start, label.identifier.end],
			});
		}

		const content = statement.content;
		if (!content) continue;

		switch (content.type) {
			case "define-segment":
				getSegment(segmentName(content.nameToken, report));
				break;
			case "segment":
				current = getSegment(segmentName(content.nameToken, report));
				break;
			case "emit":
			case "emplace":
				current.items.push({
					kind: content.type,
					segment: segmentName(content.nameToken, report),
					span: [content.nameToken.start, content.nameToken.end],
				});
				break;
			default:
				locations.set(
					current.name,
					collectContent(
						content,
						symbols,
						locationOf(current.name),
						current,
						report,
					),
				);
		}
	}

	return segments;
}

function segmentName(
	token: { text: string; start: number; end: number },
	report: Reporter,
): string {
	return decodeStringLiteral(token.text, (escape) =>
		report(`Unknown escape sequence "\\${escape}"`, [token.start, token.end]),
	);
}

function define(
	symbols: SymbolTable,
	identifier: { text: string; start: number; end: number },
	value: Value | undefined,
	kind: SymbolKind,
	report: Reporter,
): void {
	const span: readonly [number, number] = [identifier.start, identifier.end];
	if (symbols.define(identifier.text, value, kind, span)) {
		report(`Symbol "${identifier.text}" is already defined`, span);
	}
}

/**
 * Collect a statement's content into `output`, returning the new running
 * location counter (used as the pc for the next instruction's branch offsets).
 */
function collectContent(
	content: StatementContent,
	symbols: SymbolTable,
	location: bigint,
	output: Segment,
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
				content.operatorToken.type === ":=" ? "label" : "constant",
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
			output.items.push({ kind: "org", addr: value });
			return value;
		}

		case "byte":
		case "word": {
			const size = content.type === "byte" ? 1 : 2;
			const bytes: number[] = [];
			for (const [expr] of content.list)
				emitData(expr, env, bytes, size, report);
			output.items.push({ kind: "bytes", bytes });
			return location + BigInt(bytes.length);
		}

		case "instruction": {
			const expr = operandExpression(content.operand);
			const value = expr ? evaluate(expr, env) : undefined;
			const bytes = encodeInstruction(content, value, { location, report });
			output.items.push({ kind: "bytes", bytes });
			return location + BigInt(bytes.length);
		}

		// Parsed in step 3.1; the segment/OUTPUT engine that gives these meaning
		// lands in step 3.2b. Until then they're inert (flat mode is unaffected).
		case "define-segment":
		case "segment":
		case "emit":
		case "emplace":
			return location;
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
