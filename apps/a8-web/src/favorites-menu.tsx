import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { favoritesView } from "./favorites.ts";
import { normalize } from "./gamepad-normalize.ts";
import type { EmulatorHost } from "./host.ts";
import type { ImageEntry } from "./images/metadata.ts";
import { messages } from "./messages.ts";
import { recentsView } from "./recents.ts";

// Held-direction repeat, in poll frames (~60/s): the first step is instant,
// the second waits the initial delay, then it repeats steadily.
const REPEAT_DELAY = 24;
const REPEAT_EVERY = 8;

// How many recently-played games the top section shows.
const RECENTS_SHOWN = 5;

// A picker section: a heading and its games.
interface Section {
	title: string;
	entries: ImageEntry[];
}

/**
 * The couch game picker: a full-screen, gamepad-first overlay over the paused
 * machine — recently played on top, then the starred favorites. It reads the
 * pads itself (through the normalization layer, so remapped pads navigate
 * with whatever they mapped): D-pad/left stick moves with key-style repeat,
 * fire/A boots, B (or the button that opened it) backs out. Arrow keys, Enter
 * and Escape mirror the same actions, and rows are clickable, so it degrades
 * to desk use. Opened via the OPEN_FAVORITES command (default: R3).
 */
export function FavoritesMenu({ host }: { host: EmulatorHost }) {
	// MRU only (no built-in seeds — the picker is a shelf, not a catalog).
	const recents = recentsView.value
		.filter((item) => item.recent)
		.slice(0, RECENTS_SHOWN)
		.map((item) => item.entry);
	const favorites = favoritesView.value;

	const sections: Section[] = [
		{ title: messages.favorites.recentsTitle, entries: recents },
		{ title: messages.favorites.title, entries: favorites },
	].filter((s) => s.entries.length > 0);
	const flat = sections.flatMap((s) => s.entries);

	const [selected, setSelected] = useState(0);
	const selectedRef = useRef(0);
	useEffect(() => {
		selectedRef.current = selected;
	}, [selected]);
	const flatRef = useRef(flat);
	flatRef.current = flat;

	// Stable (they read only refs), so the input effects below never restart —
	// a restart would reset the held-direction repeat state mid-hold.
	const move = useCallback(
		(dir: -1 | 1) =>
			setSelected((i) =>
				Math.max(0, Math.min(flatRef.current.length - 1, i + dir)),
			),
		[],
	);
	const activate = useCallback(() => {
		const entry = flatRef.current[selectedRef.current];
		if (entry) host.closeFavorites(entry.id);
	}, [host]);

	// Keep the selection visible as it moves.
	useEffect(() => {
		document
			.querySelector(`[data-pick="${selected}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [selected]);

	// The pad poll: all connected pads OR together, read through their
	// normalization profiles. Buttons held when the picker opens (the one that
	// opened it, a fire held in-game) are baselined out by starting the edge
	// trackers pressed.
	useEffect(() => {
		const prev = { a: true, b: true, open: true };
		let heldFrames = 0;
		let raf = requestAnimationFrame(function tick() {
			raf = requestAnimationFrame(tick);
			const profiles = host.gamepadNormalize.peek();
			let up = false;
			let down = false;
			let a = false;
			let b = false;
			let open = false;
			for (const pad of navigator.getGamepads()) {
				if (!pad) continue;
				const view = normalize(pad, profiles[pad.id]);
				const y = view.axes[1] ?? 0;
				up ||= (view.buttons[12]?.pressed ?? false) || y < -0.5;
				down ||= (view.buttons[13]?.pressed ?? false) || y > 0.5;
				a ||= view.buttons[0]?.pressed ?? false;
				b ||= view.buttons[1]?.pressed ?? false;
				open ||= view.buttons[11]?.pressed ?? false;
			}

			const dir = up && !down ? -1 : down && !up ? 1 : 0;
			if (dir === 0) {
				heldFrames = 0;
			} else {
				const fire =
					heldFrames === 0 ||
					(heldFrames >= REPEAT_DELAY &&
						(heldFrames - REPEAT_DELAY) % REPEAT_EVERY === 0);
				heldFrames++;
				if (fire) move(dir);
			}

			if (a && !prev.a) activate();
			if ((b && !prev.b) || (open && !prev.open)) host.closeFavorites();
			prev.a = a;
			prev.b = b;
			prev.open = open;
		});
		return () => cancelAnimationFrame(raf);
	}, [host, move, activate]);

	// Keyboard mirror, on the capture phase so the emulator's own keyboard
	// handling (harmless while paused, but noisy) never sees these keys.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "ArrowUp") move(-1);
			else if (e.key === "ArrowDown") move(1);
			else if (e.key === "Enter") activate();
			else if (e.key === "Escape") host.closeFavorites();
			else return;
			e.preventDefault();
			e.stopPropagation();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [host, move, activate]);

	let index = 0;
	return (
		<div class="fixed inset-0 z-30 flex flex-col gap-6 overflow-y-auto bg-neutral-950/95 p-10 text-white">
			{sections.length === 0 && (
				<p class="m-auto max-w-md text-center text-2xl text-neutral-400">
					{messages.favorites.empty}
				</p>
			)}
			{sections.map((section) => (
				<section key={section.title}>
					<h2 class="mb-3 text-sm font-semibold tracking-widest text-neutral-500 uppercase">
						{section.title}
					</h2>
					<ul class="flex flex-col gap-1">
						{section.entries.map((entry) => {
							const i = index++;
							return (
								<li key={`${section.title}:${entry.id}`}>
									<button
										type="button"
										data-pick={i}
										class={`w-full truncate rounded-md px-4 py-2 text-left text-2xl ${
											i === selected
												? "bg-sky-600 text-white"
												: "text-neutral-300 hover:bg-neutral-800"
										}`}
										onMouseEnter={() => setSelected(i)}
										onClick={() => host.closeFavorites(entry.id)}
									>
										{entry.user.displayName}
									</button>
								</li>
							);
						})}
					</ul>
				</section>
			))}
			<p class="mt-auto pt-4 text-center text-sm text-neutral-500">
				{messages.favorites.hint}
			</p>
		</div>
	);
}
