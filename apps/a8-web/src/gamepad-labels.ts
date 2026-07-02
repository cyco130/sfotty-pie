import type { GamepadInput } from "./gamepad.ts";

// Standard Gamepad layout names by index — hardware tokens, so inline (not
// translated). Used for the monitor cells and the binding chips when a pad
// reports the Standard mapping; a non-standard pad falls back to raw indices.
export const STANDARD_BUTTONS = [
	"A / ✕",
	"B / ○",
	"X / □",
	"Y / △",
	"L1",
	"R1",
	"L2",
	"R2",
	"Select",
	"Start",
	"L3",
	"R3",
	"↑",
	"↓",
	"←",
	"→",
	"Guide",
];
export const STANDARD_AXES = ["LX", "LY", "RX", "RY"];

/** A short label for a bound input. `standard` uses the layout names; otherwise
 *  raw indices (what a non-standard pad needs until it's calibrated). */
export function inputLabel(input: GamepadInput, standard: boolean): string {
	if ("button" in input) {
		return (
			(standard ? STANDARD_BUTTONS[input.button] : undefined) ??
			`#${input.button}`
		);
	}
	const name =
		(standard ? STANDARD_AXES[input.axis] : undefined) ?? `Axis ${input.axis}`;
	return `${name}${input.dir < 0 ? "−" : "+"}`;
}
