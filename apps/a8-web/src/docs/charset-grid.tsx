// The full character set rendered in the real charset font (A8 Screen, from
// @sfotty-pie/fonts): the 128 ATASCII characters in code order, plus the
// 29 international-set replacements. Hover a cell for the code and name.

import { FUNCTIONS } from "../keyboard-docs.ts";

const hex = (n: number) => "$" + n.toString(16).toUpperCase().padStart(2, "0");

const uPlus = (glyph: string) =>
	"U+" + glyph.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");

interface Cell {
	glyph: string;
	title: string;
}

const STANDARD: Cell[] = [];
const INTERNATIONAL: Cell[] = [];
for (const f of Object.values(FUNCTIONS)) {
	if (!("code" in f) || f.code > 0x7f) continue;
	const name = "glyphName" in f ? f.glyphName : f.name;
	STANDARD[f.code] = {
		glyph: f.glyph,
		title: `${hex(f.code)} ${uPlus(f.glyph)} ${name}`,
	};
	const alt = "altGlyph" in f ? f.altGlyph : undefined;
	if (alt) {
		INTERNATIONAL.push({
			glyph: alt.glyph,
			title: `${hex(f.code)} ${uPlus(alt.glyph)} ${alt.name}`,
		});
	}
}

function Grid({ cells }: { cells: Cell[] }) {
	return (
		<div class="overflow-x-auto">
			<div class="inline-grid grid-cols-16 rounded-lg border border-neutral-800 bg-neutral-900 p-2">
				{cells.map((cell) => (
					<div
						key={cell.title}
						class="flex size-8 items-center justify-center rounded-xs font-a8 text-2xl leading-none hover:bg-neutral-700"
						title={cell.title}
					>
						{cell.glyph}
					</div>
				))}
			</div>
		</div>
	);
}

export function CharsetGrid() {
	return (
		<div class="space-y-4">
			<Grid cells={STANDARD} />
			<div>
				<p class="mb-2 text-sm text-neutral-500">
					International character set replacements ($00-$1A, $60, $7B):
				</p>
				<Grid cells={INTERNATIONAL} />
			</div>
		</div>
	);
}
