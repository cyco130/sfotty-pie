import { useState } from "preact/hooks";
import { KEYS } from "../keyboard-docs.ts";
import type { Key as KeyData } from "../keyboard-docs.ts";
import { Key } from "./key.tsx";
import { KeyInfo } from "./key-info.tsx";

// Layout is in key "units"; PITCH is the rem width of one unit (slot incl. gap).
// Every main row sums to W units, so the rows line up regardless of key count.
const PITCH = 3;
const W = 15.25;

const byRow = new Map<number, KeyData[]>();
for (const k of KEYS) {
	const arr = byRow.get(k.row);
	if (arr) arr.push(k);
	else byRow.set(k.row, [k]);
}
for (const arr of byRow.values()) arr.sort((a, b) => a.column - b.column);

// Widths progress for the left modifiers (ESC < TAB < CONTROL < left SHIFT);
// RETURN / CAPS / right SHIFT take whatever fills the row out to W.
function widthOf(k: KeyData): number {
	switch (k.name) {
		case "ESC":
			return 1.25;
		case "TAB":
			return 1.5;
		case "RETURN":
		case "CONTROL":
			return 1.75;
		case "CAPS":
			return 1.5;
		case "SHIFT":
			return k.column === 0 ? 2 : 2.25;
		default:
			return 1;
	}
}

// View-only per-key tweaks; the data is left unchanged.
const VIEW: Record<
	string,
	{ primary?: string; inverse?: boolean; small?: boolean }
> = {
	"BACK SPACE": { primary: "BKSP" },
	BREAK: { small: true },
	CONTROL: { inverse: true },
};

// Row 3 shows the XL/XE order: right SHIFT before the inverse (◩) key.
function rowKeys(r: number): KeyData[] {
	const keys = [...(byRow.get(r) ?? [])];
	if (r === 3 && keys.length >= 2) {
		const a = keys[keys.length - 2];
		const b = keys[keys.length - 1];
		if (a && b) {
			keys[keys.length - 2] = b;
			keys[keys.length - 1] = a;
		}
	}
	return keys;
}

function MainRow({
	keys,
	onHover,
	onSelect,
	selected,
}: {
	keys: KeyData[];
	onHover: (k: KeyData) => void;
	onSelect: (k: KeyData) => void;
	selected: KeyData | null;
}) {
	return (
		<div class="flex">
			{keys.map((k) => {
				const o = VIEW[k.name];
				return (
					<div
						key={`${k.row}-${k.column}`}
						class="p-0.5"
						style={{ width: `${widthOf(k) * PITCH}rem` }}
						onMouseEnter={() => onHover(k)}
						onClick={() => onSelect(k)}
					>
						<Key
							labels={k.labels}
							fill
							primary={o?.primary}
							inverse={o?.inverse}
							small={o?.small}
							selected={k === selected}
						/>
					</div>
				);
			})}
		</div>
	);
}

// Console / function keys: rounded pills, ~1.5 units wide.
function ConsoleKey({
	keyData,
	onHover,
	onSelect,
	selected,
}: {
	keyData: KeyData;
	onHover: (k: KeyData) => void;
	onSelect: (k: KeyData) => void;
	selected: boolean;
}) {
	return (
		<div
			class="p-0.5"
			style={{ width: `${1.5 * PITCH}rem` }}
			onMouseEnter={() => onHover(keyData)}
			onClick={() => onSelect(keyData)}
		>
			<div
				class={`flex h-7 items-center justify-center rounded-full border bg-neutral-700 px-1 text-[0.6rem] font-semibold text-neutral-100 ${
					selected
						? "border-amber-400 ring-2 ring-amber-400"
						: "border-neutral-600"
				}`}
			>
				{keyData.name}
			</div>
		</div>
	);
}

export function KeyboardView() {
	const [hovered, setHovered] = useState<KeyData | null>(null);
	const [locked, setLocked] = useState<KeyData | null>(null);
	const toggle = (k: KeyData) => setLocked((p) => (p === k ? null : k));
	const shown = locked ?? hovered;

	const space = byRow.get(4)?.[0];
	const consoleKeys = [...(byRow.get(5) ?? [])].reverse();
	const fkeys = byRow.get(6) ?? [];

	return (
		<div class="space-y-4">
			<div
				class="cursor-pointer overflow-x-auto select-none"
				onMouseLeave={() => setHovered(null)}
			>
				<div style={{ width: `${W * PITCH}rem` }}>
					{/* F-keys top-left, console keys top-right (reversed), gap below */}
					<div class="mb-4 flex justify-between">
						<div class="flex">
							{fkeys.map((k) => (
								<ConsoleKey
									key={k.name}
									keyData={k}
									onHover={setHovered}
									onSelect={toggle}
									selected={k === locked}
								/>
							))}
						</div>
						<div class="flex">
							{consoleKeys.map((k) => (
								<ConsoleKey
									key={k.name}
									keyData={k}
									onHover={setHovered}
									onSelect={toggle}
									selected={k === locked}
								/>
							))}
						</div>
					</div>
					{[0, 1, 2, 3].map((r) => (
						<MainRow
							key={r}
							keys={rowKeys(r)}
							onHover={setHovered}
							onSelect={toggle}
							selected={locked}
						/>
					))}
					{/* Space bar: starts just left of Z, ends near the middle of "/". */}
					<div class="flex">
						<div
							class="p-0.5"
							style={{
								marginLeft: `${2.75 * PITCH}rem`,
								width: `${8.75 * PITCH}rem`,
							}}
							onMouseEnter={() => space && setHovered(space)}
							onClick={() => space && toggle(space)}
						>
							{space && (
								<Key labels={space.labels} fill selected={space === locked} />
							)}
						</div>
					</div>
				</div>
			</div>
			<KeyInfo keyData={shown} pinned={locked !== null} />
		</div>
	);
}
