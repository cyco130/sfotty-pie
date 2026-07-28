import { Codes } from "./codes.ts";
import { encodeInstruction } from "./encode.ts";
import { evaluate, type EvalEnv } from "./evaluate.ts";
import { render, Segment } from "./layout.ts";
import { loadModules, type Host, type LoadedModule } from "./loader.ts";
import {
	expandModules,
	resolveAnonymousLabels,
	scopeIfArms,
	scopeLocalLabels,
	type MacroNav,
} from "./macros.ts";
import { Scopes, type ModuleScope, type Reference } from "./scopes.ts";
import {
	forEachIdentifier,
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
	type ExpansionSite,
	getExpressionAnchorToken,
} from "./parser.ts";
import { SourceFile } from "./source-file.ts";
import { SEP, type Definition } from "./symbols.ts";
import {
	decodeStringLiteral,
	type FunctionValue,
	type Value,
} from "./value.ts";

export interface AssembleResult {
	output: Uint8Array;
	symbols: Map<string, Value>;
	/**
	 * Every symbol's definition site, keyed by qualified name (module NUL
	 * name, dictionary paths NUL-joined further - the `Message.symbol`
	 * spelling). Unlike `symbols`, includes unresolved and function-valued
	 * symbols, and covers all modules, not just the entry.
	 */
	definitions: Map<string, Definition>;
	/**
	 * Every resolved symbol reference of the converged pass, per file:
	 * referencing span -> qualified name (a `definitions` key). Powers
	 * position-to-definition queries and find-references.
	 */
	references: Map<string, Reference[]>;
	/** Per-module visibility (imports and export sets), for scope-aware
	 * tooling like completion. */
	moduleScopes: Map<string, ModuleScope>;
	diagnostics: Message[];
}

type Reporter = (
	code: string,
	message: string,
	span: readonly [number, number],
	file?: string,
	options?: { notes?: MessageNote[]; symbol?: string },
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
	const expandReport: Reporter = (code, message, span, file, options) => {
		priorDiagnostics.push({
			type: "error",
			code,
			start: span[0],
			end: span[1],
			message,
			file,
			notes: options?.notes,
			symbol: options?.symbol,
		});
	};
	// Anonymous labels are numbered first: they're positional, so they have to
	// be resolved while the statement stream is still exactly what was written.
	resolveAnonymousLabels(loaded, expandReport);
	// Local labels resolve next, while the stream still reflects what was
	// written: qualifying `@name` before expansion keeps macro hygiene and
	// local scoping from reaching into each other.
	scopeLocalLabels(loaded, expandReport);
	const macroNav: MacroNav = {
		definitions: new Map(),
		references: new Map(),
		exports: new Map(),
	};
	const modules = expandModules(loaded, expandReport, macroNav);
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
	// The final pass's segment/discard bookkeeping, for the discarded-label
	// annotation below.
	let finalSegments = new Map<string, Segment>();
	let finalDiscards = new Map<string, SegmentSite>();

	for (let pass = 0; pass < cap; pass++) {
		const snapshot = scopes.snapshot();
		scopes.beginPass();
		diagnostics = [];
		const report: Reporter = (code, message, span, file, options) => {
			diagnostics.push({
				type: "error",
				code,
				start: span[0],
				end: span[1],
				message,
				file,
				notes: options?.notes,
				symbol: options?.symbol,
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
		finalSegments = segments;
		finalDiscards = discards;

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
				report(
					Codes.UnknownSegment,
					`Unknown segment "${name}"`,
					site.span,
					site.moduleId,
				);
				continue;
			}
			const placed = placedAt.get(name);
			if (placed) {
				report(
					Codes.DiscardedButPlaced,
					`Segment "${name}" is discarded but also placed`,
					site.span,
					site.moduleId,
					{ notes: [noteAt("Placed here", placed.span, placed.moduleId)] },
				);
			}
		}
		for (const name of segments.keys()) {
			if (name === "OUTPUT" || placedAt.has(name) || discards.has(name)) {
				continue;
			}
			const seen = firstSeen.get(name);
			report(
				Codes.NeverPlaced,
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
					report(
						Codes.AlreadyDefined,
						`Symbol "${name}" is already defined`,
						span,
						moduleId,
						{ notes: [noteAt("First defined here", prior, moduleId)] },
					);
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
			code: Codes.DidNotConverge,
			start: 0,
			end: 0,
			message: `Assembly did not converge after ${cap} passes; some operands may be larger than necessary.`,
		});
	}

	// A reference to a label in a discarded segment is an ordinary undefined
	// symbol (the label is never rendered, deliberately) - but bare "undefined"
	// is baffling when the definition is right there in the source, so explain
	// with notes pointing at the definition and the discard. Matching is
	// structural: the diagnostic's `symbol` is resolved from its module via the
	// same scope-resolution rules a real reference uses, so cross-module
	// references (splat or namespaced imports) annotate too, and an unrelated
	// same-named symbol elsewhere never does.
	const discardedLabels = new Map<
		string,
		{ segment: string; label: MessageNote; discard: SegmentSite }
	>();
	for (const [segName, discardSite] of finalDiscards) {
		const segment = finalSegments.get(segName);
		if (!segment) continue;
		for (const item of segment.items) {
			if (item.kind !== "label") continue;
			discardedLabels.set(item.moduleId + SEP + item.name, {
				segment: segName,
				label: noteAt(
					`Defined here, in discarded segment "${segName}"`,
					item.span,
					item.moduleId,
				),
				discard: discardSite,
			});
		}
	}
	const discardedLabelFor = (
		fromModule: string | undefined,
		symbol: string | undefined,
	) => {
		if (fromModule === undefined || symbol === undefined) return undefined;
		const own = fromModule + SEP + symbol;
		if (discardedLabels.has(own)) return discardedLabels.get(own);
		const target = scopes.resolutionTarget(fromModule, symbol);
		return target === undefined ? undefined : discardedLabels.get(target);
	};
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
					code: Codes.AlreadyExported,
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
					code: Codes.ExportNeverDefined,
					start: content.nameToken.start,
					end: content.nameToken.end,
					message: `Exported symbol "${content.nameToken.text}" is never defined`,
					file: module.id,
					symbol: content.nameToken.text,
				});
			}
		}
	}

	// The discarded-label annotation runs after all symbol diagnostics exist
	// (the export walk above included - a bare export of a discarded label
	// deserves the same explanation).
	if (discardedLabels.size) {
		for (const diagnostic of diagnostics) {
			if (
				diagnostic.code !== Codes.UndefinedSymbol &&
				diagnostic.code !== Codes.ExportNeverDefined
			) {
				continue;
			}
			const hit = discardedLabelFor(diagnostic.file, diagnostic.symbol);
			if (!hit) continue;
			(diagnostic.notes ??= []).push(
				hit.label,
				noteAt("Discarded here", hit.discard.span, hit.discard.moduleId),
			);
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
		code: string | undefined,
		text: string,
		color: boolean,
	): string => {
		const sourceFile =
			span.file === undefined ? undefined : sourceFiles.get(span.file);
		return sourceFile
			? sourceFile.formatMessage(span.start, span.end, kind, code, text, {
					showLine: true,
					color,
				})
			: `${kind}${code === undefined ? "" : " " + code}: ${text}`;
	};
	const all = [...priorDiagnostics, ...diagnostics];
	for (const message of all) {
		const render = (color: boolean) =>
			[
				formatOne(message, message.type, message.code, message.message, color),
				...(message.notes ?? []).map((note) =>
					formatOne(note, "note", undefined, note.message, color),
				),
			].join("\n\n");
		message.formatted = render(false);
		message.formattedColor = render(true);
	}

	// Modules get synthetic definitions (file top), so `.import` specifiers
	// navigate like symbol references. Macro navigation (collected once, at
	// expansion) merges in under its own key namespace.
	const definitions = scopes.definitions();
	const references = scopes.references();
	for (const [key, definition] of macroNav.definitions) {
		definitions.set(key, definition);
	}
	for (const [file, list] of macroNav.references) {
		const merged = references.get(file);
		if (merged) merged.push(...list);
		else references.set(file, list);
	}
	for (const module of modules) {
		definitions.set(module.id, {
			file: module.id,
			start: 0,
			end: 0,
			kind: "module",
			value: undefined,
		});
		if (!module.imports.length) continue;
		const list = references.get(module.id) ?? [];
		if (!references.has(module.id)) references.set(module.id, list);
		for (const record of module.imports) {
			list.push({
				start: record.span[0],
				end: record.span[1],
				symbol: record.id,
			});
		}
	}

	return {
		output: new Uint8Array(output),
		symbols: scopes.resolvedFor(entryId),
		definitions,
		references,
		moduleScopes: scopes.moduleScopes(macroNav.exports),
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
								Codes.AlreadyDefined,
								`Symbol "${text}" is already defined`,
								[start, end],
								moduleId,
								{ notes: [noteAt("First defined here", prior, moduleId)] },
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
						report(
							Codes.AlreadyDiscarded,
							`Segment "${name}" is already discarded`,
							span,
							moduleId,
							{
								notes: [
									noteAt("First discarded here", prior.span, prior.moduleId),
								],
							},
						);
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
						// only affects the export set (validated after convergence) -
						// but it *references* the symbol, so record it: rename and
						// find-references must cover the export statement too.
						if (content.definesLabel) {
							current.items.push({
								kind: "label",
								moduleId: content.nameToken.origin ?? moduleId,
								name: content.nameToken.text,
								symbolKind: "label",
								span: [content.nameToken.start, content.nameToken.end],
							});
						} else {
							scopes.recordReference(
								content.nameToken.origin ?? moduleId,
								content.nameToken.text,
								[content.nameToken.start, content.nameToken.end],
							);
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
							Codes.OnlyDefinitionExportable,
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
							Codes.ErrorMessageType,
							"`.error` requires a string message",
							getExpressionLocation(content.message),
							file,
						);
						break;
					}
					report(
						Codes.UserError,
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
							statement.expansionTrail,
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
				Codes.IfConditionType,
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
			Codes.UnknownEscape,
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
		resolve: (name, origin, span) => {
			if (span) scopes.recordReference(origin ?? moduleId, name, span);
			return scopes.resolve(origin ?? moduleId, name);
		},
		locationCounter: location,
		report: (code, message, span, file, options) =>
			report(code, message, span, file ?? moduleId, options),
		strict: true,
	};
}

/**
 * Define a dictionary literal's entries as table symbols under qualified
 * names (`N SEP key`, nesting for nested literals), spanned by their key
 * tokens. This is what makes `N::key` (and `lib::N::key`) a definition-site
 * target: the path evaluator records key segments against these. Only the
 * literal site defines entries - an alias (`M = N`) or a computed dict
 * carries the value but not the names, so its keys aren't navigable.
 */
function defineDictEntries(
	base: string,
	literal: DictLiteral,
	value: Value | undefined,
	definitionModule: string,
	scopes: Scopes,
): void {
	if (typeof value !== "object" || value.type !== "dict") return;
	const seen = new Set<string>();
	for (const entry of literal.entries) {
		const key = entry.key.text;
		if (seen.has(key)) continue; // duplicate key - first wins, like evaluate
		seen.add(key);
		const qualified = base + SEP + key;
		const entryValue = value.entries.get(key);
		const nested = entry.value.type === "dict-literal";
		// Duplicates are impossible here (the parent was define-once checked),
		// so the prior-definition return needs no handling.
		scopes.defineLocal(
			definitionModule,
			qualified,
			entryValue,
			nested ? "namespace" : "constant",
			[entry.key.start, entry.key.end],
		);
		if (entry.value.type === "dict-literal") {
			defineDictEntries(
				qualified,
				entry.value,
				entryValue,
				definitionModule,
				scopes,
			);
		}
	}
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
		checkAttributes(assignment, report, definitionModule); // none allowed
		// Params become table symbols under the function's name (like dict
		// entries), and body occurrences record as references - so rename,
		// find-references, and unused detection see them. Values stay
		// undefined: application binds eagerly through its own overlay.
		const paramNames = new Set(fn.params);
		for (const param of assignment.params) {
			scopes.defineLocal(
				definitionModule,
				text + SEP + param.text,
				undefined,
				"parameter",
				[param.start, param.end],
			);
		}
		forEachIdentifier(assignment.expression, (token) => {
			if (paramNames.has(token.text) && token.origin === undefined) {
				scopes.recordReference(definitionModule, text + SEP + token.text, [
					token.start,
					token.end,
				]);
			}
		});
		const prior = scopes.defineLocal(
			definitionModule,
			text,
			fn,
			"function",
			span,
		);
		if (prior) {
			report(
				Codes.AlreadyDefined,
				`Symbol "${text}" is already defined`,
				span,
				definitionModule,
				{ notes: [noteAt("First defined here", prior, definitionModule)] },
			);
		}
		return;
	}

	if (assignment.expression.type === "dict-literal") {
		const literal = assignment.expression;
		if (assignment.operatorToken.type === ":=") {
			report(
				Codes.DictionaryIsAValue,
				"A dictionary is a value, not an address - define it with `=`",
				[assignment.operatorToken.start, assignment.operatorToken.end],
				definitionModule,
			);
		}
		if (assignment.attributes.length) {
			const key = assignment.attributes[0]!.key;
			report(
				Codes.OnlyLabelsHaveAttributes,
				"Only labels have attributes - use `:=` for an address",
				[key.start, key.end],
				definitionModule,
			);
		}
		checkNoSelfReference(assignment.expression, text, report, definitionModule);
		const value = evaluate(assignment.expression, env);
		const prior = scopes.defineLocal(
			definitionModule,
			text,
			value,
			"namespace",
			span,
		);
		if (prior) {
			report(
				Codes.AlreadyDefined,
				`Symbol "${text}" is already defined`,
				span,
				definitionModule,
				{ notes: [noteAt("First defined here", prior, definitionModule)] },
			);
		} else {
			defineDictEntries(text, literal, value, definitionModule, scopes);
		}
		return;
	}

	const value = evaluate(assignment.expression, env);
	const kind = assignment.operatorToken.type === ":=" ? "label" : "constant";
	checkAttributes(assignment, report, definitionModule);
	const prior = scopes.defineLocal(definitionModule, text, value, kind, span);
	if (prior) {
		report(
			Codes.AlreadyDefined,
			`Symbol "${text}" is already defined`,
			span,
			definitionModule,
			{ notes: [noteAt("First defined here", prior, definitionModule)] },
		);
	}
}

// The placement-attribute tail of a definition. Attribute *semantics* are
// deferred until the address-vs-number value split lands, so the tail is
// checked for shape and then discarded: the value expression is never
// evaluated and nothing is stored. The shape rules are the ones that stay true
// under any future semantics - only labels (`:=`) may carry a tail, `size` is
// the only key, and a key may be given once - so source written today keeps
// meaning what it means when attributes come back.
function checkAttributes(
	assignment: Assignment,
	report: Reporter,
	file: string,
): void {
	if (assignment.operatorToken.type !== ":=") {
		const first = assignment.attributes[0];
		if (first) {
			report(
				Codes.OnlyLabelsHaveAttributes,
				"Only labels have attributes - use `:=` for an address",
				[first.key.start, first.key.end],
				file,
			);
		}
		return;
	}

	let sizeDeclaredAt: readonly [number, number] | undefined;
	for (const attribute of assignment.attributes) {
		const keySpan: readonly [number, number] = [
			attribute.key.start,
			attribute.key.end,
		];
		if (attribute.key.text !== "size") {
			report(
				Codes.UnknownAttributeKey,
				`Unknown attribute "${attribute.key.text}"`,
				keySpan,
				file,
			);
			continue;
		}
		if (sizeDeclaredAt) {
			report(
				Codes.SizeAlreadySet,
				`Attribute "size" is already set`,
				keySpan,
				file,
				{ notes: [noteAt("First set here", sizeDeclaredAt, file)] },
			);
			continue;
		}
		sizeDeclaredAt = keySpan;
	}
}

// `N = { A: N }` would nest one level deeper every pass, so a dictionary may
// not mention its own name as a bare value. Using it as the base of a path is
// fine, and genuinely useful: `N = { foo: 1, bar: N::foo + 1 }` reads a
// sibling entry, which the fixpoint settles like any other forward reference.
// Matching is by text alone, so a same-named symbol from another module can't
// be reached from inside a literal being bound to that name - an acceptable
// trade for a check that costs nothing.
function checkNoSelfReference(
	dict: DictLiteral,
	name: string,
	report: Reporter,
	file: string,
): void {
	const walk = (expr: Expression): void => {
		switch (expr.type) {
			case "identifier":
				if (expr.text === name) {
					report(
						Codes.SelfReferentialDict,
						`A dictionary cannot contain itself - "${name}" names the dictionary being defined (a path like \`${name}::key\` is fine)`,
						[expr.start, expr.end],
						file,
					);
				}
				return;
			case "member-expression": {
				// A path's root selects entries; it isn't a use of the whole value.
				let object: Expression = expr.object;
				while (object.type === "member-expression") object = object.object;
				if (object.type !== "identifier") walk(object);
				return;
			}
			case "grouped-expression":
			case "prefix-expression":
				walk(expr.expression);
				return;
			case "infix-expression":
				walk(expr.left);
				walk(expr.right);
				return;
			case "call-expression":
				walk(expr.callee);
				for (const argument of expr.args) walk(argument);
				return;
			case "dict-literal":
				for (const entry of expr.entries) walk(entry.value);
				return;
			default:
				return; // literals and `*`
		}
	};
	for (const entry of dict.entries) walk(entry.value);
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
	trail?: readonly ExpansionSite[],
): bigint {
	const env = moduleEnv(moduleId, scopes, location, report);

	switch (content.type) {
		case "org": {
			const value = evaluate(content.expression, env);
			if (value === undefined) return location; // keep; resolves later
			if (typeof value !== "bigint") {
				env.report(
					Codes.OrgRequiresNumber,
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
			// In a macro-expanded instruction (stamped mnemonic), an encode
			// error attributed elsewhere - typically to a spliced call-site
			// argument - gets notes narrating the expansion path, outermost
			// first. Each hop underlines the failing value *as written in
			// that macro's body* (the anchor token's splice chain aligns with
			// the innermost hops), falling back to the hop's call site when
			// the value didn't pass through it; a hop that would just repeat
			// the error's own span is dropped.
			const expansion = content.mnemonic.origin;
			const splices = expr
				? (getExpressionAnchorToken(expr)?.substitutedAt ?? [])
				: [];
			const bytes = encodeInstruction(content, value, {
				location,
				report: (code, message, span, file) => {
					let notes: MessageNote[] | undefined;
					if (
						expansion !== undefined &&
						(file ?? moduleId) !== expansion &&
						trail?.length
					) {
						const hops = [...trail].reverse();
						notes = [];
						for (let i = 0; i < hops.length; i++) {
							const splice = splices[i - (hops.length - splices.length)];
							const at = splice ?? hops[i]!;
							if (
								at.file === (file ?? moduleId) &&
								at.start === span[0] &&
								at.end === span[1]
							) {
								continue;
							}
							notes.push(
								noteAt(
									`While expanding \`${hops[i]!.macro}\``,
									[at.start, at.end],
									at.file,
								),
							);
						}
					}
					env.report(
						code,
						message,
						span,
						file,
						notes?.length ? { notes } : undefined,
					);
				},
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
		const [code, message] =
			value.type === "dict"
				? ([
						Codes.DictionaryAsData,
						"A dictionary is not data - select an entry with `::`",
					] as const)
				: ([
						Codes.FunctionAsData,
						"A function is not data - apply it with `(...)`",
					] as const);
		env.report(code, message, span);
		for (let i = 0; i < size; i++) output.push(0);
		return;
	}

	if (typeof value === "string") {
		if (size === 2) {
			env.report(
				Codes.StringInWord,
				"A string is not allowed in `.word`",
				span,
			);
			output.push(0, 0);
			return;
		}
		for (const byte of new TextEncoder().encode(value)) output.push(byte);
		return;
	}

	if (size === 1) {
		if (value < -128n || value > 255n)
			env.report(
				Codes.ByteOutOfRange,
				`Byte value out of range: ${value}`,
				span,
			);
		output.push(Number(value & 0xffn));
	} else {
		if (value < -32768n || value > 65535n)
			env.report(
				Codes.WordOutOfRange,
				`Word value out of range: ${value}`,
				span,
			);
		const word = Number(value & 0xffffn);
		output.push(word & 0xff, (word >> 8) & 0xff);
	}
}
