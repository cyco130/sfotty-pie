import { Codes } from "./codes.ts";
import type { Token } from "./lexer.ts";
import type { LoadedModule } from "./loader.ts";
import {
	ANONYMOUS_LABEL,
	getOperandLocation,
	type Expression,
	type Label,
	type Macro,
	type MessageNote,
	type Operand,
	type Statement,
	type StatementContent,
} from "./parser.ts";
import { exportedNames } from "./scopes.ts";

type Reporter = (
	code: string,
	message: string,
	span: readonly [number, number],
	file?: string,
	options?: { notes?: MessageNote[]; symbol?: string },
) => void;

// A param substitutes to an argument operand; a body-local label renames.
type Substitution =
	| { kind: "operand"; operand: Operand }
	| { kind: "rename"; name: string };

const MAX_DEPTH = 64;

interface ModuleMacros {
	own: Map<string, Macro>;
	exported: ReadonlySet<string>;
}

/**
 * Expand macros across a module graph - a static, syntactic step that runs
 * once before assembly. `.macro` definitions (and `.export .macro` ones) are
 * collected and removed from each module's stream; each call (an instruction
 * whose mnemonic names a visible macro) is replaced by the body with params
 * substituted and body-local labels renamed uniquely per expansion.
 *
 * Macro visibility mirrors symbol scoping: a module sees its own macros plus
 * the *exported* macros of the modules it imports. Expansion is hygienic - a
 * free name in a body is stamped with the defining module's id so it resolves
 * where the macro was defined, not where it was called; params are the only
 * call-site channel.
 */
export function expandModules(
	modules: readonly LoadedModule[],
	report: Reporter,
): LoadedModule[] {
	// Collect each module's macro definitions, removing them from its stream.
	const macros = new Map<string, ModuleMacros>();
	const splats = new Map<string, readonly string[]>();
	const bindings = new Map<string, ReadonlyMap<string, string>>();
	const stripped = new Map<string, Statement[]>();
	for (const module of modules) {
		splats.set(
			module.id,
			module.imports.filter((i) => i.binding === null).map((i) => i.id),
		);
		bindings.set(
			module.id,
			new Map(
				module.imports
					.filter((i) => i.binding !== null)
					.map((i) => [i.binding!, i.id]),
			),
		);
		const own = new Map<string, Macro>();
		const exported = new Set<string>();
		const rest: Statement[] = [];
		for (const statement of module.statements) {
			const content = statement.content;
			let macro: Macro | undefined;
			let isExported = false;
			if (content?.type === "macro") {
				macro = content;
			} else if (
				content?.type === "export" &&
				content.content?.type === "macro"
			) {
				macro = content.content;
				isExported = true;
			}
			if (!macro) {
				rest.push(statement);
				continue;
			}
			const name = macro.nameToken.text;
			const prior = own.get(name);
			if (prior) {
				report(
					Codes.MacroAlreadyDefined,
					`Macro "${name}" is already defined`,
					tokenSpan(macro.nameToken),
					module.id,
					{
						notes: [
							{
								message: "First defined here",
								start: prior.nameToken.start,
								end: prior.nameToken.end,
								file: module.id,
							},
						],
					},
				);
			} else {
				own.set(name, macro);
				if (isExported) exported.add(name);
				checkBody(macro, report, module.id);
			}
		}
		macros.set(module.id, { own, exported });
		stripped.set(module.id, rest);
	}

	// Lexical lookup: own macros, then the splat imports' exported ones (first
	// import wins, mirroring symbol resolution).
	const lookup = (
		fromId: string,
		name: string,
	): { macro: Macro; definingId: string } | undefined => {
		const own = macros.get(fromId)?.own.get(name);
		if (own) return { macro: own, definingId: fromId };
		for (const importId of splats.get(fromId) ?? []) {
			const theirs = macros.get(importId);
			if (theirs?.exported.has(name)) {
				return { macro: theirs.own.get(name)!, definingId: importId };
			}
		}
		return undefined;
	};

	// A namespaced call `ns::name args`: the root must be a namespace binding
	// of the calling scope, the segment an exported macro of the bound module.
	const lookupPath = (
		fromId: string,
		call: Extract<StatementContent, { type: "instruction" }>,
	): { macro: Macro; definingId: string } | undefined => {
		const path = call.memberTokens!;
		const bound = bindings.get(fromId)?.get(call.mnemonic.text);
		if (bound === undefined || path.length !== 1) return undefined;
		const theirs = macros.get(bound);
		const name = path[0]!.text;
		if (theirs?.exported.has(name)) {
			return { macro: theirs.own.get(name)!, definingId: bound };
		}
		return undefined;
	};

	// `.out` contract checks, for every macro, used or not. The callee's
	// signature is known here, so forwarding (passing a param on to a nested
	// call's `.out` position) is recognized per argument position.
	for (const module of modules) {
		for (const macro of macros.get(module.id)!.own.values()) {
			validateParams(
				macro,
				(name) => lookup(module.id, name)?.macro,
				report,
				module.id,
			);
		}
	}

	let counter = 0;
	const expanded = new Set<Macro>();

	// `scopeId` is the module whose macros are lexically in scope: the module
	// being expanded for its top-level statements, the *defining* module for a
	// body (so a body's own macro calls resolve where the macro was written).
	const expand = (
		statements: Statement[],
		scopeId: string,
		depth: number,
	): Statement[] => {
		if (depth > MAX_DEPTH) {
			const first = statements[0];
			if (first) {
				report(
					Codes.ExpansionTooDeep,
					"Macro expansion too deep (recursion?)",
					statementSpan(first),
					scopeId,
				);
			}
			return statements;
		}

		const out: Statement[] = [];
		for (const statement of statements) {
			const content = statement.content;
			if (content?.type === "instruction" && content.memberTokens?.length) {
				// A path is necessarily a macro call - no opcode has `::`.
				const found = lookupPath(scopeId, content);
				if (!found) {
					report(
						Codes.UnknownMacro,
						`Unknown macro "${[content.mnemonic, ...content.memberTokens]
							.map((t) => t.text)
							.join("::")}"`,
						tokenSpan(content.mnemonic),
						scopeId,
					);
					continue;
				}
				expanded.add(found.macro);
				const args = callArgs(content, found.macro, report, scopeId);
				if (args) {
					const body = expandCall(
						found.macro,
						found.definingId,
						args,
						() => ++counter,
						report,
					);
					if (statement.labels.length && body.length) {
						body[0] = {
							...body[0]!,
							labels: [...statement.labels, ...body[0]!.labels],
						};
					} else if (statement.labels.length) {
						out.push({ ...statement, content: null });
					}
					out.push(...expand(body, found.definingId, depth + 1));
				}
				continue;
			}
			if (content?.type === "instruction") {
				const found = lookup(scopeId, content.mnemonic.text);
				if (found) {
					expanded.add(found.macro);
					const args = callArgs(content, found.macro, report, scopeId);
					if (args) {
						const body = expandCall(
							found.macro,
							found.definingId,
							args,
							() => ++counter,
							report,
						);
						// Carry the call's own labels onto the first expanded statement.
						if (statement.labels.length && body.length) {
							body[0] = {
								...body[0]!,
								labels: [...statement.labels, ...body[0]!.labels],
							};
						} else if (statement.labels.length) {
							out.push({ ...statement, content: null });
						}
						out.push(...expand(body, found.definingId, depth + 1));
					}
					continue;
				}
			}
			out.push(statement);
		}
		return out;
	};

	const result = modules.map((module) => ({
		...module,
		statements: expand(stripped.get(module.id)!, module.id, 0),
	}));

	// Definition-site check for macros that were never expanded: every free name
	// in the body must be resolvable where the macro is defined. (Expanded
	// bodies get this for free - their stamped identifiers hit the normal
	// undefined-symbol check during assembly.)
	const expandedById = new Map(result.map((m) => [m.id, m]));
	for (const module of result) {
		const own = macros.get(module.id)!.own;
		let visible: Set<string> | undefined; // built lazily; rarely needed
		for (const macro of own.values()) {
			if (expanded.has(macro)) continue;
			if (!visible) {
				visible = definedNames(module.statements);
				for (const record of module.imports) {
					if (record.binding !== null) continue; // reachable via the binding
					const imported = expandedById.get(record.id);
					if (imported) {
						for (const name of exportedNames(imported)) visible.add(name);
					}
				}
			}
			validateBody(
				macro,
				visible,
				(name) => lookup(module.id, name) !== undefined,
				report,
				module.id,
			);
		}
	}

	return result;
}

// Module-level directives can't appear in a macro body (`.if` arms
// included): the loader resolves imports from top-level statements only, and
// an export or a nested macro definition would escape the expansion.
function checkBody(macro: Macro, report: Reporter, file: string): void {
	const walk = (statements: readonly Statement[]): void => {
		for (const statement of statements) {
			const content = statement.content;
			const keyword =
				content?.type === "import"
					? content.importToken
					: content?.type === "export"
						? content.exportToken
						: content?.type === "macro"
							? content.macroToken
							: undefined;
			if (content && keyword) {
				report(
					Codes.DirectiveInMacroBody,
					`\`.${content.type}\` is not allowed inside a macro body`,
					tokenSpan(keyword),
					file,
				);
			}
			if (content?.type === "if-block") {
				for (const arm of content.arms) walk(arm.body);
			}
		}
	};
	walk(macro.body);
}

// A macro argument is a whole *operand*, shape included - `mva (src),y, (dst),y`
// passes two indirect-indexed operands. Operand is a super-type of simple
// values: a simple operand is a plain expression and substitutes anywhere; a
// shaped operand only substitutes as a whole operand (a type error elsewhere).
function callArgs(
	call: Extract<StatementContent, { type: "instruction" }>,
	macro: Macro,
	report: Reporter,
	file: string,
): Operand[] | undefined {
	const args = call.operands;
	if (args.length !== macro.params.length) {
		report(
			Codes.MacroArity,
			`Macro "${macro.nameToken.text}" expects ${macro.params.length} argument(s), got ${args.length}`,
			tokenSpan(call.mnemonic),
			file,
		);
		return undefined;
	}
	for (let i = 0; i < args.length; i++) {
		const param = macro.params[i]!;
		const arg = args[i]!;
		if (
			param.outToken &&
			(arg.type !== "simple-operand" || arg.expression.type !== "identifier")
		) {
			report(
				Codes.OutArgumentShape,
				`Argument for \`.out\` parameter "${param.nameToken.text}" must be a plain identifier`,
				getOperandLocation(arg),
				file,
			);
			return undefined;
		}
	}
	return args;
}

// The `.out` contract: an `.out` param must be defined by the body (a label,
// an assignment, or forwarding to a nested call's `.out` position) - reads
// are additionally allowed; a plain param must not be defined or forwarded.
// Definitions inside `.if` arms don't count for either side: arm definitions
// are arm-local, so they could never reach the caller - defining a param
// there is its own error.
function validateParams(
	macro: Macro,
	getMacro: (name: string) => Macro | undefined,
	report: Reporter,
	file: string,
): void {
	if (!macro.params.length) return;
	const direct = new Set<string>();
	const inArm = new Set<string>();
	const walk = (statements: readonly Statement[], insideArm: boolean): void => {
		const defs = insideArm ? inArm : direct;
		for (const statement of statements) {
			for (const label of statement.labels) defs.add(label.identifier.text);
			const content = statement.content;
			if (content?.type === "assignment") defs.add(content.identifier.text);
			if (content?.type === "if-block") {
				for (const arm of content.arms) walk(arm.body, true);
			}
			if (content?.type === "instruction") {
				const callee = getMacro(content.mnemonic.text);
				if (!callee) continue;
				content.operands.forEach((operand, i) => {
					if (
						callee.params[i]?.outToken &&
						operand.type === "simple-operand" &&
						operand.expression.type === "identifier"
					) {
						defs.add(operand.expression.text);
					}
				});
			}
		}
	};
	walk(macro.body, false);
	for (const param of macro.params) {
		const name = param.nameToken.text;
		if (inArm.has(name)) {
			report(
				Codes.ParamDefinedInArm,
				`Parameter "${name}" is defined inside an \`.if\` arm - arm definitions are arm-local`,
				tokenSpan(param.nameToken),
				file,
			);
		} else if (param.outToken) {
			if (!direct.has(name)) {
				report(
					Codes.OutNeverDefined,
					`\`.out\` parameter "${name}" is never defined in the macro body`,
					tokenSpan(param.nameToken),
					file,
				);
			}
		} else if (direct.has(name)) {
			report(
				Codes.ParamNeedsOut,
				`Parameter "${name}" is defined in the macro body - declare it \`.out\``,
				tokenSpan(param.nameToken),
				file,
			);
		}
	}
}

function expandCall(
	macro: Macro,
	definingId: string,
	args: Operand[],
	gensym: () => number,
	report: Reporter,
): Statement[] {
	const subst = new Map<string, Substitution>();
	macro.params.forEach((param, i) => {
		subst.set(param.nameToken.text, { kind: "operand", operand: args[i]! });
	});
	const suffix = `@${gensym()}`;
	for (const name of localNames(macro.body)) {
		if (!subst.has(name)) {
			subst.set(name, { kind: "rename", name: name + suffix });
		}
	}

	// Clone the template so substitution (which mutates) is per-expansion.
	const body = structuredClone(macro.body);
	for (const statement of body) {
		substituteStatement(statement, subst, definingId, report);
	}
	return body;
}

// Names defined inside the body (labels and assignments, `.if` arms
// included) are local to each expansion; references to anything else bind in
// the defining module.
function localNames(body: Statement[]): Set<string> {
	const names = new Set<string>();
	const walk = (statements: readonly Statement[]): void => {
		for (const statement of statements) {
			for (const label of statement.labels) names.add(label.identifier.text);
			const content = statement.content;
			if (content?.type === "assignment") names.add(content.identifier.text);
			if (content?.type === "if-block") {
				for (const arm of content.arms) walk(arm.body);
			}
		}
	};
	walk(body);
	return names;
}

// Names defined directly by these statements - labels and assignments, but
// NOT inside nested `.if` blocks (those belong to the nested arms).
function directNames(statements: readonly Statement[]): Set<string> {
	const names = new Set<string>();
	for (const statement of statements) {
		for (const label of statement.labels) names.add(label.identifier.text);
		if (statement.content?.type === "assignment") {
			names.add(statement.content.identifier.text);
		}
	}
	return names;
}

function substituteStatement(
	statement: Statement,
	subst: Map<string, Substitution>,
	origin: string,
	report: Reporter,
): void {
	for (const label of statement.labels) {
		label.identifier = substituteName(label.identifier, subst, origin, report);
	}
	if (statement.content) {
		substituteContent(statement.content, subst, origin, report);
	}
}

// A defining occurrence (a label or an assignment name). A param here must be
// bound to a plain identifier - that's the outward channel: the definition
// lands under the caller's name, in the caller's scope.
function substituteName(
	identifier: Token<"identifier">,
	subst: Map<string, Substitution>,
	origin: string,
	report: Reporter,
): Token<"identifier"> {
	const s = subst.get(identifier.text);
	// A renamed local is stamped like a free name: its token spans the macro's
	// source, so its definition must live in the macro's module for spans and
	// scope to agree (definition-site queries rely on this).
	if (s?.kind === "rename") {
		return {
			...identifier,
			text: s.name,
			origin: identifier.origin ?? origin,
		};
	}
	if (s?.kind === "operand") {
		if (
			s.operand.type === "simple-operand" &&
			s.operand.expression.type === "identifier"
		) {
			return structuredClone(s.operand.expression);
		}
		report(
			Codes.ArgumentMustBeIdentifier,
			`Macro argument for "${identifier.text}" defines a name and must be a plain identifier`,
			tokenSpan(identifier),
			origin,
		);
	}
	return identifier;
}

function substituteContent(
	content: StatementContent,
	subst: Map<string, Substitution>,
	origin: string,
	report: Reporter,
): void {
	switch (content.type) {
		case "byte":
		case "word":
			content.list = content.list.map(([e, comma]) => [
				substituteExpr(e, subst, origin, report),
				comma,
			]);
			break;
		case "org":
			content.expression = substituteExpr(
				content.expression,
				subst,
				origin,
				report,
			);
			break;
		case "res":
			content.count = substituteExpr(content.count, subst, origin, report);
			break;
		case "assignment": {
			// An expression macro's params shadow the (code) macro's substitution
			// inside its body - `F(x) = x + 1` keeps its own `x`.
			const shadowed = content.params
				? new Set(content.params.map((p) => p.text))
				: undefined;
			content.expression = substituteExpr(
				content.expression,
				subst,
				origin,
				report,
				shadowed,
			);
			// Attribute values are currently discarded unevaluated, but keep
			// substituting into them so the tail stays a correctly-bound AST for
			// when attribute semantics return.
			content.attributes = content.attributes.map((attribute) => ({
				...attribute,
				value: substituteExpr(attribute.value, subst, origin, report),
			}));
			content.identifier = substituteName(
				content.identifier,
				subst,
				origin,
				report,
			);
			break;
		}
		case "instruction":
			content.operands = content.operands.map((operand) =>
				substituteOperand(operand, subst, origin, report),
			);
			break;
		case "if-block":
			// One map for the whole block is right here: macro params substitute
			// everywhere, and arm-local visibility is the later arm-scoping
			// pass's job. The keywords get origin-stamped so diagnostics whose
			// span is the keyword itself attribute to the macro's file.
			for (const arm of content.arms) {
				arm.keyword.origin = arm.keyword.origin ?? origin;
				if (arm.condition) {
					arm.condition = substituteExpr(arm.condition, subst, origin, report);
				}
				for (const statement of arm.body) {
					substituteStatement(statement, subst, origin, report);
				}
			}
			break;
		case "error-directive":
			content.errorToken.origin = content.errorToken.origin ?? origin;
			content.message = substituteExpr(content.message, subst, origin, report);
			break;
		// Segment directives carry no substitutable expressions; import/export/
		// macro are rejected from bodies at collection.
		default:
			break;
	}
}

// A param standing alone in operand position (`lda src`) splices the whole
// argument operand, shape included. A param inside a composite operand
// (`#src`, `src,x`, `(src),y`) is in expression position - `substituteExpr`
// type-checks it there.
function substituteOperand(
	operand: Operand,
	subst: Map<string, Substitution>,
	origin: string,
	report: Reporter,
): Operand {
	if (operand.type === "accumulator-operand") return operand;
	if (
		operand.type === "simple-operand" &&
		operand.expression.type === "identifier"
	) {
		const s = subst.get(operand.expression.text);
		if (s?.kind === "operand") return structuredClone(s.operand);
	}
	return {
		...operand,
		expression: substituteExpr(operand.expression, subst, origin, report),
	} as Operand;
}

function substituteExpr(
	expr: Expression,
	subst: Map<string, Substitution>,
	origin: string,
	report: Reporter,
	shadowed?: ReadonlySet<string>,
): Expression {
	switch (expr.type) {
		case "identifier": {
			// An expression-macro param: neither substituted nor stamped - it
			// binds at application time.
			if (shadowed?.has(expr.text)) return expr;
			const s = subst.get(expr.text);
			if (s?.kind === "operand") {
				// Operand is a super-type of simple values: only a simple operand
				// (a plain expression) has a value usable inside an expression.
				if (s.operand.type === "simple-operand") {
					return structuredClone(s.operand.expression);
				}
				report(
					Codes.ShapedArgumentInExpression,
					`Macro argument "${expr.text}" has an operand value and can only be used as a whole operand`,
					tokenSpan(expr),
					origin,
				);
				return expr;
			}
			// Stamped like the defining occurrence in `substituteName`, so
			// renamed references resolve where the renamed definition lands.
			if (s?.kind === "rename") {
				return { ...expr, text: s.name, origin: expr.origin ?? origin };
			}
			// A free name binds where the macro was defined (hygiene). An already
			// stamped identifier (from an outer expansion's argument) keeps its
			// binding.
			return { ...expr, origin: expr.origin ?? origin };
		}
		case "prefix-expression":
			return {
				...expr,
				expression: substituteExpr(
					expr.expression,
					subst,
					origin,
					report,
					shadowed,
				),
			};
		case "infix-expression":
			return {
				...expr,
				left: substituteExpr(expr.left, subst, origin, report, shadowed),
				right: substituteExpr(expr.right, subst, origin, report, shadowed),
			};
		case "grouped-expression":
			return {
				...expr,
				expression: substituteExpr(
					expr.expression,
					subst,
					origin,
					report,
					shadowed,
				),
			};
		case "member-expression":
			return {
				...expr,
				object: substituteExpr(expr.object, subst, origin, report, shadowed),
			};
		case "dict-literal":
			return {
				...expr,
				entries: expr.entries.map((entry) => ({
					...entry,
					value: substituteExpr(entry.value, subst, origin, report, shadowed),
				})),
			};
		case "call-expression":
			return {
				...expr,
				callee: substituteExpr(expr.callee, subst, origin, report, shadowed),
				args: expr.args.map((arg) =>
					substituteExpr(arg, subst, origin, report, shadowed),
				),
			};
		default:
			return expr; // literals and `*`
	}
}

// Top-level defining occurrences of a module, post-expansion. Namespace
// bindings count - `ns::x` in an unexpanded body roots at `ns`.
function definedNames(statements: readonly Statement[]): Set<string> {
	const names = new Set<string>();
	for (const statement of statements) {
		for (const label of statement.labels) names.add(label.identifier.text);
		const content = statement.content;
		if (content?.type === "assignment") names.add(content.identifier.text);
		if (content?.type === "export" && content.content?.type === "assignment") {
			names.add(content.content.identifier.text);
		}
		if (
			content?.type === "export" &&
			content.nameToken &&
			content.definesLabel
		) {
			names.add(content.nameToken.text);
		}
		if (content?.type === "import" && content.binding) {
			names.add(content.binding.text);
		}
	}
	return names;
}

// Check an unexpanded body's free names against what's visible at the
// definition site. Arguments of nested macro calls are skipped - a param used
// as a defining occurrence would make the argument a fresh name, which only
// expanding could tell apart from a reference.
function validateBody(
	macro: Macro,
	visible: ReadonlySet<string>,
	isMacro: (name: string) => boolean,
	report: Reporter,
	file: string,
): void {
	const bound = localNames(macro.body);
	for (const param of macro.params) bound.add(param.nameToken.text);

	const check = (expr: Expression): void => {
		switch (expr.type) {
			case "identifier":
				if (!bound.has(expr.text) && !visible.has(expr.text)) {
					report(
						Codes.UndefinedInMacroBody,
						`Undefined symbol "${expr.text}" in macro "${macro.nameToken.text}"`,
						tokenSpan(expr),
						file,
					);
				}
				break;
			case "prefix-expression":
			case "grouped-expression":
				check(expr.expression);
				break;
			case "infix-expression":
				check(expr.left);
				check(expr.right);
				break;
			case "member-expression":
				check(expr.object);
				break;
			case "dict-literal":
				for (const entry of expr.entries) check(entry.value);
				break;
			case "call-expression":
				check(expr.callee);
				for (const arg of expr.args) check(arg);
				break;
			default:
				break;
		}
	};

	const walk = (statements: readonly Statement[]): void => {
		for (const statement of statements) {
			const content = statement.content;
			if (!content) continue;
			switch (content.type) {
				case "byte":
				case "word":
					for (const [e] of content.list) check(e);
					break;
				case "org":
					check(content.expression);
					break;
				case "res":
					check(content.count);
					break;
				case "assignment": {
					// An expression macro's params are bound within its own body.
					const added = (content.params ?? []).filter(
						(p) => !bound.has(p.text),
					);
					for (const p of added) bound.add(p.text);
					check(content.expression);
					// Attribute values are discarded without ever being evaluated,
					// so an unresolvable name in one isn't an error.
					for (const p of added) bound.delete(p.text);
					break;
				}
				case "instruction":
					if (isMacro(content.mnemonic.text)) break;
					for (const operand of content.operands) {
						if (operand.type !== "accumulator-operand") {
							check(operand.expression);
						}
					}
					break;
				case "if-block":
					for (const arm of content.arms) {
						if (arm.condition) check(arm.condition);
						walk(arm.body);
					}
					break;
				case "error-directive":
					check(content.message);
					break;
				default:
					break;
			}
		}
	};
	walk(macro.body);
}

/**
 * Scope `.if` arms - a static pass over the (macro-expanded) statement
 * stream. A name defined inside an arm (a label or an assignment) is local
 * to that arm: it's renamed with a per-arm suffix, so it can't be referenced
 * (or collide) outside. This keeps the set of outside-visible definitions
 * pass-invariant while arm selection is re-decided every pass - a label that
 * flips in and out of existence with an address-dependent condition is
 * unrepresentable rather than a hazard. The idiom for "the address of
 * whichever arm wins" is a label on the `.if` statement itself.
 *
 * Arms are also emit-only: `.import`, `.export`, and `.macro` are rejected
 * inside them.
 */
/**
 * Anonymous labels - a static rewrite that runs before everything else.
 *
 * A lone `:` defines one; `:+` refers to the next one lexically, `:++` to the
 * one after that, `:-` to the previous one, and so on. They're numbered per
 * *context* - a module's top level, or one macro body - and rewritten to
 * `:0`, `:1`, ... which no identifier can spell, so they behave like ordinary
 * private labels from there on.
 *
 * A macro body is its own context, so a body's anonymous labels can't be
 * reached from the call site and vice versa; macro hygiene then renames them
 * per expansion, so two calls in one scope don't collide. `.if` arms are *not*
 * their own context - numbering is lexical, so it can't depend on which arm
 * wins - but arm-local visibility still applies afterwards, which means a
 * reference reaching into an arm from outside resolves to nothing, like any
 * other arm-local name.
 */
export function resolveAnonymousLabels(
	modules: readonly LoadedModule[],
	report: Reporter,
): void {
	for (const module of modules) {
		for (const statement of module.statements) {
			const content = statement.content;
			const macro =
				content?.type === "macro"
					? content
					: content?.type === "export" && content.content?.type === "macro"
						? content.content
						: undefined;
			if (macro) resolveAnonymousContext(macro.body, module.id, report);
		}
		resolveAnonymousContext(module.statements, module.id, report);
	}
}

/** A numbered anonymous label (`:0`), as the first walk leaves them. */
function isAnonymousLabel(text: string): boolean {
	return (
		text.length > 1 && text[0] === ":" && text[1]! >= "0" && text[1]! <= "9"
	);
}

/** `:++` -> two forward, `:--` -> two back; undefined for anything else. */
function anonymousReference(
	text: string,
): { forward: boolean; count: number } | undefined {
	if (text.length < 2 || text[0] !== ":") return undefined;
	const sign = text[1]!;
	if (sign !== "+" && sign !== "-") return undefined;
	for (let i = 2; i < text.length; i++) {
		if (text[i] !== sign) return undefined;
	}
	return { forward: sign === "+", count: text.length - 1 };
}

function resolveAnonymousContext(
	statements: readonly Statement[],
	file: string,
	report: Reporter,
): void {
	// Walk 1: number every definition, so forward references have something
	// to point at.
	const names: string[] = [];
	walkAnonymous(statements, {
		label: (label) => {
			if (label.identifier.text !== ANONYMOUS_LABEL) return;
			const name = ANONYMOUS_LABEL + names.length;
			label.identifier = { ...label.identifier, text: name };
			names.push(name);
		},
		expression: () => {},
	});
	// Walk 2 runs even when nothing was defined, so a stray `:+` gets the
	// diagnostic it deserves instead of an undefined-symbol error.
	//
	// Resolve references against how many definitions have gone by.
	// Labels are counted before the statement's own content, so `: jmp :-`
	// refers to the label on its own line.
	let seen = 0;
	walkAnonymous(statements, {
		label: (label) => {
			if (isAnonymousLabel(label.identifier.text)) seen++;
		},
		expression: (expr) => {
			if (expr.type !== "identifier") return;
			const reference = anonymousReference(expr.text);
			if (!reference) return;
			const index = reference.forward
				? seen + reference.count - 1
				: seen - reference.count;
			const target = names[index];
			if (target === undefined) {
				const which = reference.forward ? "after" : "before";
				const nth = reference.count === 1 ? "" : `${ordinal(reference.count)} `;
				report(
					Codes.NoSuchAnonymousLabel,
					`There is no ${nth}anonymous label ${which} this point`,
					tokenSpan(expr),
					file,
				);
				return;
			}
			expr.text = target;
		},
	});
}

function ordinal(n: number): string {
	return n === 2 ? "second" : n === 3 ? "third" : n === 4 ? "fourth" : `${n}th`;
}

/**
 * Walk statements in lexical order, reporting label definitions and every
 * expression. Descends into `.if` arms (interleaving each arm's condition with
 * its body, as written) but not into macro bodies, which are numbered as their
 * own contexts.
 */
function walkAnonymous(
	statements: readonly Statement[],
	visit: {
		label: (label: Label) => void;
		expression: (expr: Expression) => void;
	},
): void {
	for (const statement of statements) {
		for (const label of statement.labels) visit.label(label);
		const content = statement.content;
		if (!content || content.type === "macro") continue;
		if (content.type === "if-block") {
			for (const arm of content.arms) {
				if (arm.condition) visitExpression(arm.condition, visit.expression);
				walkAnonymous(arm.body, visit);
			}
			continue;
		}
		visitContentExpressions(content, visit.expression);
	}
}

/** Every expression directly in `content` (an `if-block`'s arms excepted). */
function visitContentExpressions(
	content: StatementContent,
	visit: (expr: Expression) => void,
): void {
	switch (content.type) {
		case "byte":
		case "word":
			for (const [expression] of content.list)
				visitExpression(expression, visit);
			break;
		case "org":
			visitExpression(content.expression, visit);
			break;
		case "res":
			visitExpression(content.count, visit);
			break;
		case "assignment":
			visitExpression(content.expression, visit);
			for (const attribute of content.attributes) {
				visitExpression(attribute.value, visit);
			}
			break;
		case "instruction":
			for (const operand of content.operands) {
				if (operand.type !== "accumulator-operand") {
					visitExpression(operand.expression, visit);
				}
			}
			break;
		case "error-directive":
			visitExpression(content.message, visit);
			break;
		case "export":
			if (content.content) visitContentExpressions(content.content, visit);
			break;
		default:
			break; // import, segment directives, macro
	}
}

function visitExpression(
	expr: Expression,
	visit: (expr: Expression) => void,
): void {
	visit(expr);
	switch (expr.type) {
		case "grouped-expression":
		case "prefix-expression":
			visitExpression(expr.expression, visit);
			break;
		case "infix-expression":
			visitExpression(expr.left, visit);
			visitExpression(expr.right, visit);
			break;
		case "member-expression":
			visitExpression(expr.object, visit);
			break;
		case "call-expression":
			visitExpression(expr.callee, visit);
			for (const argument of expr.args) visitExpression(argument, visit);
			break;
		case "dict-literal":
			for (const entry of expr.entries) visitExpression(entry.value, visit);
			break;
		default:
			break; // literals and `*`
	}
}

/** Does `name` name a local label? Only a leading `@` counts. */
function isLocalName(name: string): boolean {
	return name.startsWith("@");
}

/**
 * Local labels (`@name`) - a static rewrite that runs *before* macro
 * expansion.
 *
 * A local label belongs to the nearest preceding non-local label and stays in
 * scope until the next one; locals written before any label belong to a
 * module-initial scope. Qualifying `@name` to `owner@name` turns them into
 * ordinary symbols, so define-once, forward references, and scoping all come
 * from machinery that already exists. Both the qualified form and the
 * module-initial owner (`@`) are unspellable, so a reference that escapes its
 * scope resolves to nothing rather than silently reaching another scope's
 * label - and it reports as the `@name` the author wrote, because an
 * out-of-scope name is left unqualified.
 *
 * Two deliberate boundaries:
 *
 * - **`.if` arms neither open nor close a scope.** An arm belongs to the scope
 *   in effect at the `.if`, so which arm wins can never change what a local
 *   label means - the same pass-invariance `scopeIfArms` exists to protect.
 *   (Arm-local visibility still applies afterwards: `scopeIfArms` renames the
 *   qualified name like any other arm definition.)
 * - **Macro bodies are left alone**, because `substituteStatement` doesn't
 *   descend into them. A body's `@name` is renamed per expansion by macro
 *   hygiene, which already makes it unique and unreachable from outside, and a
 *   body's free `@name` is caught by the definition-site free-name check.
 *   Running before expansion is what keeps the two mechanisms from colliding -
 *   in particular, it means a macro call can't silently re-point the caller's
 *   local scope, and an expanded body can't capture the caller's locals.
 */
export function scopeLocalLabels(
	modules: readonly LoadedModule[],
	report: Reporter,
): void {
	for (const module of modules) {
		// `@` is the module-initial scope: no real label starts with one, so its
		// locals (`@@name`) can't collide with any labelled scope's.
		let owner = "@";
		let run: Statement[] = [];
		const flush = () => {
			qualifyLocals(run, owner, module.id, report);
			run = [];
		};
		for (const statement of module.statements) {
			const opener = openingLabel(statement, module.id, report);
			if (opener !== undefined) {
				flush();
				owner = opener;
			}
			run.push(statement);
		}
		flush();
	}
}

// The non-local label that makes a statement start a new local scope, if any.
// Several labels on one statement are aliases, so the last one wins.
function openingLabel(
	statement: Statement,
	file: string,
	report: Reporter,
): string | undefined {
	let opener: string | undefined;
	for (const label of statement.labels) {
		if (!isLocalName(label.identifier.text)) opener = label.identifier.text;
	}
	const content = statement.content;
	if (content?.type === "export" && content.nameToken) {
		if (isLocalName(content.nameToken.text)) {
			report(
				Codes.LocalLabelExported,
				`Local label "${content.nameToken.text}" is private to its scope and cannot be exported`,
				tokenSpan(content.nameToken),
				file,
			);
		} else if (content.definesLabel) {
			opener = content.nameToken.text;
		}
	}
	return opener;
}

// Qualify every local name one scope defines, across the whole scope - so a
// local may be referenced before it is defined, like any other symbol.
function qualifyLocals(
	statements: readonly Statement[],
	owner: string,
	file: string,
	report: Reporter,
): void {
	const defined = new Set<string>();
	collectLocalDefinitions(statements, defined);
	if (!defined.size) return;
	const subst = new Map<string, Substitution>();
	for (const name of defined) {
		subst.set(name, { kind: "rename", name: owner + name });
	}
	for (const statement of statements) {
		substituteStatement(statement, subst, file, report);
	}
}

// Local names a scope defines. Descends into `.if` arms (an arm belongs to the
// enclosing scope) but not into macro bodies.
function collectLocalDefinitions(
	statements: readonly Statement[],
	into: Set<string>,
): void {
	for (const statement of statements) {
		for (const label of statement.labels) {
			if (isLocalName(label.identifier.text)) into.add(label.identifier.text);
		}
		const content = statement.content;
		if (content?.type === "assignment") {
			if (isLocalName(content.identifier.text))
				into.add(content.identifier.text);
		} else if (content?.type === "if-block") {
			for (const arm of content.arms) collectLocalDefinitions(arm.body, into);
		}
	}
}

export function scopeIfArms(
	modules: readonly LoadedModule[],
	report: Reporter,
): void {
	let counter = 0;
	for (const module of modules) {
		scopeStatements(
			module.statements,
			new Map(),
			module.id,
			() => ++counter,
			report,
		);
	}
}

// Walk `statements` looking for `.if` blocks; `outer` holds the enclosing
// arms' renames (empty at top level). Nested arms shadow outer renames.
function scopeStatements(
	statements: readonly Statement[],
	outer: Map<string, Substitution>,
	file: string,
	gensym: () => number,
	report: Reporter,
): void {
	for (const statement of statements) {
		const content = statement.content;
		if (content?.type !== "if-block") continue;
		for (const arm of content.arms) {
			// The condition evaluates in the enclosing scope.
			if (arm.condition && outer.size) {
				arm.condition = substituteExpr(arm.condition, outer, file, report);
			}
			const merged = new Map(outer);
			const suffix = `@if${gensym()}`;
			for (const name of directNames(arm.body)) {
				merged.set(name, { kind: "rename", name: name + suffix });
			}
			for (const armStatement of arm.body) {
				const inner = armStatement.content;
				const keyword =
					inner?.type === "import"
						? inner.importToken
						: inner?.type === "export"
							? inner.exportToken
							: inner?.type === "macro"
								? inner.macroToken
								: undefined;
				if (inner && keyword) {
					report(
						Codes.DirectiveInIfArm,
						`\`.${inner.type}\` is not allowed inside an \`.if\` arm`,
						tokenSpan(keyword),
						file,
					);
					continue;
				}
				if (inner?.type === "if-block") {
					// The nested `.if` statement's own labels belong to this arm;
					// its arms recurse with this arm's renames as the outer scope.
					if (merged.size) {
						for (const label of armStatement.labels) {
							label.identifier = substituteName(
								label.identifier,
								merged,
								file,
								report,
							);
						}
					}
					scopeStatements([armStatement], merged, file, gensym, report);
				} else if (merged.size) {
					substituteStatement(armStatement, merged, file, report);
				}
			}
		}
	}
}

function tokenSpan(token: {
	start: number;
	end: number;
}): readonly [number, number] {
	return [token.start, token.end];
}

function statementSpan(statement: Statement): readonly [number, number] {
	const label = statement.labels[0];
	return label ? tokenSpan(label.identifier) : [0, 0];
}
