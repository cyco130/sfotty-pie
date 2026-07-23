import { encodeInstruction } from "./encode.ts";
import { evaluate, type EvalEnv } from "./evaluate.ts";
import { render, Segment } from "./layout.ts";
import { loadModules, type Host, type LoadedModule } from "./loader.ts";
import { expandModules } from "./macros.ts";
import { Scopes } from "./scopes.ts";
import {
	getExpressionLocation,
	parse,
	type Assignment,
	type DictLiteral,
	type Expression,
	type Message,
	type Operand,
	type StatementContent,
} from "./parser.ts";
import { SourceFile } from "./source-file.ts";
import { SEP, type SymbolAttributes } from "./symbols.ts";
import {
	decodeStringLiteral,
	type FunctionValue,
	type Value,
} from "./value.ts";

export interface AssembleResult {
	output: Uint8Array;
	symbols: Map<string, Value>;
	diagnostics: Message[];
}

type Reporter = (message: string, span: readonly [number, number]) => void;

// Function values interned per definition site (see defineAssignment).
const functionValues = new WeakMap<Assignment, FunctionValue>();

/**
 * Assemble a single source string (no module imports). Synchronous - there is
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
 * The synchronous core: expand macros, then run the multipass collect->render
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
	const modules = expandModules(loaded, expandReport);

	const scopes = new Scopes(modules);
	let output: number[] = [];
	let diagnostics: Message[] = [];
	let bases = new Map<string, bigint>(); // segment bases from the previous render
	let resSizes = new Map<string, bigint>(); // `res` sizes from the previous render

	// Pessimistic shrink-only sizing is monotone; label values still flow a hop
	// per pass (render defines them after collect). The cap is a generous
	// backstop.
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
		const segments = collect(modules, scopes, report, bases, resSizes);
		const result = render(
			segments,
			"OUTPUT",
			(moduleId, name, value, kind, span) => {
				if (scopes.defineLocal(moduleId, name, value, kind, span)) {
					report(`Symbol "${name}" is already defined`, span);
				}
			},
			(expression, moduleId, location) =>
				evaluate(expression, moduleEnv(moduleId, scopes, location, report)),
			report,
		);
		const previous = output;
		output = result.bytes;
		bases = result.bases;
		resSizes = result.resSizes;

		// Converged only when both the symbol table AND the output bytes are
		// stable. Symbols alone miss non-symbol state that feeds bytes (segment
		// bases, `.res` counts); bytes alone would stop early on placeholder
		// streaks while values are still propagating. Each check catches what
		// the other can't see (emplaced segments are byte-invisible but
		// label-visible).
		if (!scopes.changedSince(snapshot) && bytesEqual(output, previous)) {
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
 * map for rendering. Each segment tracks a running location counter - starting
 * at its base from the previous render - so instructions get a pc for branch
 * offsets (same-segment branches are base-invariant, so this converges).
 */
function collect(
	modules: readonly LoadedModule[],
	scopes: Scopes,
	report: Reporter,
	bases: Map<string, bigint>,
	resSizes: Map<string, bigint>,
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
	// Running location per segment (shared across modules) - the pc source for
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
					// A macro-stamped label (a param-named definition threaded through
					// an outer expansion) belongs to the module it binds to.
					moduleId: label.identifier.origin ?? moduleId,
					name: label.identifier.text,
					symbolKind: "label",
					span: [label.identifier.start, label.identifier.end],
				});
			}

			const content = statement.content;
			if (!content) continue;

			switch (content.type) {
				case "import":
					// Resolved by the loader; a namespace binding also claims its
					// name in this module's scope (define-once, like a dict root).
					if (content.binding) {
						const { text, start, end } = content.binding;
						if (
							scopes.defineLocal(moduleId, text, undefined, "namespace", [
								start,
								end,
							])
						) {
							report(`Symbol "${text}" is already defined`, [start, end]);
						}
					}
					break;
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
							resSizes,
							report,
						),
					);
			}
		}
	}

	return segments;
}

function bytesEqual(a: readonly number[], b: readonly number[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
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
		resolve: (name, origin) => scopes.resolve(origin ?? moduleId, name),
		attributesOf: (name, origin) =>
			scopes.attributesOf(origin ?? moduleId, name),
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
	const { text, start, end, origin } = assignment.identifier;
	const span: readonly [number, number] = [start, end];
	const definitionModule = origin ?? moduleId;

	if (assignment.params) {
		// An expression macro: a function-valued symbol. Interned per definition
		// site so the value is identity-stable across passes (the fixpoint
		// compares by identity). The body's free names resolve in this module -
		// stamped tokens carry their own origins.
		let fn = functionValues.get(assignment);
		if (!fn) {
			fn = {
				type: "function",
				params: assignment.params.map((p) => p.text),
				body: assignment.expression,
				moduleId,
			};
			functionValues.set(assignment, fn);
		}
		evaluateAttributes(assignment, env, report); // functions carry none
		if (scopes.defineLocal(definitionModule, text, fn, "function", span)) {
			report(`Symbol "${text}" is already defined`, span);
		}
		return;
	}

	if (assignment.expression.type === "dict-literal") {
		if (assignment.operatorToken.type === ":=") {
			report("A dictionary is a value, not an address - define it with `=`", [
				assignment.operatorToken.start,
				assignment.operatorToken.end,
			]);
		}
		if (assignment.attributes.length) {
			const key = assignment.attributes[0]!.key;
			report("Only labels have attributes - use `:=` for an address", [
				key.start,
				key.end,
			]);
		}
		if (
			scopes.defineLocal(definitionModule, text, undefined, "namespace", span)
		) {
			report(`Symbol "${text}" is already defined`, span);
		}
		defineDict(
			assignment.expression,
			definitionModule,
			text,
			text,
			scopes,
			env,
			report,
		);
		return;
	}

	const value = evaluate(assignment.expression, env);
	const kind = assignment.operatorToken.type === ":=" ? "label" : "constant";
	const attributes = evaluateAttributes(assignment, env, report);
	if (
		scopes.defineLocal(definitionModule, text, value, kind, span, attributes)
	) {
		report(`Symbol "${text}" is already defined`, span);
	}
}

// The placement-attribute tail of a definition. Only labels (`:=`) carry
// attributes; an equate defaults to `size: 1` (one byte) unless declared.
// `size` is the only key so far, and it must be a non-negative number.
function evaluateAttributes(
	assignment: Assignment,
	env: EvalEnv,
	report: Reporter,
): SymbolAttributes | undefined {
	const isLabel = assignment.operatorToken.type === ":=";
	if (!isLabel) {
		const first = assignment.attributes[0];
		if (first) {
			report("Only labels have attributes - use `:=` for an address", [
				first.key.start,
				first.key.end,
			]);
		}
		return undefined;
	}

	const attributes: SymbolAttributes = { size: 1n };
	let sizeDeclared = false;
	for (const attribute of assignment.attributes) {
		const keySpan: readonly [number, number] = [
			attribute.key.start,
			attribute.key.end,
		];
		if (attribute.key.text !== "size") {
			report(`Unknown attribute "${attribute.key.text}"`, keySpan);
			continue;
		}
		if (sizeDeclared) {
			report(`Attribute "size" is already set`, keySpan);
			continue;
		}
		sizeDeclared = true;
		const value = evaluate(attribute.value, env);
		if (value !== undefined && typeof value !== "bigint") {
			report(
				"`size:` requires a number",
				getExpressionLocation(attribute.value),
			);
			continue;
		}
		if (value !== undefined && value < 0n) {
			report(
				"`size:` must not be negative",
				getExpressionLocation(attribute.value),
			);
			continue;
		}
		attributes.size = value; // may be undefined this pass; resolves later
	}
	return attributes;
}

// Lower a dictionary literal to qualified symbols: entry `key` of dict `N`
// becomes the symbol `N<SEP>key`, resolved by `N::key`. Nested dicts recurse;
// entry values are ordinary expressions evaluated in the enclosing module's
// env (their identifiers carry their own hygiene origins).
function defineDict(
	dict: DictLiteral,
	definitionModule: string,
	prefix: string,
	display: string,
	scopes: Scopes,
	env: EvalEnv,
	report: Reporter,
): void {
	for (const entry of dict.entries) {
		const name = prefix + SEP + entry.key.text;
		const path = display + "::" + entry.key.text;
		const span: readonly [number, number] = [entry.key.start, entry.key.end];
		if (entry.value.type === "dict-literal") {
			if (
				scopes.defineLocal(definitionModule, name, undefined, "namespace", span)
			) {
				report(`Symbol "${path}" is already defined`, span);
			}
			defineDict(
				entry.value,
				definitionModule,
				name,
				path,
				scopes,
				env,
				report,
			);
		} else {
			const value = evaluate(entry.value, env);
			if (scopes.defineLocal(definitionModule, name, value, "constant", span)) {
				report(`Symbol "${path}" is already defined`, span);
			}
		}
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
	resSizes: Map<string, bigint>,
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
			// Deferred to render, where the count evaluates at the exact LC - a
			// collect-time count would bake the previous pass's segment base into
			// `*`-relative fills. Collect's running location advances by the
			// previous render's size (one pass of lag the fixpoint absorbs).
			const ordinal = output.items.filter((i) => i.kind === "res").length;
			output.items.push({
				kind: "res",
				expression: content.count,
				moduleId,
				span: getExpressionLocation(content.count),
			});
			return location + (resSizes.get(output.name + "\0" + ordinal) ?? 0n);
		}

		case "instruction": {
			// Multi-operand lists only occur on macro calls (gone by now) and on
			// misused real instructions - encode reports the arity error below.
			const expr = operandExpression(content.operands[0] ?? null);
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

	if (typeof value === "object") {
		report("A function is not data - apply it with `(...)`", span);
		for (let i = 0; i < size; i++) output.push(0);
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
