// Shared table chrome for the reference pages.

export const TABLE = "w-full border-collapse text-sm";
export const TD = "border-b border-neutral-800 px-3 py-1.5 align-top";
export const TH =
	"sticky top-0 z-10 border-b border-neutral-700 bg-neutral-900 px-3 py-2 font-semibold text-neutral-300";

export function SortHeader({
	label,
	active,
	onClick,
	thClass = "text-left",
}: {
	label: string;
	active: boolean;
	onClick: () => void;
	thClass?: string;
}) {
	return (
		<th
			class={`${TH} ${thClass} cursor-pointer select-none hover:text-white`}
			aria-sort={active ? "ascending" : "none"}
			onClick={onClick}
		>
			{label}
			<span class="ml-1 text-neutral-600">{active ? "▲" : "↕"}</span>
		</th>
	);
}

// Label ordering shared by both tables: digits, letters, ASCII punctuation (in
// code order), then other functions (alphabetical); missing labels sort last.
function isAsciiPunct(c: number): boolean {
	return (
		(c >= 0x21 && c <= 0x2f) ||
		(c >= 0x3a && c <= 0x40) ||
		(c >= 0x5b && c <= 0x60) ||
		(c >= 0x7b && c <= 0x7e)
	);
}

function labelRank(label: string | undefined): [number, number, string] {
	if (label === undefined) return [4, 0, ""];
	if (label.length === 1) {
		const c = label.charCodeAt(0);
		if (c >= 0x30 && c <= 0x39) return [0, c, ""]; // digit
		if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a))
			return [1, 0, label.toUpperCase()]; // letter
		if (isAsciiPunct(c)) return [2, c, ""]; // punctuation, ASCII order
	}
	return [3, 0, label]; // other functions, alphabetical
}

export function cmpLabel(a: string | undefined, b: string | undefined): number {
	const [ra, na, sa] = labelRank(a);
	const [rb, nb, sb] = labelRank(b);
	return ra - rb || na - nb || sa.localeCompare(sb);
}
