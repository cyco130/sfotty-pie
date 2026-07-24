import { encodeInstruction } from "./encode.ts";
import { evaluate, type EvalEnv } from "./evaluate.ts";
import { render, Segment } from "./layout.ts";
import { loadModules, type Host, type LoadedModule } from "./loader.ts";
import { expandModules, scopeIfArms } from "./macros.ts";
import { Scopes } from "./scopes.ts";
import {
	getExpressionLocation,
	parse,
	type Assignment,
	type DictLiteral,
	type Expression,
	type IfArm,
	type IfBlock,
	type Message,
	type MessageNote,
	type Operand,
	type Statement,
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

type Reporter = (
	message: string,
	span: readonly [number, number],
	file?: string,
	notes?: MessageNote[],
) => void;

/** A "previously ..." note pointing at `span` in `file`. */
function noteAt(
	message: string,
	span: readonly [number, number],
	file: string,
): MessageNote {
	return { message, start: span[0], end: span[1], file };
}

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
	for (const error of errors) error.file = name;
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
	const expandReport: Reporter = (message, span, file, notes) => {
		priorDiagnostics.push({
			type: "error",
			start: span[0],
			end: span[1],
			message,
			file,
			notes,
		});
	};
	const modules = expandModules(loaded, expandReport);
	// Arm-scope `.if` blocks (also a static, run-once step): names defined
	// inside arms become arm-local so the outside-visible definition set stays
	// pass-invariant while arm selection iterates.
	scopeIfArms(modules, expandReport);

	const scopes = new Scopes(modules);
	let output: number[] = [];
	let diagnostics: Message[] = [];
	let bases = new Map<string, bigint>(); // segment bases from the previous render
	let resSizes = new Map<string, bigint>(); // `res` sizes from the previous render
	let sizes = new Map<string, bigint>(); // segment sizes from the previous render

	// Pessimistic shrink-only sizing is monotone; label values still flow a hop
	// per pass (render defines them after collect). The cap is a generous
	// backstop; `.if` arm statements count too.
	const countStatements = (statements: readonly Statement[]): number =>
		statements.reduce(
			(n, s) =>
				n +
				1 +
				(s.content?.type === "if-block"
					? s.content.arms.reduce((m, a) => m + countStatements(a.body), 0)
					: 0),
			0,
		);
	const statementCount = modules.reduce(
		(n, m) => n + countStatements(m.statements),
		0,
	);
	const cap = Math.max(statementCount + 1, 8);
	let converged = false;

	for (let pass = 0; pass < cap; pass++) {
		const snapshot = scopes.snapshot();
		scopes.beginPass();
		diagnostics = [];
		const report: Reporter = (message, span, file, notes) => {
			diagnostics.push({
				type: "error",
				start: span[0],
				end: span[1],
				message,
				file,
				notes,
			});
		};

		// Collect content into segments (defining constants), then render OUTPUT
		// to bytes (defining labels). Everything evaluates against the previous
		// pass's symbol values and segment bases; this pass produces the new ones.
		const { segments, firstSeen, discards } = collect(
			modules,
			scopes,
			report,
			bases,
			resSizes,
			sizes,
		);

		// Segment sanitation: every defined segment must be consumed - placed
		// with `.emit`/`.emplace` somewhere, or deliberately dropped with
		// `.discard`. This is the typo net: a stray `.segment "CODW"` must not
		// silently orphan its bytes.
		const placedAt = new Map<string, SegmentSite>();
		for (const segment of segments.values()) {
			for (const item of segment.items) {
				if (
					(item.kind === "emit" || item.kind === "emplace") &&
					!placedAt.has(item.segment)
				) {
					placedAt.set(item.segment, {
						span: item.span,
						moduleId: item.moduleId,
					});
				}
			}
		}
		for (const [name, site] of discards) {
			if (!segments.has(name)) {
				report(`Unknown segment "${name}"`, site.span, site.moduleId);
				continue;
			}
			const placed = placedAt.get(name);
			if (placed) {
				report(
					`Segment "${name}" is discarded but also placed`,
					site.span,
					site.moduleId,
					[noteAt("Placed here", placed.span, placed.moduleId)],
				);
			}
		}
		for (const name of segments.keys()) {
			if (name === "OUTPUT" || placedAt.has(name) || discards.has(name)) {
				continue;
			}
			const seen = firstSeen.get(name);
			report(
				`Segment "${name}" is never placed - \`.emit\`, \`.emplace\`, or \`.discard\` it`,
				seen?.span ?? [0, 0],
				seen?.moduleId,
			);
		}

		const result = render(
			segments,
			"OUTPUT",
			(moduleId, name, value, kind, span) => {
				const prior = scopes.defineLocal(moduleId, name, value, kind, span);
				if (prior) {
					report(`Symbol "${name}" is already defined`, span, moduleId, [
						noteAt("First defined here", prior, moduleId),
					]);
				}
			},
			(expression, moduleId, location) =>
				evaluate(expression, moduleEnv(moduleId, scopes, location, report)),
			report,
		);
		const previous = output;
		const previousBases = bases;
		const previousResSizes = resSizes;
		const previousSizes = sizes;
		output = result.bytes;
		bases = result.bases;
		resSizes = result.resSizes;
		sizes = result.sizes;

		// Converged only when the symbol table, the output bytes, AND the
		// layout-feedback maps are all stable. Symbols alone miss non-symbol
		// state that feeds bytes (segment bases, `.res` counts); bytes alone
		// would stop early on placeholder streaks while values are still
		// propagating; and the feedback maps catch what neither can see - a
		// segment placed under an `.if` bounds check may be byte- and
		// symbol-invisible while its size is still one pass from reaching
		// collect's `*`.
		if (
			!scopes.changedSince(snapshot) &&
			bytesEqual(output, previous) &&
			mapsEqual(bases, previousBases) &&
			mapsEqual(resSizes, previousResSizes) &&
			mapsEqual(sizes, previousSizes)
		) {
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

	// A bare `.export name` must name a definition made somewhere in its
	// module, and a symbol may be exported only once (exported macros live in
	// the mnemonic namespace and have their own duplicate check).
	for (const module of modules) {
		const exported = new Map<string, readonly [number, number]>();
		for (const statement of module.statements) {
			const content = statement.content;
			if (content?.type !== "export") continue;
			const nameToken =
				content.nameToken ??
				(content.content?.type === "assignment"
					? content.content.identifier
					: undefined);
			if (!nameToken) continue;
			const priorExport = exported.get(nameToken.text);
			if (priorExport) {
				diagnostics.push({
					type: "error",
					start: nameToken.start,
					end: nameToken.end,
					message: `Symbol "${nameToken.text}" is already exported`,
					file: module.id,
					notes: [noteAt("First exported here", priorExport, module.id)],
				});
			} else {
				exported.set(nameToken.text, [nameToken.start, nameToken.end]);
			}
			if (
				content.nameToken &&
				!content.definesLabel &&
				!scopes.isDefined(module.id, content.nameToken.text)
			) {
				diagnostics.push({
					type: "error",
					start: content.nameToken.start,
					end: content.nameToken.end,
					message: `Exported symbol "${content.nameToken.text}" is never defined`,
					file: module.id,
				});
			}
		}
	}

	// Render each diagnostic to a tsc-style `file:line:col - type: message`
	// block with a source excerpt, when its module is known; notes follow as
	// `note:` blocks in the same shape. Both a plain and an ANSI-colored form
	// are pre-rendered; consumers pick by whether they're writing to a tty.
	const sourceFiles = new Map(loaded.map((m) => [m.id, m.sourceFile]));
	const formatOne = (
		span: { start: number; end: number; file?: string },
		kind: string,
		text: string,
		color: boolean,
	): string => {
		const sourceFile =
			span.file === undefined ? undefined : sourceFiles.get(span.file);
		return sourceFile
			? sourceFile.formatMessage(span.start, span.end, kind, text, {
					showLine: true,
					color,
				})
			: `${kind}: ${text}`;
	};
	const all = [...priorDiagnostics, ...diagnostics];
	for (const message of all) {
		const render = (color: boolean) =>
			[
				formatOne(message, message.type, message.message, color),
				...(message.notes ?? []).map((note) =>
					formatOne(note, "note", note.message, color),
				),
			].join("\n\n");
		message.formatted = render(false);
		message.formattedColor = render(true);
	}

	return {
		output: new Uint8Array(output),
		symbols: scopes.resolvedFor(entryId),
		diagnostics: all,
	};
}

/**
 * Walk the statements, routing content into the current segment (OUTPUT by
 * default, switched by `.segment`) and defining constants. Returns the segment
 * map for rendering. Each segment tracks a running location counter - starting
 * at its base from the previous render - so instructions get a pc for branch
 * offsets (same-segment branches are base-invariant, so this converges).
 */
/** A source location a segment-level diagnostic can point at. */
interface SegmentSite {
	span: readonly [number, number];
	moduleId: string;
}

interface CollectResult {
	segments: Map<string, Segment>;
	/** Each segment's first `.define_segment`/`.segment` site, for diagnostics. */
	firstSeen: Map<string, SegmentSite>;
	/** Each `.discard`ed segment's (first) discard site. */
	discards: Map<string, SegmentSite>;
}

function collect(
	modules: readonly LoadedModule[],
	scopes: Scopes,
	report: Reporter,
	bases: Map<string, bigint>,
	resSizes: Map<string, bigint>,
	sizes: Map<string, bigint>,
): CollectResult {
	const segments = new Map<string, Segment>();
	const firstSeen = new Map<string, SegmentSite>();
	const discards = new Map<string, SegmentSite>();
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

		const collectStatement = (statement: Statement): void => {
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
			if (!content) return;

			switch (content.type) {
				case "import":
					// Resolved by the loader; a namespace binding also claims its
					// name in this module's scope (define-once, like a dict root).
					if (content.binding) {
						const { text, start, end } = content.binding;
						const prior = scopes.defineLocal(
							moduleId,
							text,
							undefined,
							"namespace",
							[start, end],
						);
						if (prior) {
							report(
								`Symbol "${text}" is already defined`,
								[start, end],
								moduleId,
								[noteAt("First defined here", prior, moduleId)],
							);
						}
					}
					break;
				case "define-segment": {
					const name = segmentName(content.nameToken, report, moduleId);
					getSegment(name);
					if (!firstSeen.has(name)) {
						firstSeen.set(name, {
							span: [content.nameToken.start, content.nameToken.end],
							moduleId,
						});
					}
					break;
				}
				case "segment": {
					const name = segmentName(content.nameToken, report, moduleId);
					current = getSegment(name);
					if (!firstSeen.has(name)) {
						firstSeen.set(name, {
							span: [content.nameToken.start, content.nameToken.end],
							moduleId,
						});
					}
					break;
				}
				case "segment-shorthand": {
					// `.code` -> "CODE", `.rodata` -> "RODATA", etc.
					const name = content.keyword.text.slice(1).toUpperCase();
					current = getSegment(name);
					if (!firstSeen.has(name)) {
						firstSeen.set(name, {
							span: [content.keyword.start, content.keyword.end],
							moduleId,
						});
					}
					break;
				}
				case "discard": {
					const name = segmentName(content.nameToken, report, moduleId);
					const span: readonly [number, number] = [
						content.nameToken.start,
						content.nameToken.end,
					];
					const prior = discards.get(name);
					if (prior) {
						report(`Segment "${name}" is already discarded`, span, moduleId, [
							noteAt("First discarded here", prior.span, prior.moduleId),
						]);
					} else {
						discards.set(name, { span, moduleId });
					}
					break;
				}
				case "emit":
				case "emplace": {
					const placed = segmentName(content.nameToken, report, moduleId);
					current.items.push({
						kind: content.type,
						segment: placed,
						moduleId,
						span: [content.nameToken.start, content.nameToken.end],
					});
					// Advance the running location by the placed segment's
					// previous-pass size, so `*` after a placement (an `.if`
					// bounds check, say) is meaningful - one pass of lag the
					// fixpoint absorbs, like `resSizes`.
					locations.set(
						current.name,
						locationOf(current.name) + (sizes.get(placed) ?? 0n),
					);
					break;
				}
				case "export":
					if (content.nameToken) {
						// `.export name:` defines the label here; bare `.export name`
						// only affects the export set (validated after convergence).
						if (content.definesLabel) {
							current.items.push({
								kind: "label",
								moduleId: content.nameToken.origin ?? moduleId,
								name: content.nameToken.text,
								symbolKind: "label",
								span: [content.nameToken.start, content.nameToken.end],
							});
						}
					} else if (content.content?.type === "assignment") {
						defineAssignment(
							content.content,
							moduleId,
							scopes,
							locationOf(current.name),
							report,
						);
					} else {
						report(
							"Only a definition can be exported",
							[content.exportToken.start, content.exportToken.end],
							moduleId,
						);
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
				case "if-block": {
					// Re-decided every pass: collect only the taken arm. Segment
					// switches inside an arm behave like any other statement (they
					// persist past the `.endif`); only names are arm-scoped.
					const arm = selectArm(
						content,
						moduleId,
						scopes,
						locationOf(current.name),
						report,
					);
					for (const armStatement of arm?.body ?? []) {
						collectStatement(armStatement);
					}
					break;
				}
				case "error-directive": {
					const env = moduleEnv(
						moduleId,
						scopes,
						locationOf(current.name),
						report,
					);
					// The keyword's hygiene origin attributes a macro-body `.error`
					// to the macro's file.
					const file = content.errorToken.origin ?? moduleId;
					const value = evaluate(content.message, env);
					// Unresolved parts were already strict-reported; like every
					// diagnostic, the message survives only on the converged pass.
					if (value === undefined) break;
					if (typeof value !== "string") {
						env.report(
							"`.error` requires a string message",
							getExpressionLocation(content.message),
							file,
						);
						break;
					}
					report(
						value,
						[
							content.errorToken.start,
							getExpressionLocation(content.message)[1],
						],
						file,
					);
					break;
				}
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
		};

		for (const statement of module.statements) collectStatement(statement);
	}

	return { segments, firstSeen, discards };
}

/**
 * Pick an `.if` block's taken arm: the first arm whose condition is resolved
 * and nonzero, or the condition-less `.else`. An unresolved condition skips
 * its arm, so everything falls through to `.else` until the values settle -
 * which is why the `.else` arm should hold the pessimistic (always-correct)
 * form. Strict mode reports the unresolved names on the converged pass.
 */
function selectArm(
	block: IfBlock,
	moduleId: string,
	scopes: Scopes,
	location: bigint,
	report: Reporter,
): IfArm | undefined {
	const env = moduleEnv(moduleId, scopes, location, report);
	for (const arm of block.arms) {
		if (arm.condition === null) return arm; // `.else`
		const value = evaluate(arm.condition, env);
		if (value === undefined) continue;
		if (typeof value !== "bigint") {
			env.report(
				"`.if` requires a numeric condition",
				getExpressionLocation(arm.condition),
				arm.keyword.origin,
			);
			continue;
		}
		if (value !== 0n) return arm;
	}
	return undefined;
}

function bytesEqual(a: readonly number[], b: readonly number[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

function mapsEqual(
	a: ReadonlyMap<string, bigint>,
	b: ReadonlyMap<string, bigint>,
): boolean {
	if (a.size !== b.size) return false;
	for (const [key, value] of a) {
		if (b.get(key) !== value) return false;
	}
	return true;
}

function segmentName(
	token: { text: string; start: number; end: number },
	report: Reporter,
	file: string,
): string {
	return decodeStringLiteral(token.text, (escape) =>
		report(
			`Unknown escape sequence "\\${escape}"`,
			[token.start, token.end],
			file,
		),
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
		report: (message, span, file) => report(message, span, file ?? moduleId),
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
		evaluateAttributes(assignment, env, report, definitionModule); // none allowed
		const prior = scopes.defineLocal(
			definitionModule,
			text,
			fn,
			"function",
			span,
		);
		if (prior) {
			report(`Symbol "${text}" is already defined`, span, definitionModule, [
				noteAt("First defined here", prior, definitionModule),
			]);
		}
		return;
	}

	if (assignment.expression.type === "dict-literal") {
		if (assignment.operatorToken.type === ":=") {
			report(
				"A dictionary is a value, not an address - define it with `=`",
				[assignment.operatorToken.start, assignment.operatorToken.end],
				definitionModule,
			);
		}
		if (assignment.attributes.length) {
			const key = assignment.attributes[0]!.key;
			report(
				"Only labels have attributes - use `:=` for an address",
				[key.start, key.end],
				definitionModule,
			);
		}
		const prior = scopes.defineLocal(
			definitionModule,
			text,
			undefined,
			"namespace",
			span,
		);
		if (prior) {
			report(`Symbol "${text}" is already defined`, span, definitionModule, [
				noteAt("First defined here", prior, definitionModule),
			]);
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
	const attributes = evaluateAttributes(
		assignment,
		env,
		report,
		definitionModule,
	);
	const prior = scopes.defineLocal(
		definitionModule,
		text,
		value,
		kind,
		span,
		attributes,
	);
	if (prior) {
		report(`Symbol "${text}" is already defined`, span, definitionModule, [
			noteAt("First defined here", prior, definitionModule),
		]);
	}
}

// The placement-attribute tail of a definition. Only labels (`:=`) carry
// attributes; an equate defaults to `size: 1` (one byte) unless declared.
// `size` is the only key so far, and it must be a non-negative number.
function evaluateAttributes(
	assignment: Assignment,
	env: EvalEnv,
	report: Reporter,
	file: string,
): SymbolAttributes | undefined {
	const isLabel = assignment.operatorToken.type === ":=";
	if (!isLabel) {
		const first = assignment.attributes[0];
		if (first) {
			report(
				"Only labels have attributes - use `:=` for an address",
				[first.key.start, first.key.end],
				file,
			);
		}
		return undefined;
	}

	const attributes: SymbolAttributes = { size: 1n };
	let sizeDeclaredAt: readonly [number, number] | undefined;
	for (const attribute of assignment.attributes) {
		const keySpan: readonly [number, number] = [
			attribute.key.start,
			attribute.key.end,
		];
		if (attribute.key.text !== "size") {
			report(`Unknown attribute "${attribute.key.text}"`, keySpan, file);
			continue;
		}
		if (sizeDeclaredAt) {
			report(`Attribute "size" is already set`, keySpan, file, [
				noteAt("First set here", sizeDeclaredAt, file),
			]);
			continue;
		}
		sizeDeclaredAt = keySpan;
		const value = evaluate(attribute.value, env);
		if (value !== undefined && typeof value !== "bigint") {
			report(
				"`size:` requires a number",
				getExpressionLocation(attribute.value),
				file,
			);
			continue;
		}
		if (value !== undefined && value < 0n) {
			report(
				"`size:` must not be negative",
				getExpressionLocation(attribute.value),
				file,
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
			const prior = scopes.defineLocal(
				definitionModule,
				name,
				undefined,
				"namespace",
				span,
			);
			if (prior) {
				report(`Symbol "${path}" is already defined`, span, definitionModule, [
					noteAt("First defined here", prior, definitionModule),
				]);
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
			const prior = scopes.defineLocal(
				definitionModule,
				name,
				value,
				"constant",
				span,
			);
			if (prior) {
				report(`Symbol "${path}" is already defined`, span, definitionModule, [
					noteAt("First defined here", prior, definitionModule),
				]);
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
				env.report(
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
			const keyword =
				content.type === "byte" ? content.byteToken : content.wordToken;
			const size = content.type === "byte" ? 1 : 2;
			const bytes: number[] = [];
			for (const [expr] of content.list) emitData(expr, env, bytes, size);
			output.items.push({
				kind: "bytes",
				bytes,
				moduleId,
				span: [keyword.start, keyword.end],
			});
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
			const bytes = encodeInstruction(content, value, {
				location,
				report: env.report,
			});
			output.items.push({
				kind: "bytes",
				bytes,
				moduleId,
				span: [content.mnemonic.start, content.mnemonic.end],
			});
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
): void {
	const value = evaluate(expr, env);
	const span = getExpressionLocation(expr);

	if (value === undefined) {
		for (let i = 0; i < size; i++) output.push(0); // placeholder
		return;
	}

	if (typeof value === "object") {
		env.report("A function is not data - apply it with `(...)`", span);
		for (let i = 0; i < size; i++) output.push(0);
		return;
	}

	if (typeof value === "string") {
		if (size === 2) {
			env.report("A string is not allowed in `.word`", span);
			output.push(0, 0);
			return;
		}
		for (const byte of new TextEncoder().encode(value)) output.push(byte);
		return;
	}

	if (size === 1) {
		if (value < -128n || value > 255n)
			env.report(`Byte value out of range: ${value}`, span);
		output.push(Number(value & 0xffn));
	} else {
		if (value < -32768n || value > 65535n)
			env.report(`Word value out of range: ${value}`, span);
		const word = Number(value & 0xffffn);
		output.push(word & 0xff, (word >> 8) & 0xff);
	}
}
