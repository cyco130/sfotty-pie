import type { SymbolKind } from "./symbols.ts";

/**
 * A layout item, produced during collection. Byte runs and `.org` are concrete;
 * a label resolves to the location counter when render reaches it; `.emit` /
 * `.emplace` place another segment at the current location.
 */
export type Item =
	| { kind: "bytes"; bytes: number[] }
	| { kind: "org"; addr: bigint }
	| {
			kind: "label";
			name: string;
			symbolKind: SymbolKind;
			span: readonly [number, number];
	  }
	| {
			kind: "emit" | "emplace";
			segment: string;
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
	name: string,
	value: bigint,
	kind: SymbolKind,
	span: readonly [number, number],
) => void;

type Reporter = (message: string, span: readonly [number, number]) => void;

export interface RenderResult {
	bytes: number[];
	/** The base (absolute load address) each rendered segment landed at. */
	bases: Map<string, bigint>;
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
	report: Reporter,
): RenderResult {
	const bases = new Map<string, bigint>();
	const onStack = new Set<string>();

	function renderSegment(segment: Segment, baseLC: bigint): number[] {
		bases.set(segment.name, baseLC);
		onStack.add(segment.name);

		let lc = baseLC;
		const bytes: number[] = [];
		for (const item of segment.items) {
			switch (item.kind) {
				case "bytes":
					bytes.push(...item.bytes);
					lc += BigInt(item.bytes.length);
					break;
				case "org":
					lc = item.addr;
					break;
				case "label":
					defineLabel(item.name, lc, item.symbolKind, item.span);
					break;
				case "emit":
				case "emplace": {
					const sub = segments.get(item.segment);
					if (!sub) {
						report(`Unknown segment "${item.segment}"`, item.span);
						break;
					}
					if (onStack.has(sub.name)) {
						report(
							`Circular .${item.kind} of segment "${sub.name}"`,
							item.span,
						);
						break;
					}
					const subBytes = renderSegment(sub, lc);
					if (item.kind === "emit") bytes.push(...subBytes);
					lc += BigInt(subBytes.length); // emplace reserves without emitting
					break;
				}
			}
		}

		onStack.delete(segment.name);
		return bytes;
	}

	const root = segments.get(rootName);
	const bytes = root ? renderSegment(root, 0n) : [];
	return { bytes, bases };
}
