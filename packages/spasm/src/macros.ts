import type {
	Expression,
	Macro,
	Operand,
	Statement,
	StatementContent,
} from "./parser.ts";

type Reporter = (message: string, span: readonly [number, number]) => void;

// A param substitutes to an argument expression; a body-local label renames.
type Substitution =
	| { kind: "expr"; expr: Expression }
	| { kind: "rename"; name: string };

const MAX_DEPTH = 64;

/**
 * Expand macros in a module's statements — a static, syntactic step that runs
 * once before assembly. `.macro` definitions are collected and removed; each
 * call (an instruction whose mnemonic names a macro) is replaced by the body
 * with params substituted and body-local labels renamed uniquely per expansion.
 */
export function expandMacros(
	statements: Statement[],
	report: Reporter,
): Statement[] {
	const macros = new Map<string, Macro>();
	const rest: Statement[] = [];
	for (const statement of statements) {
		const content = statement.content;
		if (content?.type === "macro") {
			if (macros.has(content.nameToken.text)) {
				report(
					`Macro "${content.nameToken.text}" is already defined`,
					tokenSpan(content.nameToken),
				);
			} else {
				macros.set(content.nameToken.text, content);
			}
		} else {
			rest.push(statement);
		}
	}

	let counter = 0;
	return expand(rest, macros, () => ++counter, report, 0);
}

function expand(
	statements: Statement[],
	macros: Map<string, Macro>,
	gensym: () => number,
	report: Reporter,
	depth: number,
): Statement[] {
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
			const macro = macros.get(content.mnemonic.text);
			if (macro) {
				const args = callArgs(content, macro, report);
				if (args) {
					const expanded = expandCall(macro, args, gensym);
					// Carry the call's own labels onto the first expanded statement.
					if (statement.labels.length && expanded.length) {
						expanded[0] = {
							...expanded[0]!,
							labels: [...statement.labels, ...expanded[0]!.labels],
						};
					} else if (statement.labels.length) {
						out.push({ ...statement, content: null });
					}
					out.push(...expand(expanded, macros, gensym, report, depth + 1));
				}
				continue;
			}
		}
		out.push(statement);
	}
	return out;
}

function callArgs(
	call: Extract<StatementContent, { type: "instruction" }>,
	macro: Macro,
	report: Reporter,
): Expression[] | undefined {
	const args: Expression[] = [];
	const operand = call.operand;
	if (operand && operand.type !== "accumulator-operand") {
		args.push(operand.expression);
	}
	if (args.length !== macro.params.length) {
		report(
			`Macro "${macro.nameToken.text}" expects ${macro.params.length} argument(s), got ${args.length}`,
			tokenSpan(call.mnemonic),
		);
		return undefined;
	}
	return args;
}

function expandCall(
	macro: Macro,
	args: Expression[],
	gensym: () => number,
): Statement[] {
	const subst = new Map<string, Substitution>();
	macro.params.forEach((param, i) => {
		subst.set(param.text, { kind: "expr", expr: args[i]! });
	});
	const suffix = `@${gensym()}`;
	for (const name of localNames(macro.body)) {
		if (!subst.has(name)) {
			subst.set(name, { kind: "rename", name: name + suffix });
		}
	}

	// Clone the template so substitution (which mutates) is per-expansion.
	const body = structuredClone(macro.body);
	for (const statement of body) substituteStatement(statement, subst);
	return body;
}

// Names defined inside the body (labels and assignments) are local to each
// expansion; references to anything else resolve in the surrounding scope.
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
): void {
	for (const label of statement.labels) {
		const s = subst.get(label.identifier.text);
		if (s?.kind === "rename") {
			label.identifier = { ...label.identifier, text: s.name };
		}
	}
	if (statement.content) substituteContent(statement.content, subst);
}

function substituteContent(
	content: StatementContent,
	subst: Map<string, Substitution>,
): void {
	switch (content.type) {
		case "byte":
		case "word":
			content.list = content.list.map(([e, comma]) => [
				substituteExpr(e, subst),
				comma,
			]);
			break;
		case "org":
			content.expression = substituteExpr(content.expression, subst);
			break;
		case "res":
			content.count = substituteExpr(content.count, subst);
			break;
		case "assignment": {
			content.expression = substituteExpr(content.expression, subst);
			const s = subst.get(content.identifier.text);
			if (s?.kind === "rename") {
				content.identifier = { ...content.identifier, text: s.name };
			}
			break;
		}
		case "instruction":
			if (content.operand && content.operand.type !== "accumulator-operand") {
				content.operand = {
					...content.operand,
					expression: substituteExpr(content.operand.expression, subst),
				} as Operand;
			}
			break;
		// Other content (segment/emit/emplace/import/export/global/…) carries no
		// substitutable expressions in a macro body for now.
		default:
			break;
	}
}

function substituteExpr(
	expr: Expression,
	subst: Map<string, Substitution>,
): Expression {
	switch (expr.type) {
		case "identifier": {
			const s = subst.get(expr.text);
			if (s?.kind === "expr") return structuredClone(s.expr);
			if (s?.kind === "rename") return { ...expr, text: s.name };
			return expr;
		}
		case "prefix-expression":
			return { ...expr, expression: substituteExpr(expr.expression, subst) };
		case "infix-expression":
			return {
				...expr,
				left: substituteExpr(expr.left, subst),
				right: substituteExpr(expr.right, subst),
			};
		case "grouped-expression":
			return { ...expr, expression: substituteExpr(expr.expression, subst) };
		case "member-expression":
			return { ...expr, object: substituteExpr(expr.object, subst) };
		default:
			return expr; // literals, `*`, `.global`
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
