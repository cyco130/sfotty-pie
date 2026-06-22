import { FUNCTIONS } from "../keyboard-docs.ts";
import type {
	AtasciiFunction,
	FunctionRef,
	Key as KeyData,
	KeyFunction,
	PrintableAtascii,
} from "../keyboard-docs.ts";

const hex = (n: number) => "$" + n.toString(16).toUpperCase().padStart(2, "0");
const num = (n: number) => `${hex(n)} (${n})`;

function toAntic(code: number): number {
	if (code < 0x20) return code + 0x40;
	if (code < 0x60) return code - 0x20;
	return code;
}

function isChar(f: KeyFunction): f is PrintableAtascii | AtasciiFunction {
	return "code" in f;
}
function isControl(
	f: PrintableAtascii | AtasciiFunction,
): f is AtasciiFunction {
	return "glyphName" in f;
}

// What a single modifier slot produces: a glyph + name with its ATASCII/ANTIC
// codes (and inverse +$80), or a named/pseudo function. Equivalents and the
// replaces-ASCII note are intentionally omitted.
function Produced({ refKey }: { refKey: FunctionRef }) {
	const f: KeyFunction = FUNCTIONS[refKey];
	if (isChar(f)) {
		const base = f.code & 0x7f;
		const highBit = (f.code & 0x80) !== 0;
		const name = isControl(f)
			? `${f.name} (${highBit ? "(INVERTED) " : ""}${f.glyphName})`
			: f.name;
		const alt = isControl(f) ? undefined : f.altGlyph;
		return (
			<div class="space-y-0.5">
				<div>
					<span
						class={`mr-2 text-lg ${
							highBit ? "rounded-xs bg-neutral-300 px-1 text-neutral-900" : ""
						}`}
					>
						{f.glyph}
					</span>
					<span class="text-neutral-200">{name}</span>
				</div>
				{alt && (
					<div class="text-xs text-neutral-500">
						intl: <span class="text-neutral-300">{alt.glyph}</span> {alt.name}
					</div>
				)}
				<div class="font-mono text-xs text-neutral-500">
					ATASCII {num(base)} · +$80 {num(base | 0x80)}
				</div>
				<div class="font-mono text-xs text-neutral-500">
					ANTIC {num(toAntic(base))} · +$80 {num(toAntic(base) | 0x80)}
				</div>
			</div>
		);
	}
	return (
		<div class="space-y-0.5">
			<div class="text-neutral-200">{f.name}</div>
			{f.pseudoAtascii !== undefined && (
				<div class="font-mono text-xs text-neutral-500">
					pseudo-ATASCII {num(f.pseudoAtascii)}
				</div>
			)}
			{f.handledInKeyboardIrq && (
				<div class="text-xs text-neutral-500">
					Handled in the keyboard IRQ — not remappable.
				</div>
			)}
			{f.notes?.map((n) => (
				<div key={n} class="text-xs text-neutral-500">
					{n}
				</div>
			))}
		</div>
	);
}

const SLOTS = [
	["function", "Key"],
	["withShift", "Shift"],
	["withControl", "Control"],
] as const;

function Heading({ children }: { children: string }) {
	return (
		<div class="mb-1 text-xs font-semibold tracking-wide text-neutral-400 uppercase">
			{children}
		</div>
	);
}

export function KeyInfo({
	keyData,
	pinned = false,
}: {
	keyData: KeyData | null;
	pinned?: boolean;
}) {
	if (!keyData) {
		return (
			<div class="min-h-36 rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 text-sm text-neutral-500">
				Hover a key to see its scan codes and what it produces.
			</div>
		);
	}

	const c = keyData.pokeyCode;
	const noShiftCtrl = keyData.isControlAndShiftScannable === false;

	return (
		<div class="min-h-36 space-y-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 text-sm">
			<div class="flex items-center gap-2">
				<span class="text-base font-semibold text-neutral-100">
					{keyData.name}
				</span>
				{pinned && (
					<span class="rounded bg-amber-400/20 px-1.5 py-0.5 text-xs font-medium text-amber-300">
						Pinned — click again to release
					</span>
				)}
			</div>

			{c !== undefined && (
				<div>
					<Heading>Scan code</Heading>
					<div class="flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-xs text-neutral-300">
						<div>base {num(c)}</div>
						<div>+Shift {num(c | 0x40)}</div>
						<div>+Control {num(c | 0x80)}</div>
						<div class={noShiftCtrl ? "text-neutral-600" : ""}>
							+Shift+Ctrl {num(c | 0xc0)}
							{noShiftCtrl && " — not scannable"}
						</div>
					</div>
				</div>
			)}

			{keyData.notes && keyData.notes.length > 0 && (
				<div>
					<Heading>Notes</Heading>
					<ul class="list-disc space-y-0.5 pl-5 text-xs text-neutral-400">
						{keyData.notes.map((n) => (
							<li key={n}>{n}</li>
						))}
					</ul>
				</div>
			)}

			{(keyData.function || keyData.withShift || keyData.withControl) && (
				<div>
					<Heading>Produces</Heading>
					<div class="space-y-2">
						{SLOTS.map(([slot, label]) => {
							const ref = keyData[slot];
							if (!ref) return null;
							return (
								<div key={slot} class="flex gap-3">
									<div class="w-16 shrink-0 pt-px text-neutral-500">
										{label}
									</div>
									<Produced refKey={ref} />
								</div>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
