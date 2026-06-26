import type { ComponentProps } from "preact";
import iconsUrl from "./icons.svg";

/**
 * Every icon in the sprite (src/icons.svg), keyed by its `<symbol>` id. The
 * single source of truth for icon names — keep it in sync with the sprite (a
 * mismatch renders an empty icon, visible immediately in the UI).
 */
export const ICON_NAMES = [
	"menu",
	"close",
	"bookmark",
	"joystick",
	"keyboard",
	"chevron-down",
	"swap",
	"play",
	"pause",
	"zap",
	"volume",
	"volume-2",
	"volume-x",
	"volume-off",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/**
 * A single-color icon, pulled from the SVG sprite by name. Sized to the
 * surrounding font (1em) and inheriting `currentColor`, so it drops in where a
 * text glyph used to sit; pass `class`/`style`/handlers (anything an `<svg>`
 * takes) to override. The sprite's icons are stroked (Lucide), so the stroke
 * presentation is set here and inherited by the referenced symbol.
 */
export function Icon({
	name,
	...props
}: { name: IconName } & ComponentProps<"svg">) {
	return (
		<svg
			width="1em"
			height="1em"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			{...props}
		>
			<use href={`${iconsUrl}#${name}`} />
		</svg>
	);
}
