import { expect, test } from "vitest";
import {
	type CalibrationSet,
	classify,
	DPAD_DOWN,
	DPAD_LEFT,
	DPAD_RIGHT,
	DPAD_UP,
	normalize,
	type PadView,
	STANDARD_BUTTON_COUNT,
} from "./gamepad-normalize.ts";

// A synthetic raw pad: buttons from pressed flags, axes as given.
function pad(pressed: boolean[], axes: number[]): PadView {
	return {
		buttons: pressed.map((p) => ({ pressed: p, value: p ? 1 : 0 })),
		axes,
	};
}

const pressedIndices = (view: PadView) =>
	view.buttons.flatMap((b, i) => (b.pressed ? [i] : []));

// The SDL-style hat ladder: position p (0 = up, clockwise) → −1 + 2p/7, with
// the out-of-range centred sentinel at position 8.
const ladder = (p: number) => -1 + (2 * p) / 7;

test("no profile is the identity - the raw pad object itself", () => {
	const raw = pad([true], [0.5]);
	expect(normalize(raw)).toBe(raw);
});

test("a profile is a patch: overrides apply, everything else is identity", () => {
	const profile = { buttons: { 0: { button: 5 } }, axes: {} };
	const raw = pad([false, true, false, false, false, true], [0.25]);
	const view = normalize(raw, profile);
	// Standard 0 reads raw 5; raw 1 keeps its own slot untouched.
	expect(pressedIndices(view)).toEqual([0, 1]);
	// Axes are untouched identity, padded to the Standard count.
	expect(view.axes).toEqual([0.25, 0, 0, 0]);
	expect(view.buttons.length).toBe(STANDARD_BUTTON_COUNT);
});

test("a moved raw button stops driving its own slot", () => {
	// Standard 0 ← raw 5, and raw 5 is held: slot 5 must not also fire.
	const profile = { buttons: { 0: { button: 5 } }, axes: {} };
	const view = normalize(
		pad([false, false, false, false, false, true], []),
		profile,
	);
	expect(pressedIndices(view)).toEqual([0]);
});

test("null maps a Standard button to nothing", () => {
	const profile = { buttons: { 0: null }, axes: { 1: null } };
	const view = normalize(pad([true, true], [0.5, 0.5]), profile);
	expect(pressedIndices(view)).toEqual([1]); // slot 0 explicitly dead
	expect(view.axes[0]).toBe(0.5); // identity
	expect(view.axes[1]).toBe(0); // explicitly dead
});

test("swapping two buttons is two explicit overrides", () => {
	const profile = {
		buttons: { 0: { button: 1 }, 1: { button: 0 } },
		axes: {},
	};
	const view = normalize(pad([true, false], []), profile);
	expect(view.buttons[0]!.pressed).toBe(false);
	expect(view.buttons[1]!.pressed).toBe(true);
});

test("an explicit D-pad override beats the hat for its slot only", () => {
	const profile = {
		buttons: { [DPAD_UP]: null },
		axes: {},
		hat: {
			axis: 0,
			values: Array.from({ length: 8 }, (_, p) => ladder(p)),
			epsilon: 1 / 7,
		},
	};
	// Up-right on the hat: up is explicitly dead, right still fires.
	const view = normalize(pad([], [ladder(1)]), profile);
	expect(pressedIndices(view)).toEqual([DPAD_RIGHT]);
});

test("axis-button source: an analog trigger resting at −1", () => {
	const profile = {
		buttons: { 0: { axisButton: { axis: 2, rest: -1, pressed: 1 } } },
		axes: {},
	};
	expect(normalize(pad([], [0, 0, -1]), profile).buttons[0]!.pressed).toBe(
		false,
	);
	expect(normalize(pad([], [0, 0, -0.5]), profile).buttons[0]!.pressed).toBe(
		false,
	);
	const pulled = normalize(pad([], [0, 0, 0.8]), profile).buttons[0]!;
	expect(pulled.pressed).toBe(true);
	expect(pulled.value).toBeCloseTo(0.9); // (0.8 − (−1)) / 2
});

test("axis source: anchors map rest→0 and full pushes to ±1, clamped", () => {
	// An off-centre, limited-range axis: rest 0.2, full left −0.6, right 1.
	const profile = {
		buttons: {},
		axes: { 0: { axis: 1, rest: 0.2, negAt: -0.6, posAt: 1 } },
	};
	const at = (raw: number) => normalize(pad([], [0, raw]), profile).axes[0]!;
	expect(at(0.2)).toBe(0);
	expect(at(1)).toBe(1);
	expect(at(-0.6)).toBe(-1);
	expect(at(0.6)).toBeCloseTo(0.5);
	expect(at(-1)).toBe(-1); // past the observed range: clamped
});

test("axis source: inversion is just anchor placement", () => {
	// Pushing Standard-left drives the raw axis positive.
	const profile = {
		buttons: {},
		axes: { 0: { axis: 0, rest: 0, negAt: 0.9, posAt: -0.9 } },
	};
	expect(normalize(pad([], [0.9]), profile).axes[0]).toBe(-1);
	expect(normalize(pad([], [-0.9]), profile).axes[0]).toBe(1);
});

test("hat source: ladder positions drive the D-pad, sentinel reads centred", () => {
	const profile = {
		buttons: {},
		axes: {},
		hat: {
			axis: 3,
			values: Array.from({ length: 8 }, (_, p) => ladder(p)),
			epsilon: 1 / 7,
		},
	};
	const at = (raw: number) =>
		pressedIndices(normalize(pad([], [0, 0, 0, raw]), profile));
	expect(at(ladder(0))).toEqual([DPAD_UP]);
	expect(at(ladder(1)).sort()).toEqual([DPAD_UP, DPAD_RIGHT].sort());
	expect(at(ladder(4))).toEqual([DPAD_DOWN]);
	expect(at(ladder(6))).toEqual([DPAD_LEFT]);
	expect(at(ladder(8))).toEqual([]); // the 9/7 centred sentinel
});

test("classify: digital stick on odd axes + fire on an odd button", () => {
	const rest = {
		buttons: [false, false, false, false, false, false, false],
		axes: [0, 0, 0, 0],
	};
	const samples: CalibrationSet = {
		rest,
		left: { ...rest, axes: [0, 0, -1, 0] },
		right: { ...rest, axes: [0, 0, 1, 0] },
		up: { ...rest, axes: [0, 0, 0, -1] },
		down: { ...rest, axes: [0, 0, 0, 1] },
		trigger: {
			...rest,
			buttons: [false, false, false, false, false, false, true],
		},
	};
	const profile = classify(samples);
	// Round trip: a diagonal push reads as Standard axes 0/1, fire as button 0.
	const view = normalize(
		pad([false, false, false, false, false, false, true], [0, 0, 1, -1]),
		profile,
	);
	expect(view.axes[0]).toBe(1);
	expect(view.axes[1]).toBe(-1);
	expect(view.buttons[0]!.pressed).toBe(true);
});

test("classify: stepped hat - cardinals fit the ladder, diagonals inferred", () => {
	const rest = { buttons: [false], axes: [0, ladder(8)] };
	const hatAt = (p: number) => ({ buttons: [false], axes: [0, ladder(p)] });
	const samples: CalibrationSet = {
		rest,
		up: hatAt(0),
		right: hatAt(2),
		down: hatAt(4),
		left: hatAt(6),
	};
	const profile = classify(samples);
	expect(profile.hat?.axis).toBe(1);
	// The unobserved diagonal (position 1, up-right) was filled by the fit.
	const view = normalize(pad([false], [0, ladder(1)]), profile);
	expect(pressedIndices(view).sort()).toEqual([DPAD_UP, DPAD_RIGHT].sort());
	// Rest (the out-of-range sentinel) reads centred.
	expect(
		pressedIndices(normalize(pad([false], [0, ladder(8)]), profile)),
	).toEqual([]);
});

test("classify: inverted analog axis comes out Standard-polarity", () => {
	const rest = { buttons: [], axes: [0] };
	const samples: CalibrationSet = {
		rest,
		left: { buttons: [], axes: [0.9] }, // pushing left drives the axis up
		right: { buttons: [], axes: [-0.9] },
	};
	const view = normalize(pad([], [0.9]), classify(samples));
	expect(view.axes[0]).toBe(-1);
});

test("classify: one observed side mirrors the missing one", () => {
	const rest = { buttons: [], axes: [0] };
	const samples: CalibrationSet = {
		rest,
		right: { buttons: [], axes: [1] }, // no left sample
	};
	const profile = classify(samples);
	expect(profile.axes[0]).toEqual({ axis: 0, rest: 0, negAt: -1, posAt: 1 });
});

test("classify: button-shaped directions land on the D-pad", () => {
	const rest = { buttons: [false, false, false, false], axes: [] };
	const press = (i: number) => ({
		buttons: rest.buttons.map((_, j) => j === i),
		axes: [],
	});
	const profile = classify({
		rest,
		up: press(3),
		down: press(1),
		left: press(0),
		right: press(2),
	});
	expect(profile.buttons[DPAD_UP]).toEqual({ button: 3 });
	expect(profile.buttons[DPAD_DOWN]).toEqual({ button: 1 });
	expect(profile.buttons[DPAD_LEFT]).toEqual({ button: 0 });
	expect(profile.buttons[DPAD_RIGHT]).toEqual({ button: 2 });
});

test("classify: a trigger on an axis becomes an axis-button", () => {
	const rest = { buttons: [], axes: [0, -1] };
	const profile = classify({
		rest,
		trigger: { buttons: [], axes: [0, 1] },
	});
	expect(profile.buttons[0]).toEqual({
		axisButton: { axis: 1, rest: -1, pressed: 1 },
	});
});

test("classify: an idle wobble below the threshold is ignored", () => {
	const rest = { buttons: [false], axes: [0, 0] };
	const profile = classify({
		rest,
		trigger: { buttons: [false], axes: [0.1, 0] }, // nothing really moved
	});
	expect(profile.buttons[0]).toBeUndefined();
});
