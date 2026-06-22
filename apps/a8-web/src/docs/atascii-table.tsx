import { useState } from "preact/hooks";
import { FUNCTIONS, KEYS } from "../keyboard-docs.ts";
import type {
	AtasciiFunction,
	FunctionRef,
	Key as KeyData,
	PrintableAtascii,
} from "../keyboard-docs.ts";
import { Key } from "./key.tsx";
import { cmpLabel, SortHeader, TABLE, TD, TH } from "./table.tsx";

type CharEntry = PrintableAtascii | AtasciiFunction;

function isControl(f: CharEntry): f is AtasciiFunction {
	return "glyphName" in f;
}

// The glyph's name: the Unicode-ish name for printables, the glyph name for
// control codes (shown the same way).
function glyphLabel(f: CharEntry): string {
	return isControl(f) ? f.glyphName : f.name;
}

// ATASCII -> ANTIC (screen / internal) code, standard character set:
//   $00-$1F -> $40-$5F, $20-$5F -> $00-$3F, $60-$7F unchanged.
function toAntic(code: number): number {
	if (code < 0x20) return code + 0x40;
	if (code < 0x60) return code - 0x20;
	return code;
}

const hex = (n: number) => "$" + n.toString(16).toUpperCase().padStart(2, "0");

const byCode = new Map<number, CharEntry>();
for (const f of Object.values(FUNCTIONS)) {
	if ("code" in f) byCode.set(f.code, f);
}

// Which physical key (and modifier) produces each ATASCII code. Prefer the
// unmodified key, then Shift, then Control.
interface Producer {
	labels: KeyData["labels"];
	modifier?: "Shift" | "Control";
}
const codeToKey = new Map<number, Producer>();
function codeOf(ref: FunctionRef | undefined): number | undefined {
	if (ref === undefined) return undefined;
	const f = FUNCTIONS[ref];
	return "code" in f ? f.code : undefined;
}
for (const [slot, modifier] of [
	["function", undefined],
	["withShift", "Shift"],
	["withControl", "Control"],
] as const) {
	for (const k of KEYS) {
		const code = codeOf(k[slot]);
		if (code === undefined || code > 0x7f || codeToKey.has(code)) continue;
		codeToKey.set(code, { labels: k.labels, modifier });
	}
}

interface Row {
	atascii: number;
	antic: number;
	entry: CharEntry;
	inverted?: AtasciiFunction; // the high-bit (inverse-video) function, if any
}

const ROWS: Row[] = [];
for (let c = 0; c <= 0x7f; c++) {
	const entry = byCode.get(c);
	if (!entry) continue;
	const high = byCode.get(c | 0x80);
	ROWS.push({
		atascii: c,
		antic: toAntic(c),
		entry,
		inverted: high && isControl(high) ? high : undefined,
	});
}

type SortKey = "atascii" | "antic" | "key";

const modRank = (m?: "Shift" | "Control") =>
	m === "Shift" ? 1 : m === "Control" ? 2 : 0;

// The base code, plus its inverse-video counterpart (high bit set) on a second
// line — rendered in inverse video (filled chip) and muted.
function Code({
	value,
	accent,
	invChip,
}: {
	value: number;
	accent: string;
	invChip: string;
}) {
	const inv = value | 0x80;
	return (
		<span class="inline-flex flex-col items-start gap-1 font-mono whitespace-nowrap">
			<span>
				<span class={accent}>{hex(value)}</span>
				<span class="ml-1.5 text-xs text-neutral-500">{value}</span>
			</span>
			<span class={`rounded-xs px-1 text-xs ${invChip}`}>
				{hex(inv)}
				<span class="ml-1.5 opacity-70">{inv}</span>
			</span>
		</span>
	);
}

function Dash() {
	return <span class="text-neutral-700">—</span>;
}

function KeyCell({ code }: { code: number }) {
	const p = codeToKey.get(code);
	if (!p) return <span class="text-neutral-600 italic">None</span>;
	return (
		<span class="inline-flex items-center gap-1.5">
			{p.modifier && (
				<span class="rounded bg-neutral-700 px-1.5 py-0.5 text-xs font-semibold text-neutral-100">
					{p.modifier}
				</span>
			)}
			<Key labels={p.labels} />
		</span>
	);
}

export function AtasciiTable() {
	const [sortKey, setSortKey] = useState<SortKey>("atascii");
	const rows = [...ROWS].sort((a, b) => {
		if (sortKey === "antic") return a.antic - b.antic;
		if (sortKey === "key") {
			const pa = codeToKey.get(a.atascii);
			const pb = codeToKey.get(b.atascii);
			return (
				cmpLabel(pa?.labels[0], pb?.labels[0]) ||
				modRank(pa?.modifier) - modRank(pb?.modifier) ||
				a.atascii - b.atascii
			);
		}
		return a.atascii - b.atascii;
	});

	return (
		<table class={TABLE}>
			<thead>
				<tr>
					<SortHeader
						label="ATASCII"
						active={sortKey === "atascii"}
						onClick={() => setSortKey("atascii")}
					/>
					<SortHeader
						label="ANTIC"
						active={sortKey === "antic"}
						onClick={() => setSortKey("antic")}
					/>
					<th class={`${TH} text-left`}>Glyph</th>
					<SortHeader
						label="Key"
						active={sortKey === "key"}
						onClick={() => setSortKey("key")}
						thClass="text-right"
					/>
					<th class={`${TH} text-left`}>Function</th>
					<th class={`${TH} text-left`}>Inverse function</th>
					<th class={`${TH} text-left`}>Notes</th>
				</tr>
			</thead>
			<tbody>
				{rows.map((row) => {
					const f = row.entry;
					const ctrl = isControl(f);
					const alt = !ctrl ? f.altGlyph : undefined;
					return (
						<tr key={row.atascii} class="hover:bg-neutral-900/50">
							<td class={TD}>
								<Code
									value={row.atascii}
									accent="text-amber-300"
									invChip="bg-amber-300/70 text-neutral-900"
								/>
							</td>
							<td class={TD}>
								<Code
									value={row.antic}
									accent="text-sky-300"
									invChip="bg-sky-300/70 text-neutral-900"
								/>
							</td>
							<td class={TD}>
								<div class="text-lg leading-none">{f.glyph}</div>
								<div class="mt-1 text-xs text-neutral-300">{glyphLabel(f)}</div>
								{alt && (
									<div class="mt-0.5 text-xs text-neutral-500">
										intl: <span class="text-neutral-300">{alt.glyph}</span>{" "}
										{alt.name}
									</div>
								)}
							</td>
							<td class={`${TD} text-right`}>
								<KeyCell code={row.atascii} />
							</td>
							<td class={TD}>
								{ctrl ? (
									<span class="text-neutral-200">{f.name}</span>
								) : (
									<Dash />
								)}
							</td>
							<td class={TD}>
								{ctrl && row.inverted ? (
									<span class="text-neutral-200">{row.inverted.name}</span>
								) : (
									<Dash />
								)}
							</td>
							<td class={TD}>
								{f.replacesAscii ? (
									<span class="text-xs text-neutral-400">
										replaces ASCII {f.replacesAscii}
									</span>
								) : (
									<Dash />
								)}
							</td>
						</tr>
					);
				})}
			</tbody>
		</table>
	);
}
