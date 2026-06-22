import { KEYS } from "../keyboard-docs.ts";
import type { Key as KeyData } from "../keyboard-docs.ts";
import { Key } from "./key.tsx";

const hex = (n: number) => "$" + n.toString(16).toUpperCase().padStart(2, "0");

const keyByCode = new Map<number, KeyData>();
for (const k of KEYS) {
	if (k.pokeyCode !== undefined) keyByCode.set(k.pokeyCode, k);
}

// Modifier keys without their own scan code: the hardware reads each on the same
// scan as the listed code.
const COSCAN: Record<number, string> = {
	0x00: "Control",
	0x10: "Shift",
	0x30: "Break",
};

const AXIS = [0, 1, 2, 3, 4, 5, 6, 7];

function Cell({ code }: { code: number }) {
	const key = keyByCode.get(code);
	const coscan = COSCAN[code];
	return (
		<div class="flex flex-col items-center gap-1 rounded border border-neutral-800 bg-neutral-900/40 p-1.5">
			<div class="font-mono text-[0.65rem] text-neutral-500">{hex(code)}</div>
			{key ? (
				<Key labels={key.labels} />
			) : (
				<span class="py-1 text-xs text-neutral-700 italic">None</span>
			)}
			{coscan && (
				<div class="rounded bg-neutral-700 px-1.5 py-0.5 text-[0.65rem] font-semibold text-neutral-100">
					+{coscan}
				</div>
			)}
		</div>
	);
}

export function KeyboardMatrix() {
	return (
		<div class="overflow-x-auto">
			<div
				class="inline-grid gap-1.5"
				style={{ gridTemplateColumns: "auto repeat(8, auto)" }}
			>
				<div />
				{AXIS.map((c) => (
					<div
						key={`c${c}`}
						class="text-center font-mono text-xs text-neutral-500"
					>
						{c}
					</div>
				))}
				{AXIS.flatMap((r) => [
					<div
						key={`r${r}`}
						class="flex items-center justify-end pr-1 font-mono text-xs text-neutral-500"
					>
						{r}
					</div>,
					...AXIS.map((c) => {
						const code = (r << 3) | c;
						return <Cell key={code} code={code} />;
					}),
				])}
			</div>
		</div>
	);
}
