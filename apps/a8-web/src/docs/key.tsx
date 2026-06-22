// A rendered Atari keycap. Layout mirrors the physical legend:
//   - primary label is the main legend (bottom), centred;
//   - secondary label sits above the primary (centred when alone);
//   - tertiary label sits to the left of the secondary (pushing it right) and is
//     drawn in inverse video — the glyph's colour and background swap, the way
//     the Atari prints its CONTROL graphics symbols.
// A fixed min-height keeps every cap the same height; the top strip only renders
// when there's a secondary/tertiary, so single-label caps centre vertically.
export function Key({
	labels,
	fill = false,
	primary: primaryOverride,
	inverse = false,
	small = false,
	selected = false,
}: {
	labels: readonly [primary: string, secondary?: string, tertiary?: string];
	// `fill` makes the cap take its container's width (for the keyboard view)
	// instead of its own min-width (for inline use in the tables).
	fill?: boolean;
	// View-only overrides: a shortened primary label, an inverse-video primary
	// label, or a smaller primary font (so long legends fit a narrow cap).
	primary?: string;
	inverse?: boolean;
	small?: boolean;
	// Pinned indicator for the keyboard view.
	selected?: boolean;
}) {
	const [labelPrimary, secondary, tertiary] = labels;
	const primary = primaryOverride ?? labelPrimary;
	const hasTop = secondary !== undefined || tertiary !== undefined;

	const shape = fill ? "flex w-full overflow-hidden" : "inline-flex min-w-12";
	const ring = selected ? "ring-2 ring-amber-400" : "";

	return (
		<span
			class={`${shape} ${ring} min-h-11 flex-col justify-center gap-0.5 rounded-md border border-neutral-600 bg-neutral-800 px-2 py-1 font-mono leading-none`}
		>
			{hasTop && (
				<span
					class={`flex h-3.5 items-center text-[0.65rem] text-neutral-400 ${
						tertiary !== undefined ? "justify-start gap-1" : "justify-center"
					}`}
				>
					{tertiary !== undefined && (
						<span class="rounded-xs bg-neutral-300 px-0.5 text-neutral-900">
							{tertiary}
						</span>
					)}
					{secondary !== undefined && <span>{secondary}</span>}
				</span>
			)}
			<span
				class={`flex w-full justify-center leading-none ${
					small ? "text-[0.6rem]" : "text-sm"
				}`}
			>
				{inverse ? (
					<span class="rounded-xs bg-neutral-300 px-1 whitespace-nowrap text-neutral-900">
						{primary}
					</span>
				) : (
					<span class="whitespace-nowrap text-neutral-100">{primary}</span>
				)}
			</span>
		</span>
	);
}
