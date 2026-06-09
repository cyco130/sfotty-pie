import { encodeInstruction } from "./encode.ts";
import { evaluate, type EvalEnv } from "./evaluate.ts";
import { render, Segment } from "./layout.ts";
import { loadModules, type Host, type LoadedModule } from "./loader.ts";
import { expandMacros } from "./macros.ts";
import { Scopes } from "./scopes.ts";
import {
	getExpressionLocation,
	parse,
	type Assignment,
	type Expression,
	type Global,
	type Message,
	type Operand,
	type StatementContent,
} from "./parser.ts";
import { SourceFile } from "./source-file.ts";
import { decodeStringLiteral, type Value } from "./value.ts";

export interface AssembleResult {
	output: Uint8Array;
	symbols: Map<string, Value>;
	diagnostics: Message[];
}

type Reporter = (message: string, span: readonly [number, number]) => void;

/**
 * Assemble a single source string (no module imports). Synchronous — there is
 * no `Host` to consult, so nothing async can happen.
 */
export function assemble(source: string, name?: string): AssembleResult;
/**
 * Assemble a project rooted at `entry`, reaching other modules through `host`.
 * Asynchronous: the host (the only I/O) is consulted upfront while loading the
 * module graph; everything after that is the synchronous core.
 */
export function assemble(entry: string, host: Host): Promise<AssembleResult>;
export function assemble(
	sourceOrEntry: string,
	nameOrHost: string | Host = "input",
): AssembleResult | Promise<AssembleResult> {
	if (typeof nameOrHost === "object") {
		return assembleProject(sourceOrEntry, nameOrHost);
	}
	// Single source: one module with no imports, assembled synchronously.
	const name = nameOrHost;
	const diagnostics: Message[] = [];
	const sourceFile = new SourceFile(name, sourceOrEntry);
	const { module, errors } = parse(sourceFile);
	diagnostics.push(...errors);
	const modules: LoadedModule[] = [
		{ id: name, sourceFile, statements: module.statements, imports: [] },
	];
	return assembleModules(modules, name, diagnostics);
}

async function assembleProject(
	entryId: string,
	host: Host,
): Promise<AssembleResult> {
	const loadDiagnostics: Message[] = [];
	const modules = await loadModules(entryId, host, loadDiagnostics);
	return assembleModules(modules, entryId, loadDiagnostics);
}

/**
 * The synchronous core: expand macros, then run the multipass collect→render
 * loop over the (already loaded) modules. `priorDiagnostics` are the load/parse
 * diagnostics gathered before this point.
 */
function assembleModules(
	loaded: readonly LoadedModule[],
	entryId: string,
	priorDiagnostics: Message[],
): AssembleResult {
	// Macro expansion is static and runs once, before the multipass.
	const expandReport: Reporter = (message, span) => {
		priorDiagnostics.push({
			type: "error",
			start: span[0],
			end: span[1],
			message,
		});
	};
	const modules = loaded.map((module) => ({
		...module,
		statements: expandMacros(module.statements, expandReport),
	}));

	const scopes = new Scopes(modules);
	let output: number[] = [];
	let diagnostics: Message[] = [];
	let bases = new Map<string, bigint>(); // segment bases from the previous render

	// Pessimistic shrink-only sizing is monotone; values also flow across modules
	// through the ambient scope a hop per pass. The cap is a generous backstop.
	const statementCount = modules.reduce((n, m) => n + m.statements.length, 0);
	const cap = Math.max(statementCount + 1, 8);
	let converged = false;

	for (let pass = 0; pass < cap; pass++) {
		const snapshot = scopes.snapshot();
		scopes.beginPass();
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
		const segments = collect(modules, scopes, report, bases);
		const result = render(
			segments,
			"OUTPUT",
			(moduleId, name, value, kind, span) => {
				if (scopes.defineLocal(moduleId, name, value, kind, span)) {
					report(`Symbol "${name}" is already defined`, span);
				}
			},
			report,
		);
		output = result.bytes;
		bases = result.bases;

		if (!scopes.changedSince(snapshot)) {
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
		symbols: scopes.resolvedFor(entryId),
		diagnostics: [...priorDiagnostics, ...diagnostics],
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
	modules: readonly LoadedModule[],
	scopes: Scopes,
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

	getSegment("OUTPUT");
	// Running location per segment (shared across modules) — the pc source for
	// branch offsets; starts at the segment's base from the previous render.
	const locations = new Map<string, bigint>();
	const locationOf = (name: string) =>
		locations.get(name) ?? bases.get(name) ?? 0n;

	for (const module of modules) {
		const moduleId = module.id;
		let current = getSegment("OUTPUT"); // reset per module

		for (const statement of module.statements) {
			for (const label of statement.labels) {
				current.items.push({
					kind: "label",
					moduleId,
					name: label.identifier.text,
					symbolKind: "label",
					span: [label.identifier.start, label.identifier.end],
				});
			}

			const content = statement.content;
			if (!content) continue;

			switch (content.type) {
				case "import":
					break; // resolved by the loader
				case "define-segment":
					getSegment(segmentName(content.nameToken, report));
					break;
				case "segment":
					current = getSegment(segmentName(content.nameToken, report));
					break;
				case "segment-shorthand":
					// `.code` -> "CODE", `.rodata` -> "RODATA", etc.
					current = getSegment(content.keyword.text.slice(1).toUpperCase());
					break;
				case "emit":
				case "emplace":
					current.items.push({
						kind: content.type,
						segment: segmentName(content.nameToken, report),
						span: [content.nameToken.start, content.nameToken.end],
					});
					break;
				case "export":
					if (content.content.type === "assignment") {
						defineAssignment(
							content.content,
							moduleId,
							scopes,
							locationOf(current.name),
							report,
						);
					} else {
						report("Only a definition can be exported", [
							content.exportToken.start,
							content.exportToken.end,
						]);
					}
					break;
				case "global":
					defineGlobal(content, moduleId, scopes, report);
					break;
				case "assignment":
					defineAssignment(
						content,
						moduleId,
						scopes,
						locationOf(current.name),
						report,
					);
					break;
				default:
					locations.set(
						current.name,
						collectContent(
							content,
							moduleId,
							scopes,
							locationOf(current.name),
							current,
							report,
						),
					);
			}
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

function moduleEnv(
	moduleId: string,
	scopes: Scopes,
	location: bigint,
	report: Reporter,
): EvalEnv {
	return {
		resolve: (name) => scopes.resolve(moduleId, name),
		resolveGlobal: (name) => scopes.resolveAmbient(name),
		locationCounter: location,
		report,
		strict: true,
	};
}

function defineAssignment(
	assignment: Assignment,
	moduleId: string,
	scopes: Scopes,
	location: bigint,
	report: Reporter,
): void {
	const env = moduleEnv(moduleId, scopes, location, report);
	const value = evaluate(assignment.expression, env);
	const kind = assignment.operatorToken.type === ":=" ? "label" : "constant";
	const { text, start, end } = assignment.identifier;
	const span: readonly [number, number] = [start, end];
	if (scopes.defineLocal(moduleId, text, value, kind, span)) {
		report(`Symbol "${text}" is already defined`, span);
	}
}

// `.global name` publishes the module's local `name` to the ambient scope.
function defineGlobal(
	global: Global,
	moduleId: string,
	scopes: Scopes,
	report: Reporter,
): void {
	const { text, start, end } = global.nameToken;
	const span: readonly [number, number] = [start, end];
	const value = scopes.resolve(moduleId, text);
	const kind = scopes.kindOf(moduleId, text) ?? "label";
	if (scopes.defineAmbient(text, value, kind, span)) {
		report(`Global "${text}" is already defined`, span);
	}
}

/**
 * Collect a content statement (org/byte/word/instruction) into `output`,
 * returning the new running location counter.
 */
function collectContent(
	content: StatementContent,
	moduleId: string,
	scopes: Scopes,
	location: bigint,
	output: Segment,
	report: Reporter,
): bigint {
	const env = moduleEnv(moduleId, scopes, location, report);

	switch (content.type) {
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

		case "res": {
			// Reserve N zero bytes. In an emplaced segment they're never written
			// (emplace renders for size only); in an emitted segment they're real.
			const value = evaluate(content.count, env);
			if (value === undefined) return location; // count resolves later
			if (typeof value !== "bigint" || value < 0n) {
				report(
					"`.res` requires a non-negative count",
					getExpressionLocation(content.count),
				);
				return location;
			}
			const count = Number(value);
			output.items.push({ kind: "bytes", bytes: new Array(count).fill(0) });
			return location + value;
		}

		case "instruction": {
			const expr = operandExpression(content.operand);
			const value = expr ? evaluate(expr, env) : undefined;
			const bytes = encodeInstruction(content, value, { location, report });
			output.items.push({ kind: "bytes", bytes });
			return location + BigInt(bytes.length);
		}

		// Assignments, segment, and module directives are all handled in
		// `collect`; they never reach here.
		default:
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
