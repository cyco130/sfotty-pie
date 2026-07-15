import { useMemo, useState } from "preact/hooks";
import {
	type Command,
	labelOf,
	paletteCommands,
	searchLabel,
} from "./commands.ts";
import type { EmulatorHost } from "./host.ts";
import { LAYOUT_AUTO } from "./key-bindings-store.ts";
import {
	type Binding,
	chordLabel,
	layoutLabelsAvailable,
} from "./key-bindings.ts";
import { messages } from "./messages.ts";
import { navigate } from "./navigate.ts";

// Keyboard settings (the layout picker included) live on the devices
// view's K: tab; the links here are the second door to the same page.
const KEYBOARD_PATH = "/a8/emu/devices/keyboard";

// One displayed row: a command and one of its bound chords, or null when the
// command has no binding (shown so it's findable to bind later).
interface Row {
	command: Command;
	chord: string | null;
}

/** A caveat shown when we're guessing the layout - the browser doesn't expose it
 *  and the user hasn't picked one - so labels fall back to QWERTY. Links to the
 *  setup page; hidden once getLayoutMap works or a layout is chosen. */
export function LayoutWarning({ host }: { host: EmulatorHost }) {
	if (layoutLabelsAvailable() || host.layoutPref.value !== LAYOUT_AUTO) {
		return null;
	}
	return (
		<p class="mb-2 shrink-0 rounded-sm border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
			{messages.shortcuts.layoutWarning}{" "}
			<button
				type="button"
				class="font-medium underline"
				onClick={() => navigate(KEYBOARD_PATH)}
			>
				{messages.shortcuts.setupLayout}
			</button>
		</p>
	);
}

/**
 * The keyboard-shortcuts page: the raw binding set, one row per binding (a
 * command with several bindings repeats, VSCode-style), searchable by action or
 * chord. It shows the physical bindings only - the character channel (layout-
 * aware typing) isn't part of the table and isn't remappable, so there's no mode
 * here. Read-only for now; editing comes next.
 */
export function KeysView({ host }: { host: EmulatorHost }) {
	const [query, setQuery] = useState("");

	const rows = useMemo<Row[]>(() => {
		const byCommand = new Map<Command, Binding[]>();
		for (const b of host.keyBindings.value) {
			const list = byCommand.get(b.command);
			if (list) list.push(b);
			else byCommand.set(b.command, [b]);
		}
		// Bound commands first (each binding a row), then the unbound ones - both in
		// palette order (alphabetical by label), so a command's rows stay adjacent.
		// Within a command, its primary binding leads (matching the palette/menu),
		// the rest keeping their order (sort is stable).
		const bound: Row[] = [];
		const unbound: Row[] = [];
		for (const command of paletteCommands) {
			const bs = byCommand.get(command);
			if (bs?.length) {
				const ordered = [...bs].sort(
					(a, b) => Number(b.primary ?? false) - Number(a.primary ?? false),
				);
				for (const b of ordered)
					bound.push({
						command,
						chord: chordLabel(b, host.isMac, host.layoutLabels.value),
					});
			} else {
				unbound.push({ command, chord: null });
			}
		}
		return [...bound, ...unbound];
	}, [host.keyBindings.value, host.isMac, host.layoutLabels.value]);

	// Exact substring (not fuzzy), matched against the action label and the chord
	// - so "F1" surfaces both "Press F1" (label) and "Press Help" (its F1 chord).
	const q = query.trim().toLowerCase();
	const shown = q
		? rows.filter(
				(r) =>
					searchLabel(r.command).toLowerCase().includes(q) ||
					(r.chord?.toLowerCase().includes(q) ?? false),
			)
		: rows;

	return (
		<div class="flex min-h-0 flex-1 flex-col">
			<LayoutWarning host={host} />
			<button
				type="button"
				class="mb-2 shrink-0 self-start text-xs text-neutral-500 underline hover:text-neutral-800"
				onClick={() => navigate(KEYBOARD_PATH)}
			>
				{messages.shortcuts.keyboardTitle}
			</button>
			<input
				type="text"
				placeholder={messages.shortcuts.placeholder}
				value={query}
				autocapitalize="off"
				autocomplete="off"
				spellcheck={false}
				class="shrink-0 rounded-sm border border-neutral-300 px-2 py-1 text-sm text-neutral-900 placeholder-neutral-400 outline-none focus:border-neutral-500"
				onInput={(event) => setQuery(event.currentTarget.value)}
			/>

			{shown.length === 0 ? (
				<div class="py-4 text-sm text-neutral-500">
					{messages.shortcuts.noMatches}
				</div>
			) : (
				<ul class="mt-2 min-h-0 flex-1 divide-y divide-neutral-100 overflow-y-auto">
					{shown.map((row, index) => (
						<li key={`${row.command}:${row.chord ?? ""}:${index}`}>
							<button
								type="button"
								class="flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-neutral-100"
								onClick={() => navigate(`/a8/emu/keys/${row.command}`)}
							>
								<span
									class={row.chord ? "text-neutral-700" : "text-neutral-400"}
								>
									{labelOf(row.command)}
								</span>
								{row.chord && (
									<kbd class="shrink-0 font-mono text-xs text-neutral-500">
										{row.chord}
									</kbd>
								)}
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
