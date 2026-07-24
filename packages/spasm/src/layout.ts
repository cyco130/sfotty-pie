import type { Expression, MessageNote } from "./parser.ts";
import type { SymbolKind } from "./symbols.ts";
import type { Value } from "./value.ts";

/**
 * A layout item, produced during collection. Byte runs and `.org` are concrete;
 * a label resolves to the location counter when render reaches it; a `res`
 * evaluates its count when render reaches it (so `*`-relative fills like
 * `.res $2000 - *` see the exact location); `.emit` / `.emplace` place another
 * segment at the current location.
 */
export type Item =
	| {
			kind: "bytes";
			bytes: number[];
			/** The originating statement, for "emplaced segment emits bytes". */
			moduleId: string;
			span: readonly [number, number];
	  }
	| { kind: "org"; addr: bigint }
	| {
			kind: "label";
			moduleId: string;
			name: string;
			symbolKind: SymbolKind;
			span: readonly [number, number];
	  }
	| {
			kind: "res";
			expression: Expression;
			moduleId: string;
			span: readonly [number, number];
	  }
	| {
			kind: "emit" | "emplace";
			segment: string;
			moduleId: string;
			span: readonly [number, number];
	  };

/** A segment accumulates an ordered list of layout items during collection. */
export class Segment {
	readonly name: string;
	readonly items: Item[] = [];
	constructor(name: string) {
		this.name = name;
	}
}

export type DefineLabel = (
	moduleId: string,
	name: string,
	value: bigint,
	kind: SymbolKind,
	span: readonly [number, number],
) => void;

/**
 * Evaluate a `res` item's count at its render position - `location` is the
 * exact LC when render reaches the item. Injected by the caller so layout
 * stays free of the evaluator (same layering as `DefineLabel`).
 */
export type EvaluateAt = (
	expression: Expression,
	moduleId: string,
	location: bigint,
) => Value | undefined;

type Reporter = (
	message: string,
	span: readonly [number, number],
	file?: string,
	notes?: MessageNote[],
) => void;

export interface RenderResult {
	bytes: number[];
	/** The base (absolute load address) each rendered segment landed at. */
	bases: Map<string, bigint>;
	/**
	 * Resolved size of each `res` item, keyed by segment name + NUL + the
	 * item's ordinal among the segment's `res` items. Fed back into the next
	 * pass's collect, whose running location advances by the previous render's
	 * sizes (one pass of lag, absorbed by the fixpoint).
	 */
	resSizes: Map<string, bigint>;
	/**
	 * Rendered byte length of each segment. Fed back like `resSizes`: collect
	 * advances its running location by a placed segment's previous-pass size,
	 * so `*` after an `.emit`/`.emplace` (a bounds check, say) is meaningful.
	 */
	sizes: Map<string, bigint>;
}

/**
 * Render from the root segment, recursing through `.emit`/`.emplace`. Byte runs
 * append and advance the location counter; `.org` jumps it without emitting (so
 * the file stays contiguous while run addresses diverge); a label resolves to
 * the current LC; `.emit "X"` renders X at the current LC and splices its bytes
 * (so X's labels become `base + offset`); `.emplace "X"` does the same but
 * reserves the space without emitting bytes.
 */
export function render(
	segments: Map<string, Segment>,
	rootName: string,
	defineLabel: DefineLabel,
	evaluateAt: EvaluateAt,
	report: Reporter,
): RenderResult {
	const bases = new Map<string, bigint>();
	const resSizes = new Map<string, bigint>();
	const sizes = new Map<string, bigint>();
	const onStack = new Set<string>();
	// The placement site (`.emit`/`.emplace` item) of each placed segment, for
	// "first placed here" and cycle-chain notes; the root has no site.
	const placements = new Map<
		string,
		{ span: readonly [number, number]; moduleId: string }
	>();
	const stackList: string[] = [];

	const placementNote = (message: string, name: string): MessageNote[] => {
		const site = placements.get(name);
		return site
			? [
					{
						message,
						start: site.span[0],
						end: site.span[1],
						file: site.moduleId,
					},
				]
			: [];
	};

	function renderSegment(
		segment: Segment,
		baseLC: bigint,
		emplaced: boolean,
	): number[] {
		bases.set(segment.name, baseLC);
		onStack.add(segment.name);
		stackList.push(segment.name);

		let lc = baseLC;
		let resIndex = 0;
		const bytes: number[] = [];
		for (const item of segment.items) {
			switch (item.kind) {
				case "bytes":
					// An emplaced segment reserves address space but never reaches
					// the file - real content there would be silently dropped.
					if (emplaced && item.bytes.length > 0) {
						report(
							`Emplaced segment "${segment.name}" contains byte-emitting content - only \`.res\` is allowed`,
							item.span,
							item.moduleId,
						);
					}
					bytes.push(...item.bytes);
					lc += BigInt(item.bytes.length);
					break;
				case "org":
					lc = item.addr;
					break;
				case "label":
					defineLabel(item.moduleId, item.name, lc, item.symbolKind, item.span);
					break;
				case "res": {
					const value = evaluateAt(item.expression, item.moduleId, lc);
					let count = 0n; // unresolved this pass -> 0; later passes settle it
					if (value !== undefined && typeof value !== "bigint") {
						report("`.res` requires a numeric count", item.span, item.moduleId);
					} else if (value !== undefined && value < 0n) {
						report(
							"`.res` count is negative - content overflows the fill boundary",
							item.span,
							item.moduleId,
						);
					} else if (value !== undefined) {
						count = value;
					}
					resSizes.set(segment.name + "\0" + resIndex, count);
					resIndex++;
					// Reserved space is zeros; whether they reach the file is the
					// parent's emit-vs-emplace decision, like any other bytes.
					for (let i = 0; i < Number(count); i++) bytes.push(0);
					lc += count;
					break;
				}
				case "emit":
				case "emplace": {
					const sub = segments.get(item.segment);
					if (!sub) {
						report(
							`Unknown segment "${item.segment}"`,
							item.span,
							item.moduleId,
						);
						break;
					}
					if (onStack.has(sub.name)) {
						// The chain of in-progress placements, outermost first, walks
						// the cycle for the reader.
						const cycle = stackList.slice(stackList.indexOf(sub.name));
						report(
							`Circular .${item.kind} of segment "${sub.name}"`,
							item.span,
							item.moduleId,
							cycle.flatMap((name) =>
								placementNote(`While placing "${name}"`, name),
							),
						);
						break;
					}
					// A second placement would assign the segment a second base -
					// two contradictory addresses for every label in it.
					if (bases.has(sub.name)) {
						report(
							`Segment "${sub.name}" is placed more than once`,
							item.span,
							item.moduleId,
							placementNote("First placed here", sub.name),
						);
						break;
					}
					placements.set(sub.name, {
						span: item.span,
						moduleId: item.moduleId,
					});
					if (emplaced && item.kind === "emit") {
						report(
							"Cannot `.emit` inside an emplaced segment - use `.emplace`",
							item.span,
							item.moduleId,
						);
					}
					const subBytes = renderSegment(
						sub,
						lc,
						emplaced || item.kind === "emplace",
					);
					if (item.kind === "emit") bytes.push(...subBytes);
					lc += BigInt(subBytes.length); // emplace reserves without emitting
					break;
				}
			}
		}

		onStack.delete(segment.name);
		stackList.pop();
		sizes.set(segment.name, BigInt(bytes.length));
		return bytes;
	}

	const root = segments.get(rootName);
	const bytes = root ? renderSegment(root, 0n, false) : [];
	return { bytes, bases, resSizes, sizes };
}
