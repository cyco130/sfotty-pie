import { Codes } from "./codes.ts";
import type { Token } from "./lexer.ts";
import {
	getExpressionLocation,
	type Expression,
	type InfixExpression,
	type MemberExpression,
	type MessageNote,
	type PrefixExpression,
} from "./parser.ts";
import { SEP } from "./symbols.ts";
import {
	decodeStringLiteral,
	isEqual,
	type DictValue,
	type OperandShape,
	type OperandValue,
	type Value,
} from "./value.ts";

export interface EvalEnv {
	/**
	 * Look up a symbol; `undefined` means "not resolved (yet)". `origin`, when
	 * present, is the module the identifier lexically binds to (stamped by macro
	 * expansion); otherwise the name resolves in the containing module. `span`
	 * is the referencing token's span (a `::` path resolves per segment, each
	 * with its own token's span) - the assemble env records it for reference
	 * tracking; plain evaluation ignores it.
	 */
	resolve(
		name: string,
		origin?: string,
		span?: readonly [number, number],
	): Value | undefined;
	/** Value of `*` (the location counter), or `undefined` outside a section. */
	locationCounter: bigint | undefined;
	/**
	 * Report a hard error (type mismatch, divide-by-zero, bad escape). `file`
	 * overrides the module the span refers into - hygiene-stamped tokens point
	 * into their defining module's source. `options.symbol` carries the
	 * qualified symbol name on symbol-related diagnostics.
	 */
	report(
		code: string,
		message: string,
		span: readonly [number, number],
		file?: string,
		options?: { notes?: MessageNote[]; symbol?: string },
	): void;
	/**
	 * When set, an unresolved symbol is reported as undefined. The assemble loop
	 * turns this on so the final (converged) pass flags genuinely-missing names,
	 * while leaving it off for plain evaluation (where unresolved just defers).
	 */
	strict?: boolean;
	/** Function-application nesting depth, for the recursion cap. */
	depth?: number;
	/**
	 * `.segment()` support: the current segment's name at this evaluation
	 * point. Absent where there is no segment context (reported as an error).
	 */
	currentSegment?: () => string;
	/**
	 * `.pop` support: pop the module's value stack; an `undefined` result
	 * means the stack was empty (the evaluator reports it). Absent where
	 * `.pop` is banned - expression-macro bodies (pure, evaluated per
	 * application), `.if` conditions (later arms evaluate only when earlier
	 * ones fail, so the pop count would depend on arm selection), and
	 * render-time `.res` counts (the collect-time stack is gone).
	 */
	popValue?: () => { value: Value | undefined } | undefined;
}

const MAX_APPLICATION_DEPTH = 64;
const MAX_DICT_DEPTH = 16;

/**
 * Evaluate an expression. Returns `undefined` if any part is unresolved (a
 * not-yet-defined symbol) or an error made it uncomputable - callers tell the
 * two apart by whether `report` fired. Reports may fire on non-final passes;
 * the assemble loop keeps only the final settled pass's diagnostics.
 */
export function evaluate(expr: Expression, env: EvalEnv): Value | undefined {
	switch (expr.type) {
		case "decimal":
			return BigInt(expr.text.replace(/_/g, ""));
		case "hexadecimal":
			return BigInt("0x" + expr.text.slice(1).replace(/_/g, ""));
		case "binary":
			return BigInt("0b" + expr.text.slice(1).replace(/_/g, ""));
		case "string":
			return decodeStringLiteral(expr.text, (escape) =>
				env.report(
					Codes.UnknownEscape,
					`Unknown escape sequence "\\${escape}"`,
					getExpressionLocation(expr),
				),
			);
		case "character": {
			const decoded = decodeStringLiteral(expr.text, (escape) =>
				env.report(
					Codes.UnknownEscape,
					`Unknown escape sequence "\\${escape}"`,
					getExpressionLocation(expr),
				),
			);
			// A character literal is a single byte in the target encoding (UTF-8
			// for now, like `.byte` strings), so multi-byte chars such as 'ü' fail.
			const bytes = new TextEncoder().encode(decoded);
			if (bytes.length !== 1) {
				env.report(
					Codes.CharacterNotSingleByte,
					"A character literal must be a single byte",
					getExpressionLocation(expr),
				);
				return undefined;
			}
			return BigInt(bytes[0]!);
		}
		case "identifier": {
			const value = env.resolve(expr.text, expr.origin, [expr.start, expr.end]);
			if (value === undefined && env.strict) {
				env.report(
					Codes.UndefinedSymbol,
					`Undefined symbol "${expr.text}"`,
					getExpressionLocation(expr),
					expr.origin,
					{ symbol: expr.text },
				);
			}
			return value;
		}
		case "*":
			return env.locationCounter;
		case "segment-expression": {
			if (!env.currentSegment) {
				env.report(
					Codes.NoCurrentSegment,
					"`.segment()` is not available here",
					getExpressionLocation(expr),
					expr.segmentToken.origin,
				);
				return undefined;
			}
			return env.currentSegment();
		}
		case "operand-literal": {
			// Synthesized by macro substitution for a shaped argument in
			// expression position; a simple operand never gets here (its
			// expression splices directly).
			const operand = expr.operand;
			switch (operand.type) {
				case "accumulator-operand":
					return { type: "operand", shape: "a" };
				case "register-operand":
					return {
						type: "operand",
						shape: operand.registerToken.type === "x" ? "x" : "y",
					};
				case "simple-operand":
					return evaluate(operand.expression, env);
				case "immediate-operand":
					return {
						type: "operand",
						shape: "immediate",
						value: evaluate(operand.expression, env),
					};
				case "indexed-operand":
					return {
						type: "operand",
						shape:
							operand.register.text.toLowerCase() === "x"
								? "x_indexed"
								: "y_indexed",
						value: evaluate(operand.expression, env),
					};
				case "indirect-operand":
					return {
						type: "operand",
						shape: "indirect",
						value: evaluate(operand.expression, env),
					};
				case "indexed-indirect-operand":
					return {
						type: "operand",
						shape: "x_indexed_indirect",
						value: evaluate(operand.expression, env),
					};
				case "indirect-indexed-operand":
					return {
						type: "operand",
						shape: "indirect_y_indexed",
						value: evaluate(operand.expression, env),
					};
			}
			break;
		}
		case "builtin-call":
			return evaluateBuiltin(expr, env);
		case "pop-expression": {
			if (!env.popValue) {
				env.report(
					Codes.PopNotAllowed,
					"`.pop` is not allowed here",
					getExpressionLocation(expr),
					expr.popToken.origin,
				);
				return undefined;
			}
			const popped = env.popValue();
			if (!popped) {
				env.report(
					Codes.PopEmpty,
					"`.pop` with nothing pushed",
					getExpressionLocation(expr),
					expr.popToken.origin,
				);
				return undefined;
			}
			return popped.value;
		}
		case "grouped-expression":
			return evaluate(expr.expression, env);
		case "prefix-expression":
			return prefix(expr, env);
		case "infix-expression":
			return infix(expr, env);
		case "member-expression": {
			// A path: `N::key`, chaining for nested dictionaries. The root's
			// hygiene origin applies to the whole path.
			const path = flattenPath(expr);
			if (!path) {
				env.report(
					Codes.ScopeResolutionOnValue,
					"`::` requires a dictionary or an imported module on its left",
					getExpressionLocation(expr),
				);
				return undefined;
			}
			return resolvePath(path, getExpressionLocation(expr), env);
		}
		case "call-expression": {
			const fn = evaluate(expr.callee, env);
			if (fn === undefined) return undefined; // unresolved; strict reported
			if (typeof fn !== "object" || fn.type !== "function") {
				env.report(
					Codes.NotAFunction,
					`${calleeName(expr.callee)} is not a function`,
					getExpressionLocation(expr.callee),
				);
				return undefined;
			}
			if (expr.args.length !== fn.params.length) {
				env.report(
					Codes.FunctionArity,
					`${calleeName(expr.callee)} expects ${fn.params.length} argument(s), got ${expr.args.length}`,
					getExpressionLocation(expr),
				);
				return undefined;
			}
			const depth = (env.depth ?? 0) + 1;
			if (depth > MAX_APPLICATION_DEPTH) {
				env.report(
					Codes.ApplicationTooDeep,
					"Expression macro application too deep (recursion?)",
					getExpressionLocation(expr),
				);
				return undefined;
			}
			// Eager arguments, evaluated in the caller's scope; the body's free
			// names default to the defining module (lexical hygiene) by forcing
			// the origin - params shadow via the bindings overlay.
			const bindings = new Map<string, Value | undefined>();
			fn.params.forEach((param, i) => {
				bindings.set(param, evaluate(expr.args[i]!, env));
			});
			const inner: EvalEnv = {
				resolve: (name, origin, span) =>
					origin === undefined && bindings.has(name)
						? bindings.get(name)
						: env.resolve(name, origin ?? fn.moduleId, span),
				locationCounter: env.locationCounter,
				report: env.report,
				strict: env.strict,
				depth,
				// `.segment()` reads ambient state like `*`; `.pop` is
				// deliberately NOT forwarded - bodies are pure and evaluate
				// once per application.
				currentSegment: env.currentSegment,
			};
			return evaluate(fn.body, inner);
		}
		case "dict-literal": {
			// Entries are held inline, so an entry that doesn't resolve this pass
			// is `undefined` inside an otherwise perfectly good dictionary - the
			// parent is a value even when a child isn't yet.
			const entries = new Map<string, Value | undefined>();
			for (const entry of expr.entries) {
				const key = entry.key.text;
				if (entries.has(key)) {
					env.report(
						Codes.DuplicateDictKey,
						`Duplicate dictionary key "${key}"`,
						[entry.key.start, entry.key.end],
					);
					continue; // the first entry wins
				}
				entries.set(key, evaluate(entry.value, env));
			}
			const dict: DictValue = { type: "dict", entries };
			// A backstop for definitions that nest one level deeper every pass -
			// mutual bare references (`N = { A: M }`, `M = { B: N }`), which the
			// self-reference check can't see because neither literal names itself.
			if (dictDepth(dict) > MAX_DICT_DEPTH) {
				env.report(
					Codes.DictionaryTooDeep,
					"Dictionary nested too deeply - a cyclic definition?",
					getExpressionLocation(expr),
				);
				return undefined;
			}
			return dict;
		}
	}
}

/** Constructor builtin -> the shape it makes; register shapes take no value. */
const CONSTRUCTOR_SHAPES: Record<string, OperandShape> = {
	a_operand: "a",
	x_operand: "x",
	y_operand: "y",
	immediate_operand: "immediate",
	x_indexed_operand: "x_indexed",
	y_indexed_operand: "y_indexed",
	indirect_operand: "indirect",
	x_indexed_indirect_operand: "x_indexed_indirect",
	indirect_y_indexed_operand: "indirect_y_indexed",
};

/** Shape predicate -> the shape it tests. */
const PREDICATE_SHAPES: Record<string, OperandShape> = {
	is_a_operand: "a",
	is_x_operand: "x",
	is_y_operand: "y",
	is_immediate_operand: "immediate",
	is_x_indexed_operand: "x_indexed",
	is_y_indexed_operand: "y_indexed",
	is_indirect_operand: "indirect",
	is_x_indexed_indirect_operand: "x_indexed_indirect",
	is_indirect_y_indexed_operand: "indirect_y_indexed",
};

const REGISTER_SHAPES: ReadonlySet<string> = new Set(["a", "x", "y"]);

function isOperand(value: Value): value is OperandValue {
	return typeof value === "object" && value.type === "operand";
}

/**
 * Evaluate an operand/value builtin. Predicates defer (return `undefined`)
 * while their argument is unresolved - a forward-referenced constant may
 * resolve to any kind of value, an operand included, so nothing can be
 * answered early; the fixpoint settles it like everything else.
 */
function evaluateBuiltin(
	expr: Extract<Expression, { type: "builtin-call" }>,
	env: EvalEnv,
): Value | undefined {
	const name = expr.nameToken.type;
	const span = getExpressionLocation(expr);
	const origin = expr.nameToken.origin;
	const constructed = CONSTRUCTOR_SHAPES[name];
	const arity =
		constructed !== undefined && REGISTER_SHAPES.has(constructed) ? 0 : 1;
	if (expr.args.length !== arity) {
		env.report(
			Codes.BuiltinArity,
			`\`.${name}\` takes ${arity} argument(s), got ${expr.args.length}`,
			span,
			origin,
		);
		return undefined;
	}

	// Constructors.
	if (constructed !== undefined) {
		if (REGISTER_SHAPES.has(constructed)) {
			return { type: "operand", shape: constructed };
		}
		return {
			type: "operand",
			shape: constructed,
			value: evaluate(expr.args[0]!, env),
		};
	}

	const value = evaluate(expr.args[0]!, env);
	if (value === undefined) return undefined; // defer with the argument

	const tested = PREDICATE_SHAPES[name];
	if (tested !== undefined) {
		return isOperand(value) && value.shape === tested ? 1n : 0n;
	}

	switch (name) {
		case "is_simple_operand":
			// A plain value already is the simple operand; only shaped
			// arguments arrive as operand values.
			return isOperand(value) ? 0n : 1n;
		case "is_integer":
			return typeof value === "bigint" ? 1n : 0n;
		case "is_string":
			return typeof value === "string" ? 1n : 0n;
		case "is_dictionary":
			return typeof value === "object" && value.type === "dict" ? 1n : 0n;
		case "is_function":
			return typeof value === "object" && value.type === "function" ? 1n : 0n;
		case "is_operand":
			return isOperand(value) ? 1n : 0n;
		case "operand_value": {
			if (!isOperand(value)) {
				env.report(
					Codes.OperandValueType,
					"`.operand_value` takes an operand value",
					span,
					origin,
				);
				return undefined;
			}
			if (REGISTER_SHAPES.has(value.shape)) {
				env.report(
					Codes.OperandValueOfRegister,
					"A register operand wraps no value",
					span,
					origin,
				);
				return undefined;
			}
			return value.value;
		}
		default:
			return undefined;
	}
}

/**
 * Resolve a path (`A::B::C`) in two steps: find the value its root names, then
 * index the remaining keys into it.
 *
 * The root is either a symbol in scope - normally a dictionary - or a
 * *namespace binding* (`lib = .import "m"`), which is not itself a value and
 * so spends the first key reaching an export of the bound module. Everything
 * after that is ordinary value indexing, which is what lets a dictionary
 * exported by an imported module chain (`lib::N::V`).
 */
function resolvePath(
	path: FlatPath,
	span: readonly [number, number],
	env: EvalEnv,
): Value | undefined {
	const origin = path.root.origin;
	const reportUndefined = (display: string) => {
		if (env.strict) {
			env.report(
				Codes.UndefinedSymbol,
				`Undefined symbol "${display}"`,
				span,
				origin,
				{
					symbol: path.qualified,
				},
			);
		}
	};

	// Each resolve passes its own token's span (root alone, then one key at a
	// time), so reference records stay per-segment: on `lib::N::KEY` the
	// cursor over `lib` finds the binding, over `N` the export, over `KEY`
	// the dictionary entry.
	let value = env.resolve(path.root.text, origin, [
		path.root.start,
		path.root.end,
	]);
	let index = 0;
	let written = path.root.text;
	let seen = path.root.text;
	if (value === undefined) {
		// Not a value in scope; try the namespace-binding reading. (A root that
		// is defined but merely unresolved this pass also lands here, and gets
		// the same "undefined" answer it would have got anyway.)
		const key0 = path.keyTokens[0]!;
		value = env.resolve(path.root.text + SEP + path.keys[0]!, origin, [
			key0.start,
			key0.end,
		]);
		index = 1;
		written += SEP + path.keys[0]!;
		seen = path.root.text + "::" + path.keys[0]!;
		if (value === undefined) {
			reportUndefined(seen);
			return undefined;
		}
	}

	for (; index < path.keys.length; index++) {
		const key = path.keys[index]!;
		const token = path.keyTokens[index]!;
		if (typeof value !== "object" || value.type !== "dict") {
			env.report(
				Codes.NotADictionary,
				`"${seen}" is not a dictionary`,
				span,
				origin,
			);
			return undefined;
		}
		// Keys are statically known, so a missing one is a hard error rather
		// than something that might still resolve on a later pass.
		if (!value.entries.has(key)) {
			env.report(
				Codes.NoSuchDictKey,
				`Dictionary "${seen}" has no entry "${key}"`,
				span,
				origin,
			);
			return undefined;
		}
		written += SEP + key;
		// Purely for reference recording: dict literals define their entries
		// as table symbols under qualified names, so when this path is backed
		// by one, the key's span records against it. The traversal value stays
		// the inline entry (dicts reached through non-symbol routes have no
		// table backing, and record nothing).
		env.resolve(written, origin, [token.start, token.end]);
		value = value.entries.get(key);
		seen += "::" + key;
		if (value === undefined) {
			reportUndefined(seen); // present, but not resolved (yet)
			return undefined;
		}
	}
	return value;
}

// Nesting depth of a dictionary value (1 for a flat one).
function dictDepth(value: Value | undefined): number {
	if (typeof value !== "object" || value.type !== "dict") return 0;
	let deepest = 0;
	for (const entry of value.entries.values()) {
		const depth = dictDepth(entry);
		if (depth > deepest) deepest = depth;
	}
	return deepest + 1;
}

interface FlatPath {
	root: Token<"identifier">;
	/** The keys after the root - always at least one. */
	keys: readonly string[];
	/** The keys' tokens, parallel to `keys` (for per-segment spans). */
	keyTokens: readonly Token<"identifier">[];
	qualified: string;
	display: string;
}

// Flatten `A::B::C` to its root identifier and its keys; undefined when the
// path doesn't bottom out at an identifier.
function flattenPath(expr: MemberExpression): FlatPath | undefined {
	const keyTokens: Token<"identifier">[] = [expr.member];
	let object = expr.object;
	while (object.type === "member-expression") {
		keyTokens.unshift(object.member);
		object = object.object;
	}
	if (object.type !== "identifier") return undefined;
	const keys = keyTokens.map((token) => token.text);
	return {
		root: object,
		keys,
		keyTokens,
		qualified: [object.text, ...keys].join(SEP),
		display: [object.text, ...keys].join("::"),
	};
}

// A short display name for a callee in diagnostics.
function calleeName(callee: Expression): string {
	if (callee.type === "identifier") return `"${callee.text}"`;
	if (callee.type === "member-expression") {
		const path = flattenPath(callee);
		if (path) return `"${path.display}"`;
	}
	return "The expression";
}

/** Coerce an evaluated operand to a number, reporting if it isn't one. */
/** The value's kind, for type-mismatch messages and equality. */
function kindOfValue(
	value: Value,
): "number" | "string" | "function" | "dictionary" | "operand" {
	if (typeof value === "bigint") return "number";
	if (typeof value === "string") return "string";
	if (value.type === "function") return "function";
	if (value.type === "dict") return "dictionary";
	return "operand";
}

/** The kind with its article, for prose messages. */
function aKind(value: Value): string {
	const kind = kindOfValue(value);
	return kind === "operand" ? "an operand" : `a ${kind}`;
}

function asNumber(
	value: Value | undefined,
	expr: Expression,
	env: EvalEnv,
): bigint | undefined {
	if (typeof value === "string") {
		env.report(
			Codes.ExpectedNumber,
			"Expected a number, got a string",
			getExpressionLocation(expr),
		);
		return undefined;
	}
	if (typeof value === "object") {
		env.report(
			Codes.ExpectedNumber,
			`Expected a number, got ${aKind(value)}`,
			getExpressionLocation(expr),
		);
		return undefined;
	}
	return value; // bigint | undefined
}

function prefix(expr: PrefixExpression, env: EvalEnv): Value | undefined {
	const v = asNumber(evaluate(expr.expression, env), expr.expression, env);
	if (v === undefined) return undefined;
	switch (expr.operator.type) {
		case "+":
			return v;
		case "-":
			return -v;
		case "<":
			return v & 0xffn; // low byte
		case ">":
			return (v >> 8n) & 0xffn; // high byte
		case "!":
			return v === 0n ? 1n : 0n;
		case "~":
			// Arbitrary-precision complement: ~$0C is -$0D, and the byte/word
			// truncation does the right thing ($F3) by arithmetic.
			return ~v;
	}
}

function infix(expr: InfixExpression, env: EvalEnv): Value | undefined {
	const op = expr.operator.type;

	// Logical operators short-circuit, so they can resolve even when the right
	// side can't (e.g. `0 && forward_ref`).
	if (op === "&&" || op === "||") {
		const l = asNumber(evaluate(expr.left, env), expr.left, env);
		if (l === undefined) return undefined;
		if (op === "&&" && l === 0n) return 0n;
		if (op === "||" && l !== 0n) return 1n;
		const r = asNumber(evaluate(expr.right, env), expr.right, env);
		if (r === undefined) return undefined;
		return r === 0n ? 0n : 1n;
	}

	// Equality is structural and works for every value kind (strings,
	// operand values, dictionaries; functions by identity) - but only between
	// values of the SAME kind: a mixed comparison is a hard error rather than
	// a silent 0, the same typo-net thinking as static dictionary keys.
	if (op === "=" || op === "!=") {
		const lv = evaluate(expr.left, env);
		const rv = evaluate(expr.right, env);
		if (lv === undefined || rv === undefined) return undefined;
		if (kindOfValue(lv) !== kindOfValue(rv)) {
			env.report(
				Codes.ComparisonTypeMismatch,
				`Cannot compare ${aKind(lv)} with ${aKind(rv)}`,
				getExpressionLocation(expr),
			);
			return undefined;
		}
		return (op === "=") === isEqual(lv, rv) ? 1n : 0n;
	}

	const l = asNumber(evaluate(expr.left, env), expr.left, env);
	const r = asNumber(evaluate(expr.right, env), expr.right, env);
	if (l === undefined || r === undefined) return undefined;

	switch (op) {
		case "*":
			return l * r;
		case "^":
			return l ^ r;
		case "&":
			return l & r;
		case "|":
			return l | r;
		case "<<":
		case ">>":
			if (r < 0n) {
				env.report(
					Codes.NegativeShift,
					"Shift count must not be negative",
					getExpressionLocation(expr.right),
				);
				return undefined;
			}
			return op === "<<" ? l << r : l >> r;
		case "/":
		case "%":
			if (r === 0n) {
				env.report(
					Codes.DivisionByZero,
					op === "/" ? "Division by zero" : "Modulo by zero",
					getExpressionLocation(expr.right),
				);
				return undefined;
			}
			return op === "/" ? l / r : l % r;
		case "+":
			return l + r;
		case "-":
			return l - r;
		case "<":
			return l < r ? 1n : 0n;
		case ">":
			return l > r ? 1n : 0n;
	}
}
