import { expect, test } from "vitest";
import {
	initialStickState,
	readRadialStick,
	type RadialStickConfig,
} from "./radial-stick.ts";

const CFG: RadialStickConfig = {
	engage: 0.45,
	release: 0.35,
	sectorMargin: 0.1,
};

// A point at radius r, angle a (radians, atan2 space: 0 = +x, +y at π/2).
const at = (r: number, a: number) =>
	[r * Math.cos(a), r * Math.sin(a)] as const;

test("centred below the engage radius", () => {
	const st = initialStickState();
	expect(readRadialStick(0, 0, st, CFG)).toBe(-1);
	expect(readRadialStick(0.44, 0, st, CFG)).toBe(-1);
	expect(st.engaged).toBe(false);
});

test("engages past the engage radius and snaps to the octant", () => {
	const st = initialStickState();
	expect(readRadialStick(1, 0, st, CFG)).toBe(0); // +x
	expect(readRadialStick(0, 1, st, CFG)).toBe(2); // +y
	expect(readRadialStick(-1, 0, st, CFG)).toBe(4); // −x
	expect(readRadialStick(0, -1, st, CFG)).toBe(6); // −y
	expect(readRadialStick(0.7, 0.7, st, CFG)).toBe(1); // +x +y diagonal
	expect(readRadialStick(0.7, -0.7, st, CFG)).toBe(7); // +x −y diagonal
});

test("diagonals engage at full radial magnitude", () => {
	// A per-axis 0.45 threshold would need each component ≥ 0.45; radially the
	// diagonal engages as soon as the magnitude does.
	const st = initialStickState();
	const [x, y] = at(0.46, Math.PI / 4);
	expect(readRadialStick(x, y, st, CFG)).toBe(1);
});

test("radius hysteresis: engaged holds down to the release radius", () => {
	const st = initialStickState();
	expect(readRadialStick(0.5, 0, st, CFG)).toBe(0);
	// Between release and engage: still held.
	expect(readRadialStick(0.4, 0, st, CFG)).toBe(0);
	// At/below release: recentres, and 0.4 no longer re-engages.
	expect(readRadialStick(0.35, 0, st, CFG)).toBe(-1);
	expect(readRadialStick(0.4, 0, st, CFG)).toBe(-1);
});

test("angular hysteresis: holds the octant just past the boundary", () => {
	const boundary = Math.PI / 8; // between octant 0 (+x) and 1 (+x +y)
	const st = initialStickState();
	expect(readRadialStick(...at(1, 0), st, CFG)).toBe(0);
	// Nudged past the boundary but inside the margin: octant 0 holds.
	expect(readRadialStick(...at(1, boundary + 0.05), st, CFG)).toBe(0);
	// Clearly past the margin: switches to 1.
	expect(readRadialStick(...at(1, boundary + 0.15), st, CFG)).toBe(1);
	// And the same margin now defends octant 1 on the way back.
	expect(readRadialStick(...at(1, boundary - 0.05), st, CFG)).toBe(1);
	expect(readRadialStick(...at(1, boundary - 0.15), st, CFG)).toBe(0);
});

test("angular hysteresis wraps across the ±π seam", () => {
	// Octant 4 (−x) is centred on ±π, so holding it from a negative angle needs
	// the wrap-around distance, not the raw difference.
	const boundary = -(7 * Math.PI) / 8; // between octant 4 (−x) and 5 (−x −y)
	const st = initialStickState();
	expect(readRadialStick(...at(1, Math.PI - 0.01), st, CFG)).toBe(4);
	// Across the seam and just past the boundary: octant 4 holds.
	expect(readRadialStick(...at(1, boundary + 0.05), st, CFG)).toBe(4);
	// Clearly past the margin: switches to 5.
	expect(readRadialStick(...at(1, boundary + 0.15), st, CFG)).toBe(5);
});

test("recentring clears the held octant - no stale angular hold", () => {
	const st = initialStickState();
	expect(readRadialStick(...at(1, Math.PI / 8 + 0.05), st, CFG)).toBe(1);
	expect(readRadialStick(0, 0, st, CFG)).toBe(-1);
	// Fresh engagement at the same angle snaps to 1's side, ignoring history…
	expect(readRadialStick(...at(1, Math.PI / 8 + 0.05), st, CFG)).toBe(1);
	// …and a fresh engagement just inside octant 0 snaps to 0.
	expect(readRadialStick(0, 0, st, CFG)).toBe(-1);
	expect(readRadialStick(...at(1, Math.PI / 8 - 0.05), st, CFG)).toBe(0);
});
