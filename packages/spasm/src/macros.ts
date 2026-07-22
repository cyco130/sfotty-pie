import type { Token } from "./lexer.ts";
import type { LoadedModule } from "./loader.ts";
import {
	getOperandLocation,
	type Expression,
	type Macro,
	type Operand,
	type Statement,
	type StatementContent,
} from "./parser.ts";
import { exportedNames } from "./scopes.ts";

type Reporter = (message: string, span: readonly [number, number]) => void;

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
	const imports = new Map<string, readonly string[]>();
	const stripped = new Map<string, Statement[]>();
	for (const module of modules) {
		imports.set(module.id, module.imports);
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
				content.content.type === "macro"
			) {
				macro = content.content;
				isExported = true;
			}
			if (!macro) {
				rest.push(statement);
				continue;
			}
			const name = macro.nameToken.text;
			if (own.has(name)) {
				report(
					`Macro "${name}" is already defined`,
					tokenSpan(macro.nameToken),
				);
			} else {
				own.set(name, macro);
				if (isExported) exported.add(name);
				checkBody(macro, report);
			}
		}
		macros.set(module.id, { own, exported });
		stripped.set(module.id, rest);
	}

	// Lexical lookup: own macros, then the imports' exported ones (first import
	// wins, mirroring symbol resolution).
	const lookup = (
		fromId: string,
		name: string,
	): { macro: Macro; definingId: string } | undefined => {
		const own = macros.get(fromId)?.own.get(name);
		if (own) return { macro: own, definingId: fromId };
		for (const importId of imports.get(fromId) ?? []) {
			const theirs = macros.get(importId);
			if (theirs?.exported.has(name)) {
				return { macro: theirs.own.get(name)!, definingId: importId };
			}
		}
		return undefined;
	};

	// `.out` contract checks, for every macro, used or not. The callee's
	// signature is known here, so forwarding (passing a param on to a nested
	// call's `.out` position) is recognized per argument position.
	for (const module of modules) {
		for (const macro of macros.get(module.id)!.own.values()) {
			validateParams(macro, (name) => lookup(module.id, name)?.macro, report);
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
				report("Macro expansion too deep (recursion?)", statementSpan(first));
			}
			return statements;
		}

		const out: Statement[] = [];
		for (const statement of statements) {
			const content = statement.content;
			if (content?.type === "instruction") {
				const found = lookup(scopeId, content.mnemonic.text);
				if (found) {
					expanded.add(found.macro);
					const args = callArgs(content, found.macro, report);
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
				for (const importId of module.imports) {
					const imported = expandedById.get(importId);
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
			);
		}
	}

	return result;
}

// Module-level directives can't appear in a macro body: the loader resolves
// imports from top-level statements only, and an export or a nested macro
// definition would escape the expansion.
function checkBody(macro: Macro, report: Reporter): void {
	for (const statement of macro.body) {
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
				`\`.${content.type}\` is not allowed inside a macro body`,
				tokenSpan(keyword),
			);
		}
	}
}

// A macro argument is a whole *operand*, shape included - `mva (src),y, (dst),y`
// passes two indirect-indexed operands. Operand is a super-type of simple
// values: a simple operand is a plain expression and substitutes anywhere; a
// shaped operand only substitutes as a whole operand (a type error elsewhere).
function callArgs(
	call: Extract<StatementContent, { type: "instruction" }>,
	macro: Macro,
	report: Reporter,
): Operand[] | undefined {
	const args = call.operands;
	if (args.length !== macro.params.length) {
		report(
			`Macro "${macro.nameToken.text}" expects ${macro.params.length} argument(s), got ${args.length}`,
			tokenSpan(call.mnemonic),
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
				`Argument for \`.out\` parameter "${param.nameToken.text}" must be a plain identifier`,
				getOperandLocation(arg),
			);
			return undefined;
		}
	}
	return args;
}

// The `.out` contract: an `.out` param must be defined by the body (a label,
// an assignment, or forwarding to a nested call's `.out` position) - reads
// are additionally allowed; a plain param must not be defined or forwarded.
function validateParams(
	macro: Macro,
	getMacro: (name: string) => Macro | undefined,
	report: Reporter,
): void {
	if (!macro.params.length) return;
	const defined = localNames(macro.body);
	const forwarded = new Set<string>();
	for (const statement of macro.body) {
		const content = statement.content;
		if (content?.type !== "instruction") continue;
		const callee = getMacro(content.mnemonic.text);
		if (!callee) continue;
		content.operands.forEach((operand, i) => {
			if (
				callee.params[i]?.outToken &&
				operand.type === "simple-operand" &&
				operand.expression.type === "identifier"
			) {
				forwarded.add(operand.expression.text);
			}
		});
	}
	for (const param of macro.params) {
		const name = param.nameToken.text;
		if (param.outToken) {
			if (!defined.has(name) && !forwarded.has(name)) {
				report(
					`\`.out\` parameter "${name}" is never defined in the macro body`,
					tokenSpan(param.nameToken),
				);
			}
		} else if (defined.has(name) || forwarded.has(name)) {
			report(
				`Parameter "${name}" is defined in the macro body - declare it \`.out\``,
				tokenSpan(param.nameToken),
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

// Names defined inside the body (labels and assignments) are local to each
// expansion; references to anything else bind in the defining module.
function localNames(body: Statement[]): Set<string> {
	const names = new Set<string>();
	for (const statement of body) {
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
		label.identifier = substituteName(label.identifier, subst, report);
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
	report: Reporter,
): Token<"identifier"> {
	const s = subst.get(identifier.text);
	if (s?.kind === "rename") return { ...identifier, text: s.name };
	if (s?.kind === "operand") {
		if (
			s.operand.type === "simple-operand" &&
			s.operand.expression.type === "identifier"
		) {
			return structuredClone(s.operand.expression);
		}
		report(
			`Macro argument for "${identifier.text}" defines a name and must be a plain identifier`,
			tokenSpan(identifier),
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
			content.expression = substituteExpr(
				content.expression,
				subst,
				origin,
				report,
			);
			content.identifier = substituteName(content.identifier, subst, report);
			break;
		}
		case "instruction":
			content.operands = content.operands.map((operand) =>
				substituteOperand(operand, subst, origin, report),
			);
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
): Expression {
	switch (expr.type) {
		case "identifier": {
			const s = subst.get(expr.text);
			if (s?.kind === "operand") {
				// Operand is a super-type of simple values: only a simple operand
				// (a plain expression) has a value usable inside an expression.
				if (s.operand.type === "simple-operand") {
					return structuredClone(s.operand.expression);
				}
				report(
					`Macro argument "${expr.text}" has an operand value and can only be used as a whole operand`,
					tokenSpan(expr),
				);
				return expr;
			}
			if (s?.kind === "rename") return { ...expr, text: s.name };
			// A free name binds where the macro was defined (hygiene). An already
			// stamped identifier (from an outer expansion's argument) keeps its
			// binding.
			return { ...expr, origin: expr.origin ?? origin };
		}
		case "prefix-expression":
			return {
				...expr,
				expression: substituteExpr(expr.expression, subst, origin, report),
			};
		case "infix-expression":
			return {
				...expr,
				left: substituteExpr(expr.left, subst, origin, report),
				right: substituteExpr(expr.right, subst, origin, report),
			};
		case "grouped-expression":
			return {
				...expr,
				expression: substituteExpr(expr.expression, subst, origin, report),
			};
		case "member-expression":
			return {
				...expr,
				object: substituteExpr(expr.object, subst, origin, report),
			};
		default:
			return expr; // literals and `*`
	}
}

// Top-level defining occurrences of a module, post-expansion.
function definedNames(statements: readonly Statement[]): Set<string> {
	const names = new Set<string>();
	for (const statement of statements) {
		for (const label of statement.labels) names.add(label.identifier.text);
		const content = statement.content;
		if (content?.type === "assignment") names.add(content.identifier.text);
		if (content?.type === "export" && content.content.type === "assignment") {
			names.add(content.content.identifier.text);
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
): void {
	const bound = localNames(macro.body);
	for (const param of macro.params) bound.add(param.nameToken.text);

	const check = (expr: Expression): void => {
		switch (expr.type) {
			case "identifier":
				if (!bound.has(expr.text) && !visible.has(expr.text)) {
					report(
						`Undefined symbol "${expr.text}" in macro "${macro.nameToken.text}"`,
						tokenSpan(expr),
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
			default:
				break;
		}
	};

	for (const statement of macro.body) {
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
			case "assignment":
				check(content.expression);
				break;
			case "instruction":
				if (isMacro(content.mnemonic.text)) break;
				for (const operand of content.operands) {
					if (operand.type !== "accumulator-operand") {
						check(operand.expression);
					}
				}
				break;
			default:
				break;
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
