import { AtasciiTable } from "./atascii-table.tsx";
import { KeyboardMatrix } from "./keyboard-matrix.tsx";
import { KeyboardTable } from "./keyboard-table.tsx";
import { KeyboardView } from "./keyboard-view.tsx";

export function Docs() {
	return (
		<div class="min-h-screen bg-neutral-950 text-neutral-200">
			<header class="border-b border-neutral-800 px-4 py-4">
				<h1 class="text-xl font-semibold text-neutral-100">
					Atari 8-bit reference
				</h1>
				<p class="mt-1 text-sm text-neutral-500">
					Character set and keyboard tables, generated from the keyboard
					reference data.
				</p>
			</header>
			<main class="mx-auto max-w-5xl space-y-12 px-4 py-8">
				<section>
					<h2 class="mb-3 text-lg font-semibold text-neutral-100">Keyboard</h2>
					<KeyboardView />
				</section>
				<section>
					<h2 class="mb-3 text-lg font-semibold text-neutral-100">
						ATASCII / ANTIC ($00–$7F)
					</h2>
					<p class="mb-4 text-sm text-neutral-500">
						Printable glyphs (with the international character-set alternate),
						graphics characters, the key that produces each code, and the editor
						function (plus its inverse-video, $80+, form) for control codes.
						Click ATASCII, ANTIC, or Key to sort.
					</p>
					<div class="overflow-x-auto rounded-lg border border-neutral-800">
						<AtasciiTable />
					</div>
				</section>
				<section>
					<h2 class="mb-3 text-lg font-semibold text-neutral-100">
						Keyboard codes
					</h2>
					<p class="mb-4 text-sm text-neutral-500">
						POKEY scan code for each matrix key, plus the KBCODE for each
						modifier combination; unmapped codes show as None and the
						non-scannable Shift+Ctrl codes ($C0–$C7, $D0–$D7) are grayed out.
						Ordered as digits, letters, punctuation, then other keys; click a
						header to sort by code or label.
					</p>
					<div class="overflow-x-auto rounded-lg border border-neutral-800">
						<KeyboardTable />
					</div>
				</section>
				<section>
					<h2 class="mb-3 text-lg font-semibold text-neutral-100">
						Keyboard matrix
					</h2>
					<p class="mb-4 text-sm text-neutral-500">
						The 64 POKEY scan codes as the 8×8 matrix (row = high 3 bits, column
						= low 3 bits). Control, Shift, and Break have no scan code of their
						own — the hardware reads each on the same scan as $00, $10, and $30.
					</p>
					<KeyboardMatrix />
				</section>
			</main>
		</div>
	);
}
