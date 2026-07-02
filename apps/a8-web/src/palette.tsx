import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { characterChords } from "./char-keys.ts";
import { highlight, rankCommands } from "./command-picker.tsx";
import { type Command, labelOf } from "./commands.ts";
import type { EmulatorHost } from "./host.ts";
import { primaryChords } from "./key-bindings.ts";
import { LayoutWarning } from "./keys.tsx";
import { messages } from "./messages.ts";
import { currentPath } from "./navigate.ts";

/**
 * The command palette as a sidebar panel: a fuzzy-filtered list over the
 * application verbs. The same {@link EmulatorHost.dispatch} the toolbar and key
 * bindings use, so every surface drives one set of commands. Mounted only while
 * showing, so it focuses its search box on mount; the container handles Esc.
 */
export function PaletteView({ host }: { host: EmulatorHost }) {
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const selectedRef = useRef<HTMLLIElement>(null);

	// Focus the search box when the panel opens.
	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	// Each command's primary binding chord, shown beside it. Recomputed only when
	// the binding set changes (e.g. a reset), not per keystroke.
	const bindingChords = useMemo(
		() =>
			primaryChords(
				host.keyBindings.value,
				host.isMac,
				host.layoutLabels.value,
			),
		[host.keyBindings.value, host.isMac, host.layoutLabels.value],
	);
	// In Character mode, the matrix keys are typed, so show the produced character
	// (e.g. "!", "-") rather than the positional binding ("Shift+1", "[").
	const mode = host.keyboardMode.value;
	const chordFor = (command: Command): string | undefined =>
		(mode === "character" ? characterChords.get(command) : undefined) ??
		bindingChords.get(command);

	const results = rankCommands(query);
	const active = Math.min(selected, Math.max(0, results.length - 1));

	// Keep the highlighted row in view as it moves past the scroll edges.
	useEffect(() => {
		selectedRef.current?.scrollIntoView({ block: "nearest" });
	}, [active]);

	const run = (command: Command | undefined) => {
		if (!command) return;
		host.dispatch(command);
		// A command that opened another panel (the menu, ROM preferences) has
		// already navigated; closing now would clobber it. Only close if we're
		// still on the palette.
		if (currentPath() === "/a8/emu/palette") host.closePanel();
	};

	const onKeyDown = (event: KeyboardEvent) => {
		switch (event.key) {
			case "ArrowDown":
				event.preventDefault();
				setSelected(Math.min(active + 1, results.length - 1));
				break;
			case "ArrowUp":
				event.preventDefault();
				setSelected(Math.max(active - 1, 0));
				break;
			case "Enter":
				event.preventDefault();
				run(results[active]?.command);
				break;
		}
	};

	return (
		<div class="flex min-h-0 flex-1 flex-col">
			<LayoutWarning host={host} />
			<input
				ref={inputRef}
				type="text"
				placeholder={messages.palette.placeholder}
				value={query}
				autocapitalize="off"
				autocomplete="off"
				spellcheck={false}
				class="shrink-0 rounded border border-neutral-300 px-2 py-1 text-sm text-neutral-900 placeholder-neutral-400 outline-none focus:border-neutral-500"
				onInput={(event) => {
					setQuery(event.currentTarget.value);
					setSelected(0);
				}}
				onKeyDown={onKeyDown}
			/>

			{results.length === 0 ? (
				<div class="py-4 text-sm text-neutral-500">
					{messages.palette.noCommands}
				</div>
			) : (
				<ul class="mt-2 min-h-0 flex-1 overflow-y-auto">
					{results.map(({ command, positions }, index) => {
						const chord = chordFor(command);
						return (
							<li
								key={command}
								ref={index === active ? selectedRef : null}
								class={`flex cursor-pointer items-center justify-between gap-3 rounded px-2 py-1.5 text-sm ${
									index === active
										? "bg-neutral-200 text-neutral-900"
										: "text-neutral-700"
								}`}
								onMouseMove={() => setSelected(index)}
								onClick={() => run(command)}
							>
								<span>{highlight(labelOf(command), positions)}</span>
								{chord && (
									<kbd class="shrink-0 font-mono text-xs text-neutral-400">
										{chord}
									</kbd>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
