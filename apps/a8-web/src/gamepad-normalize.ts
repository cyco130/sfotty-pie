// Per-device gamepad normalization: makes any pad look like a W3C Standard
// Gamepad to everything downstream (the poller, the radial reader, the
// binding layer, binding capture). A profile is a *patch* over the pad's own
// layout (see NormalizeProfile) — no profile means the identity fast path.
// Profiles are edited in the mapping editor (gamepad-mapper.tsx) or built by
// dev-console calibration ({@link classify}), and persisted per device id
// (see gamepad-normalize-store.ts).
//
// The profile describes *sources*: how each Standard control is derived from
// the raw pad. The shapes cover how real hardware misreports itself — raw
// buttons at odd indices, button-like controls on an axis (analog triggers,
// digital sticks declared as axes), directions on a stepped "hat" axis (one
// axis whose discrete values encode 8 directions — the SDL-style encoding
// some browser/driver stacks emit), and analog axes needing conditioning
// (inverted, off-centre rest, limited range). Everything is anchored to
// *observed* values rather than assumptions: "centred" is whatever the axis
// rested at during calibration, not 0.

/** The Standard Gamepad layout size: buttons 0-16, axes 0-3. */
export const STANDARD_BUTTON_COUNT = 17;
export const STANDARD_AXIS_COUNT = 4;

/** Standard D-pad button indices. */
export const DPAD_UP = 12;
export const DPAD_DOWN = 13;
export const DPAD_LEFT = 14;
export const DPAD_RIGHT = 15;

/**
 * How one Standard button is sourced from the raw pad: a raw button by index,
 * or a button-like axis (active when the raw value is closer to the observed
 * `pressed` value than to `rest` — direction and polarity fall out of the
 * anchors, no invert flag needed).
 */
export type ButtonSource =
	| { button: number }
	| { axisButton: { axis: number; rest: number; pressed: number } };

/**
 * Raw analog axis → Standard axis, as observed anchor points: `rest` maps to
 * 0, `negAt` to −1, `posAt` to +1, linearly per side and clamped. Inversion
 * and off-centre rest are just anchor placements.
 */
export interface AxisSource {
	axis: number;
	rest: number;
	negAt: number;
	posAt: number;
}

/**
 * A stepped hat: one raw axis whose discrete values encode the 8 directions.
 * `values[p]` is the raw value at position p (0 = up, clockwise; null =
 * unobserved and not inferable). A sample matches a position within
 * `epsilon`; no match (including the out-of-range rest sentinel some drivers
 * emit) reads as centred. Drives the Standard D-pad buttons.
 */
export interface HatSource {
	axis: number;
	values: (number | null)[];
	epsilon: number;
}

/**
 * A per-device normalization profile: a *patch* over the pad's own layout.
 * Absent index = the pad's own control at that index (the identity); a source
 * = an explicit override; `null` = explicitly nothing. The optional hat fills
 * the D-pad buttons that have no explicit entry. Raw controls consumed by an
 * explicit source stop driving their identity slot — a moved control doesn't
 * also fire where it used to live.
 */
export interface NormalizeProfile {
	buttons: Record<number, ButtonSource | null>;
	axes: Record<number, AxisSource | null>;
	hat?: HatSource;
}

/**
 * The pad shape downstream code reads — the structural subset of Gamepad, so
 * a raw Gamepad *is* a PadView and the no-profile path costs nothing.
 */
export interface PadView {
	readonly buttons: readonly {
		readonly pressed: boolean;
		readonly value: number;
	}[];
	readonly axes: readonly number[];
}

// The D-pad buttons each hat position activates (diagonals two, cardinals
// one), indexed by position 0-7 clockwise from up.
const HAT_DPAD: readonly (readonly number[])[] = [
	[DPAD_UP],
	[DPAD_UP, DPAD_RIGHT],
	[DPAD_RIGHT],
	[DPAD_DOWN, DPAD_RIGHT],
	[DPAD_DOWN],
	[DPAD_DOWN, DPAD_LEFT],
	[DPAD_LEFT],
	[DPAD_UP, DPAD_LEFT],
];

// 0 at rest, 1 at the anchor, linear in between, clamped — 0 when the raw
// value sits on the other side of rest (or the anchor is degenerate).
function toward(raw: number, rest: number, at: number): number {
	const span = at - rest;
	if (span === 0) return 0;
	const t = (raw - rest) / span;
	return t <= 0 ? 0 : Math.min(t, 1);
}

function readButtonSource(
	source: ButtonSource,
	pad: PadView,
): { pressed: boolean; value: number } {
	if ("button" in source) {
		const b = pad.buttons[source.button];
		return { pressed: b?.pressed ?? false, value: b?.value ?? 0 };
	}
	const { axis, rest, pressed } = source.axisButton;
	const raw = pad.axes[axis] ?? rest;
	// Active when closer to the observed pressed value than to rest.
	return {
		pressed: Math.abs(raw - pressed) < Math.abs(raw - rest),
		value: toward(raw, rest, pressed),
	};
}

/** The hat position matching `raw`, or −1 for centred / unrecognized. */
export function hatPosition(hat: HatSource, raw: number): number {
	for (let p = 0; p < hat.values.length; p++) {
		const v = hat.values[p];
		if (v !== null && v !== undefined && Math.abs(raw - v) <= hat.epsilon) {
			return p;
		}
	}
	return -1;
}

const UNPRESSED = { pressed: false, value: 0 };

/**
 * The Standard-shaped view of a pad. Without a profile this is the pad
 * itself (identity, no allocation). With one, the profile patches the pad's
 * own layout: explicit sources (and explicit nulls) replace their slots, the
 * hat fills D-pad slots without an explicit entry, everything else keeps the
 * pad's own control at the same index — except identity slots whose raw
 * control an explicit source consumed, which read as inactive (the control
 * moved). Raw indices are preserved, so a patched pad monitors and binds
 * like the raw one plus the overrides.
 */
export function normalize(pad: PadView, profile?: NormalizeProfile): PadView {
	if (!profile) return pad;

	// What the explicit sources (and the hat) consume.
	const consumedButtons = new Set<number>();
	const consumedAxes = new Set<number>();
	for (const source of Object.values(profile.buttons)) {
		if (!source) continue;
		if ("button" in source) consumedButtons.add(source.button);
		else consumedAxes.add(source.axisButton.axis);
	}
	for (const source of Object.values(profile.axes)) {
		if (source) consumedAxes.add(source.axis);
	}
	if (profile.hat) consumedAxes.add(profile.hat.axis);

	const buttonCount = Math.max(STANDARD_BUTTON_COUNT, pad.buttons.length);
	const buttons: { pressed: boolean; value: number }[] = [];
	for (let i = 0; i < buttonCount; i++) {
		const source = profile.buttons[i];
		if (source) {
			buttons.push(readButtonSource(source, pad));
		} else if (source === null || consumedButtons.has(i)) {
			buttons.push(UNPRESSED);
		} else {
			const b = pad.buttons[i];
			buttons.push(b ? { pressed: b.pressed, value: b.value } : UNPRESSED);
		}
	}

	// The hat fills the D-pad slots that have no explicit entry.
	if (profile.hat) {
		const raw = pad.axes[profile.hat.axis];
		const position = raw === undefined ? -1 : hatPosition(profile.hat, raw);
		if (position >= 0) {
			for (const b of HAT_DPAD[position]!) {
				if (profile.buttons[b] === undefined) {
					buttons[b] = { pressed: true, value: 1 };
				}
			}
		}
	}

	const axisCount = Math.max(STANDARD_AXIS_COUNT, pad.axes.length);
	const axes: number[] = [];
	for (let i = 0; i < axisCount; i++) {
		const source = profile.axes[i];
		if (source) {
			const raw = pad.axes[source.axis] ?? source.rest;
			axes.push(
				toward(raw, source.rest, source.posAt) -
					toward(raw, source.rest, source.negAt),
			);
		} else if (source === null || consumedAxes.has(i)) {
			axes.push(0);
		} else {
			axes.push(pad.axes[i] ?? 0);
		}
	}

	return { buttons, axes };
}

// --- Calibration classifier -----------------------------------------------

/** One calibration observation: the raw pad sampled while the user holds the
 *  prompted control (or nothing, for the rest sample). */
export interface CalibrationSample {
	buttons: readonly boolean[];
	axes: readonly number[];
}

/** The calibration wizard's collected samples. Direction/trigger steps the
 *  user skipped are simply absent. */
export interface CalibrationSet {
	rest: CalibrationSample;
	up?: CalibrationSample;
	down?: CalibrationSample;
	left?: CalibrationSample;
	right?: CalibrationSample;
	trigger?: CalibrationSample;
}

/** Snapshot a pad into a calibration sample. */
export function samplePad(pad: PadView): CalibrationSample {
	return { buttons: pad.buttons.map((b) => b.pressed), axes: [...pad.axes] };
}

/**
 * Whether the pad has firmly changed from rest: a newly-pressed button, or an
 * axis at least 0.5 away from where it rested — the shared "the user is
 * really pressing something" test for the capture flows.
 */
export function deviates(
	rest: CalibrationSample,
	now: CalibrationSample,
): boolean {
	if (now.buttons.some((b, i) => b && !rest.buttons[i])) return true;
	return now.axes.some((v, i) => Math.abs(v - (rest.axes[i] ?? 0)) >= 0.5);
}

// An axis must move at least this far from its rest value to count as the
// step's dominant change (below it, it's stick wobble or noise).
const CLASSIFY_AXIS_MIN = 0.3;

/** What moved in one step relative to rest: a newly-pressed raw button wins;
 *  otherwise the axis that moved farthest (if far enough); otherwise nothing.
 *  Used by the classifier and by the mapping editor's capture assist. */
export type Change =
	| { button: number }
	| { axis: number; value: number }
	| undefined;

export function dominantChange(
	rest: CalibrationSample,
	sample: CalibrationSample,
): Change {
	for (let i = 0; i < sample.buttons.length; i++) {
		if (sample.buttons[i] && !rest.buttons[i]) return { button: i };
	}
	let best: { axis: number; value: number } | undefined;
	let bestDelta = CLASSIFY_AXIS_MIN;
	for (let i = 0; i < sample.axes.length; i++) {
		const delta = Math.abs((sample.axes[i] ?? 0) - (rest.axes[i] ?? 0));
		if (delta >= bestDelta) {
			bestDelta = delta;
			best = { axis: i, value: sample.axes[i]! };
		}
	}
	return best;
}

// Fit the observed hat positions to the linear ladder value = a + b·position
// (the SDL-style encoding is exactly linear). A good fit fills in the
// unobserved positions (the diagonals); otherwise only the observed ones
// match and the rest read as centred — degraded but functional.
function buildHat(
	axis: number,
	observed: { position: number; value: number }[],
): HatSource {
	const values: (number | null)[] = Array.from({ length: 8 }, () => null);
	for (const o of observed) values[o.position] = o.value;

	const first = observed[0]!;
	const last = observed[observed.length - 1]!;
	if (observed.length >= 2 && last.position !== first.position) {
		const b = (last.value - first.value) / (last.position - first.position);
		const a = first.value - b * first.position;
		const linear = observed.every(
			(o) => Math.abs(a + b * o.position - o.value) <= 0.01,
		);
		if (linear && b !== 0) {
			for (let p = 0; p < 8; p++) values[p] = a + b * p;
			return { axis, values, epsilon: Math.abs(b) / 2 };
		}
	}

	// No ladder — match only what was observed, with a gap-derived epsilon.
	const sorted = observed.map((o) => o.value).sort((x, y) => x - y);
	let gap = Infinity;
	for (let i = 1; i < sorted.length; i++) {
		gap = Math.min(gap, sorted[i]! - sorted[i - 1]!);
	}
	return { axis, values, epsilon: gap === Infinity ? 0.05 : gap / 2 };
}

// Hat positions of the four cardinal directions (clockwise from up).
const CARDINAL_POSITION = { up: 0, right: 2, down: 4, left: 6 } as const;

// An axis-shaped change, or nothing.
const axisChange = (c: Change) => (c && "axis" in c ? c : undefined);

// The stepped-hat signature across the four directions' axis-shaped changes:
// one axis serving both a horizontal and a vertical direction. Returns the
// fitted hat, or undefined when the directions live on separate axes.
function detectHat(dirs: {
	up?: Change;
	down?: Change;
	left?: Change;
	right?: Change;
}): HatSource | undefined {
	const h = [axisChange(dirs.left), axisChange(dirs.right)].filter(
		(c) => c !== undefined,
	);
	const v = [axisChange(dirs.up), axisChange(dirs.down)].filter(
		(c) => c !== undefined,
	);
	const hatAxis = h.find((c) => v.some((o) => o.axis === c.axis))?.axis;
	if (hatAxis === undefined) return undefined;
	const observed: { position: number; value: number }[] = [];
	for (const dir of ["up", "right", "down", "left"] as const) {
		const c = axisChange(dirs[dir]);
		if (c && c.axis === hatAxis) {
			observed.push({ position: CARDINAL_POSITION[dir], value: c.value });
		}
	}
	return buildHat(hatAxis, observed);
}

// An axis source from the changes seen at either extreme: a missing side
// mirrors the other, polarity (which raw direction is Standard-negative)
// comes from the anchors. Undefined when nothing usable was seen (or the two
// sides landed on different raw axes).
function axisSourceFrom(
	neg: Change,
	pos: Change,
	rest: CalibrationSample,
): AxisSource | undefined {
	const n = axisChange(neg);
	const p = axisChange(pos);
	const axis = n?.axis ?? p?.axis;
	if (axis === undefined) return undefined;
	if (n && p && n.axis !== p.axis) return undefined;
	const restValue = rest.axes[axis] ?? 0;
	return {
		axis,
		rest: restValue,
		negAt: n ? n.value : restValue - (p!.value - restValue),
		posAt: p ? p.value : restValue - (n!.value - restValue),
	};
}

// A button source from one change: the raw button, or a button-like axis
// anchored at the observed rest/pressed values.
function buttonSourceFrom(
	change: Change,
	rest: CalibrationSample,
): ButtonSource | undefined {
	if (!change) return undefined;
	if ("button" in change) return { button: change.button };
	return {
		axisButton: {
			axis: change.axis,
			rest: rest.axes[change.axis] ?? 0,
			pressed: change.value,
		},
	};
}

/**
 * Build a normalization profile from calibration samples: diff each step
 * against rest, then decide the source shapes. Directions that press raw
 * buttons become D-pad sources; directions that move axes become Standard
 * axes 0/1 (anchored at the observed rest/full-push values, so inversion and
 * range fall out) — unless perpendicular directions move the *same* axis,
 * which is the stepped-hat signature. The trigger becomes Standard button 0,
 * as a raw button or a button-like axis.
 */
export function classify(samples: CalibrationSet): NormalizeProfile {
	const profile: NormalizeProfile = { buttons: {}, axes: {} };
	const rest = samples.rest;

	const dirs = {
		up: samples.up && dominantChange(rest, samples.up),
		down: samples.down && dominantChange(rest, samples.down),
		left: samples.left && dominantChange(rest, samples.left),
		right: samples.right && dominantChange(rest, samples.right),
	};
	const DPAD = {
		up: DPAD_UP,
		down: DPAD_DOWN,
		left: DPAD_LEFT,
		right: DPAD_RIGHT,
	} as const;

	// Button-shaped directions map straight onto the D-pad.
	for (const dir of ["up", "down", "left", "right"] as const) {
		const change = dirs[dir];
		if (change && "button" in change) {
			profile.buttons[DPAD[dir]] = { button: change.button };
		}
	}

	// Axis-shaped directions: a hat when perpendicular directions share an
	// axis; otherwise each plane pairs onto a Standard axis.
	const hat = detectHat(dirs);
	if (hat) {
		profile.hat = hat;
	} else {
		const x = axisSourceFrom(dirs.left, dirs.right, rest);
		if (x) profile.axes[0] = x;
		const y = axisSourceFrom(dirs.up, dirs.down, rest);
		if (y) profile.axes[1] = y;
	}

	// The trigger → Standard button 0.
	const trigger = buttonSourceFrom(
		samples.trigger && dominantChange(rest, samples.trigger),
		rest,
	);
	if (trigger) profile.buttons[0] = trigger;

	return profile;
}
