import { expect, test } from "vitest";
import { buildNtscPalette, buildPalPalette } from "./palette.ts";

// The classic ideal-pot PAL per-hue UV angles (hues 1-15) that the generator
// model must reproduce at the default 22.5° step - including the gaps at
// hues 6/7 and 10/11 and hue 15 landing back on hue 1.
const PAL_IDEAL_ANGLES = [
	135, 112.5, 90, 67.5, 45, 22.5, 337.5, 315, 292.5, 270, 225, 202.5, 180,
	157.5, 135,
] as const;

// The old fixed-table PAL implementation, kept as the reference for the
// parametric generator's defaults.
function referencePalPalette(): Uint32Array {
	const matrix = [
		[0.0, 1.13983],
		[-0.39465, -0.5806],
		[2.03211, 0.0],
	] as const;
	const palette = new Uint32Array(256);
	for (let index = 0; index < 256; index++) {
		const hue = index >> 4;
		const luma = index & 0x0f;
		const y = luma / 15;
		let c1 = 0;
		let c2 = 0;
		if (hue > 0) {
			const angle = (PAL_IDEAL_ANGLES[hue - 1]! * Math.PI) / 180;
			c1 = 0.25 * Math.cos(angle);
			c2 = 0.25 * Math.sin(angle);
		}
		const clamp = (v: number) =>
			Math.max(0, Math.min(255, Math.round(v * 255)));
		const r = clamp(y + matrix[0][0] * c1 + matrix[0][1] * c2);
		const g = clamp(y + matrix[1][0] * c1 + matrix[1][1] * c2);
		const b = clamp(y + matrix[2][0] * c1 + matrix[2][1] * c2);
		palette[index] = 0xff000000 | (b << 16) | (g << 8) | r;
	}
	return palette;
}

test("default PAL palette reproduces the classic ideal-pot table exactly", () => {
	expect(buildPalPalette()).toEqual(referencePalPalette());
});

test("PAL hue 15 always equals hue 1, and hue 1 ignores the pot", () => {
	for (const hueStep of [18.5, 20, 22.5, 25]) {
		const palette = buildPalPalette({ hueStep });
		const ideal = buildPalPalette();
		for (let luma = 0; luma < 16; luma++) {
			expect(palette[0xf0 + luma]).toBe(palette[0x10 + luma]);
			expect(palette[0x10 + luma]).toBe(ideal[0x10 + luma]); // burst-locked
		}
	}
});

test("a narrower PAL pot shifts GR.0's background towards blue", () => {
	const blue = (word: number) => (word >>> 16) & 0xff;
	const green = (word: number) => (word >>> 8) & 0xff;
	const ideal = buildPalPalette()[0x94]!;
	const typical = buildPalPalette({ hueStep: 18.5 })[0x94]!;
	// Bluer = blue gains relative to green compared with the ideal pot.
	expect(blue(typical) - green(typical)).toBeGreaterThan(
		blue(ideal) - green(ideal),
	);
});

test("default NTSC palette is unchanged: grey ramp and burst-locked hue 1", () => {
	const palette = buildNtscPalette();
	// Hue 0 is a pure grey ramp.
	for (let luma = 0; luma < 16; luma++) {
		const w = palette[luma]!;
		const v = Math.round((luma / 15) * 255);
		expect(w & 0xff).toBe(v);
		expect((w >>> 8) & 0xff).toBe(v);
		expect((w >>> 16) & 0xff).toBe(v);
	}
	// Hue 1 is burst-locked: the tint (hue1Angle) moves it, the pot doesn't.
	expect(buildNtscPalette({ hueStep: 24 })[0x14]).toBe(palette[0x14]);
	expect(buildNtscPalette({ hue1Angle: 290 })[0x14]).not.toBe(palette[0x14]);
});

test("brightness, contrast, and gamma adjust the output", () => {
	const base = buildNtscPalette()[0x08]!; // mid grey
	const brighter = buildNtscPalette({ brightness: 0.1 })[0x08]!;
	expect(brighter & 0xff).toBeGreaterThan(base & 0xff);
	const flat = buildNtscPalette({ contrast: 0 })[0x0f]!;
	expect(flat & 0xff).toBe(128); // everything collapses to mid grey
	const gammaUp = buildNtscPalette({ gamma: 2 })[0x04]!;
	expect(gammaUp & 0xff).toBeGreaterThan(buildNtscPalette()[0x04]! & 0xff);
});

test("primaries correction: greys are exactly preserved", () => {
	// Source white maps to target white by construction, and greys are
	// scalar multiples of white - so the grey ramp must stay r = g = b.
	for (const primaries of ["ntsc1953", "smpteC"] as const) {
		const palette = buildNtscPalette({ primaries });
		for (let luma = 0; luma < 16; luma++) {
			const w = palette[luma]!;
			const r = w & 0xff;
			expect((w >>> 8) & 0xff).toBe(r);
			expect((w >>> 16) & 0xff).toBe(r);
		}
	}
});

test("NTSC 1953 correction makes $94 less purple (blue gains on red)", () => {
	const chan = (w: number, shift: number) => (w >>> shift) & 0xff;
	const direct = buildNtscPalette()[0x94]!;
	const corrected = buildNtscPalette({ primaries: "ntsc1953" })[0x94]!;
	expect(chan(corrected, 16) - chan(corrected, 0)).toBeGreaterThan(
		chan(direct, 16) - chan(direct, 0),
	);
});

test("EBU correction is a small nudge for the PAL palette", () => {
	// EBU differs from sRGB only in green's x (0.29 vs 0.30): most entries
	// barely move, with the largest deltas in dark saturated colors where
	// the gamma re-encode amplifies small linear differences.
	const direct = buildPalPalette();
	const corrected = buildPalPalette({ primaries: "ebu" });
	let worst = 0;
	let total = 0;
	for (let i = 0; i < 256; i++) {
		for (const shift of [0, 8, 16]) {
			const delta = Math.abs(
				((corrected[i]! >>> shift) & 0xff) - ((direct[i]! >>> shift) & 0xff),
			);
			worst = Math.max(worst, delta);
			total += delta;
		}
	}
	expect(worst).toBeLessThanOrEqual(32);
	expect(total / (256 * 3)).toBeLessThanOrEqual(3); // tiny on average
});

test("P3 output converts even uncorrected palettes, and keeps greys grey", () => {
	const srgb = buildNtscPalette();
	const p3 = buildNtscPalette({ outputGamut: "display-p3" });
	expect(p3).not.toEqual(srgb); // sRGB values re-expressed in P3
	for (let luma = 0; luma < 16; luma++) {
		const w = p3[luma]!;
		const r = w & 0xff;
		expect((w >>> 8) & 0xff).toBe(r);
		expect((w >>> 16) & 0xff).toBe(r);
	}
	// Saturated colors move; white stays white.
	expect(p3[0x0f]! >>> 0).toBe(srgb[0x0f]! >>> 0);
});
