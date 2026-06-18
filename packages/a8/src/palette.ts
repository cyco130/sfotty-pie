/**
 * GTIA palette generation: 16 hues × 16 luminances → little-endian RGBA words
 * (`0xAABBGGRR`) for writing through a Uint32 view of canvas ImageData, or for
 * unpacking per channel (`r = w & 0xff`, `g = (w >>> 8) & 0xff`, `b = (w >>> 16)
 * & 0xff`) when encoding an image.
 *
 * This is the GTIA colour decode — the analog signal interpretation, the visual
 * counterpart to the disassembler's text — so it lives with the machine rather
 * than in any one host; the actual presentation (scaling, pixel aspect, gamma
 * tuning) stays host-side.
 *
 * A GTIA colour is a (hue, luma) pair. Hue 0 is grey; hues 1–15 sit at chroma
 * phases set by the colour generator. NTSC steps the phase uniformly and
 * decodes as YIQ. PAL decodes as YUV at the per-hue angles in the Altirra
 * Hardware Reference's table (the line-to-line phase alternation averages to
 * these "ideal" angles) — note the two ~45° gaps, at hues 6→7 and 10→11,
 * from delay values the generator skips.
 *
 * Luminance is linear for now. TODO: luma table + gamma; the saturation is a
 * first-pass tunable.
 */
interface PaletteParams {
	/** The chroma phase for a hue (1–15), in degrees. */
	angleFor: (hue: number) => number;
	saturation: number;
	/** Chroma → RGB matrix: rows are R/G/B, columns the two chroma axes. */
	matrix: readonly [
		readonly [number, number],
		readonly [number, number],
		readonly [number, number],
	];
}

// NTSC: YIQ decode, atari800's default phase (burst 303°, 26.8° per hue).
const NTSC: PaletteParams = {
	angleFor: (hue) => 303 + (hue - 1) * 26.8,
	saturation: 0.175,
	matrix: [
		[0.9563, 0.621],
		[-0.2721, -0.6474],
		[-1.107, 1.7046],
	],
};

// PAL: YUV decode (U = B-Y, V = R-Y) at the AHRM's per-hue UV angles.
const PAL_UV_ANGLES = [
	135, 112.5, 90, 67.5, 45, 22.5, 337.5, 315, 292.5, 270, 225, 202.5, 180,
	157.5, 135,
] as const;

const PAL: PaletteParams = {
	angleFor: (hue) => PAL_UV_ANGLES[hue - 1]!,
	saturation: 0.18,
	matrix: [
		[0.0, 1.13983],
		[-0.39465, -0.5806],
		[2.03211, 0.0],
	],
};

function buildPalette(params: PaletteParams): Uint32Array {
	const palette = new Uint32Array(256);

	for (let index = 0; index < 256; index++) {
		const hue = index >> 4;
		const luma = index & 0x0f;

		const y = luma / 15;
		let c1 = 0;
		let c2 = 0;
		if (hue > 0) {
			const angle = (params.angleFor(hue) * Math.PI) / 180;
			c1 = params.saturation * Math.cos(angle);
			c2 = params.saturation * Math.sin(angle);
		}

		const [mr, mg, mb] = params.matrix;
		const r = channel(y + mr[0] * c1 + mr[1] * c2);
		const g = channel(y + mg[0] * c1 + mg[1] * c2);
		const b = channel(y + mb[0] * c1 + mb[1] * c2);

		palette[index] = 0xff000000 | (b << 16) | (g << 8) | r;
	}

	return palette;
}

/** The NTSC GTIA palette. */
export function buildNtscPalette(): Uint32Array {
	return buildPalette(NTSC);
}

/** The PAL GTIA palette. */
export function buildPalPalette(): Uint32Array {
	return buildPalette(PAL);
}

/** The palette for a TV standard (defaults to NTSC). */
export function paletteFor(tvSystem: "ntsc" | "pal" = "ntsc"): Uint32Array {
	return tvSystem === "pal" ? buildPalPalette() : buildNtscPalette();
}

function channel(value: number): number {
	return Math.max(0, Math.min(255, Math.round(value * 255)));
}
