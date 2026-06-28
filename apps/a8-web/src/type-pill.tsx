import type { ImageType } from "./images/metadata.ts";
import { messages } from "./messages.ts";

// Per-type pill: a three-letter format code — monospace so they align into a
// column — tinted by kind. disk → atr, cart → car, xex → xex, os → rom. Shared
// by the recents menu and the library view.
const TYPE_PILL: Record<ImageType, { code: string; tint: string }> = {
	disk: { code: "atr", tint: "bg-sky-100 text-sky-700" },
	cart: { code: "car", tint: "bg-amber-100 text-amber-700" },
	xex: { code: "xex", tint: "bg-emerald-100 text-emerald-700" },
	os: { code: "rom", tint: "bg-violet-100 text-violet-700" },
};

/** A colour-coded type pill (format code); the full type name is its tooltip. */
export function TypePill({ type }: { type: ImageType }) {
	const { code, tint } = TYPE_PILL[type];
	return (
		<span
			class={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] leading-none ${tint}`}
			title={messages.library.typeName[type]}
		>
			{code}
		</span>
	);
}
