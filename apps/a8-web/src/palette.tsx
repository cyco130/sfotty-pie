import type { ComponentChild } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { type Command, labelOf, paletteCommands } from "./commands.ts";
import type { EmulatorHost } from "./host.ts";
import { messages } from "./messages.ts";
import { currentPath } from "./navigate.ts";

interface FuzzyMatch {
	score: number;
	/** Indices in the target that matched, ascending — for highlighting. */
	positions: number[];
}

const WORD_BREAK = /[\s(/_-]/;

/** Score a single matched character by where it lands in the target. */
function charBonus(
	target: string,
	index: number,
	consecutive: boolean,
): number {
	let bonus = 1; // base, per matched character
	const ch = target[index]!;
	if (index === 0) {
		bonus += 8; // start of string
	} else {
		const prev = target[index - 1]!;
		if (WORD_BREAK.test(prev)) {
			bonus += 7; // first letter of a word
		} else if (prev === prev.toLowerCase() && ch !== ch.toLowerCase()) {
			bonus += 7; // camelCase boundary
		}
	}
	if (consecutive) bonus += 5; // adjacent to the previous match
	return bonus;
}

/**
 * VSCode-style fuzzy match: the query must appear as a subsequence of the
 * target, scored to favor matches at word starts and runs of adjacent
 * characters. Returns null when the subsequence isn't present.
 */
function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
	if (query === "") return { score: 0, positions: [] };
	const q = query.toLowerCase();
	const t = target.toLowerCase();
	const memo = new Map<string, FuzzyMatch | null>();

	const best = (
		qi: number,
		ti: number,
		consecutive: boolean,
	): FuzzyMatch | null => {
		if (qi === q.length) return { score: 0, positions: [] };
		if (ti === target.length) return null;
		const key = `${qi}:${ti}:${consecutive ? 1 : 0}`;
		const cached = memo.get(key);
		if (cached !== undefined) return cached;

		let result = best(qi, ti + 1, false); // skip this target char
		if (q[qi] === t[ti]) {
			const rest = best(qi + 1, ti + 1, true);
			if (rest) {
				const matched: FuzzyMatch = {
					score: charBonus(target, ti, consecutive) + rest.score,
					positions: [ti, ...rest.positions],
				};
				// Prefer matching on ties — it keeps the run tighter.
				if (!result || matched.score >= result.score) result = matched;
			}
		}
		memo.set(key, result);
		return result;
	};

	return best(0, 0, false);
}

// Contiguous matches win decisively over scattered subsequences, tiered like
// VSCode's: exact > prefix > word-boundary substring > mid-word substring. The
// gaps (1000) sit far above any fuzzy-subsequence score, and subtracting the
// length ranks shorter targets first within a tier.
const EXACT = 4000;
const PREFIX = 3000;
const WORD = 2000;
const SUBSTRING = 1000;

/**
 * Match a query against one command's description. A contiguous (substring)
 * hit scores in a high tier so it ranks above any scattered subsequence;
 * otherwise it falls back to the fuzzy subsequence matcher.
 */
function matchCommand(query: string, target: string): FuzzyMatch | null {
	const q = query.toLowerCase();
	const t = target.toLowerCase();
	const index = t.indexOf(q);
	if (index !== -1) {
		const tier =
			t === q
				? EXACT
				: index === 0
					? PREFIX
					: WORD_BREAK.test(t[index - 1]!)
						? WORD
						: SUBSTRING;
		const positions: number[] = [];
		for (let i = 0; i < q.length; i++) positions.push(index + i);
		return { score: tier - target.length, positions };
	}
	return fuzzyMatch(q, target);
}

/** Render `text` with the fuzzy-matched character runs emphasized. */
function highlight(text: string, positions: number[]): ComponentChild {
	if (positions.length === 0) return text;
	const matched = new Set(positions);
	const parts: ComponentChild[] = [];
	let buf = "";
	let bufMatched = false;
	const flush = () => {
		if (!buf) return;
		parts.push(
			bufMatched ? (
				<strong class="font-semibold text-black">{buf}</strong>
			) : (
				buf
			),
		);
		buf = "";
	};
	for (let i = 0; i < text.length; i++) {
		const isMatch = matched.has(i);
		if (isMatch !== bufMatched) {
			flush();
			bufMatched = isMatch;
		}
		buf += text[i];
	}
	flush();
	return parts;
}

interface Result {
	command: Command;
	positions: number[];
}

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

	const trimmed = query.trim();
	const results: Result[] = trimmed
		? paletteCommands
				.map((command) => ({
					command,
					match: matchCommand(trimmed, labelOf(command)),
				}))
				.filter(
					(entry): entry is { command: Command; match: FuzzyMatch } =>
						entry.match !== null,
				)
				.sort(
					(a, b) =>
						b.match.score - a.match.score ||
						labelOf(a.command).length - labelOf(b.command).length,
				)
				.map(({ command, match }) => ({ command, positions: match.positions }))
		: paletteCommands.map((command) => ({ command, positions: [] }));
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
					{results.map(({ command, positions }, index) => (
						<li
							key={command}
							ref={index === active ? selectedRef : null}
							class={`cursor-pointer rounded px-2 py-1.5 text-sm ${
								index === active
									? "bg-neutral-200 text-neutral-900"
									: "text-neutral-700"
							}`}
							onMouseMove={() => setSelected(index)}
							onClick={() => run(command)}
						>
							{highlight(labelOf(command), positions)}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
