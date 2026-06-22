import { useState } from "preact/hooks";
import { KEYS } from "../keyboard-docs.ts";
import type { Key as KeyData } from "../keyboard-docs.ts";
import { Key } from "./key.tsx";
import { cmpLabel, SortHeader, TABLE, TD, TH } from "./table.tsx";

const hex = (n: number) => "$" + n.toString(16).toUpperCase().padStart(2, "0");

interface Row {
	code: number;
	key?: KeyData;
}

const keyByCode = new Map<number, KeyData>();
for (const k of KEYS) {
	if (k.pokeyCode !== undefined) keyByCode.set(k.pokeyCode, k);
}

// POKEY codes are 6-bit; list the whole 0x00-0x3F range so unmapped positions
// show up too.
const ROWS: Row[] = [];
for (let c = 0; c <= 0x3f; c++) ROWS.push({ code: c, key: keyByCode.get(c) });

type SortKey = "code" | "label";

// A KBCODE cell (hex + decimal). `gray` dims a combination the hardware can't
// scan; `accent` colours the base code.
function CodeCell({
	value,
	accent,
	gray,
}: {
	value: number;
	accent?: string;
	gray?: boolean;
}) {
	return (
		<td class={`${TD} font-mono whitespace-nowrap`}>
			<span class={gray ? "text-neutral-600" : (accent ?? "text-neutral-300")}>
				{hex(value)}
			</span>
			<span
				class={`ml-1.5 text-xs ${gray ? "text-neutral-700" : "text-neutral-500"}`}
			>
				{value}
			</span>
		</td>
	);
}

export function KeyboardTable() {
	const [sortKey, setSortKey] = useState<SortKey>("label");
	const rows = [...ROWS].sort((a, b) =>
		sortKey === "code"
			? a.code - b.code
			: cmpLabel(a.key?.labels[0], b.key?.labels[0]),
	);

	return (
		<table class={TABLE}>
			<thead>
				<tr>
					<SortHeader
						label="POKEY code"
						active={sortKey === "code"}
						onClick={() => setSortKey("code")}
					/>
					<th class={`${TH} text-left`}>w/Shift</th>
					<th class={`${TH} text-left`}>w/Control</th>
					<th class={`${TH} text-left`}>w/Shift+Ctrl</th>
					<SortHeader
						label="Key labels"
						active={sortKey === "label"}
						onClick={() => setSortKey("label")}
					/>
				</tr>
			</thead>
			<tbody>
				{rows.map((row) => (
					<tr key={row.code} class="hover:bg-neutral-900/50">
						<CodeCell value={row.code} accent="text-amber-300" />
						<CodeCell value={row.code | 0x40} />
						<CodeCell value={row.code | 0x80} />
						<CodeCell
							value={row.code | 0xc0}
							gray={row.key?.isControlAndShiftScannable === false}
						/>
						<td class={TD}>
							{row.key ? (
								<Key labels={row.key.labels} />
							) : (
								<span class="text-neutral-600 italic">None</span>
							)}
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}
