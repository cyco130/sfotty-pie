/**
 * GTIA palette generation: 16 hues x 16 luminances -> little-endian RGBA words
 * (`0xAABBGGRR`) for writing through a Uint32 view of canvas ImageData, or for
 * unpacking per channel (`r = w & 0xff`, `g = (w >>> 8) & 0xff`, `b = (w >>> 16)
 * & 0xff`) when encoding an image.
 *
 * This is the GTIA colour decode - the analog signal interpretation, the visual
 * counterpart to the disassembler's text - so it lives with the machine rather
 * than in any one host; the actual presentation (scaling, pixel aspect) stays
 * host-side.
 *
 * A GTIA colour is a (hue, luma) pair. Hue 0 is grey; hues 1-15 sit at chroma
 * phases set by the colour generator, whose per-tap delay is a trim pot on the
 * motherboard - a real user control, exposed here as {@link
 * PaletteOptions.hueStep}. Hue 1 doubles as the colour burst, so its angle is
 * fixed by the display (the tint control), not the pot.
 *
 * NTSC steps the phase uniformly from the burst and decodes as YIQ (burst at
 * -57 deg from I; see the Altirra Hardware Reference's analog video appendix).
 *
 * PAL decodes as YUV. Its generator is structurally different (AHRM appendix
 * D.4): a fixed 180 deg inverter covers the second half of the hue wheel, the
 * delay line spans ~180 deg in ideally-22.5 deg taps, and two tap positions are
 * skipped - producing the characteristic gaps between hues 6/7 and 10/11.
 * Fitting those facts to the ideal per-hue angle table gives an exact
 * decomposition: hue h sits at `hue1 - tap(h) * step - inverter(h) * 180 deg` with
 * the tap/inverter sequences below; at the ideal 22.5 deg step this reproduces
 * the classic table (and hue 15 lands back on hue 1, as on real hardware).
 * The line-to-line details (swinging-burst deviation at non-ideal pot
 * settings, the per-polarity inverter windows that make hues 3 and 10 stripe
 * or desaturate off-ideal) average out on delay-line displays and are not
 * modelled yet - this is the single-line, line-averaged view.
 *
 * Luminance is linear from the 4-bit value (the DAC's LUM3 mismatch and the
 * missing NTSC setup pedestal are not modelled yet), with optional
 * brightness/contrast/gamma applied at the end as display-side adjustments.
 */
export interface PaletteOptions {
	/** Hue 1's chroma angle in degrees - the colour-burst reference, i.e. the
	 *  display's tint control. NTSC: in I-Q space (default 303 ~ -57 deg from I).
	 *  PAL: in U-V space (default 135, the even-line burst). */
	hue1Angle?: number;
	/** Degrees of chroma phase per generator delay tap - the colour-adjust
	 *  trim pot. NTSC default 360/14 ~ 25.71 (the Field Service Manual
	 *  calibration: background hue 1 matched against border hue 15, closing
	 *  the wheel); PAL ideal (and default) 22.5, with real machines commonly
	 *  adjusted to ~18-19 for a bluer GR.0. */
	hueStep?: number;
	/** Chroma amplitude relative to the full luma range. Default 0.25 - rounded up from the
	 *  AHRM's measured XL/XE-class NTSC ratio (Table 117: 800XL 23.9%, 130XE
	 *  23.3%; the 800 measures a much hotter 35% and the 400 30.6%, future
	 *  per-machine preset material). No PAL measurement is published; PAL
	 *  matches the XL/XE value pending one. */
	saturation?: number;
	/** Luma offset added after contrast (-1..1); default 0. */
	brightness?: number;
	/** Luma scale about mid-grey; default 1. */
	contrast?: number;
	/** Display gamma adjustment applied per channel (`v^(1/gamma)`), > 1
	 *  brightens midtones; default 1 (linear - historic behaviour). */
	gamma?: number;
	/** The primaries the decoded RGB is *defined* against. "srgb" (default)
	 *  interprets the matrix output directly - the historic behaviour.
	 *  "ntsc1953" corrects from the original FCC primaries + Illuminant C
	 *  white (the AHRM's demonstrated fix: less purple $94, less green
	 *  everywhere); "smpteC" from the phosphors real 70s-80s US sets had
	 *  (milder); "ebu" from PAL's official primaries (~ identity vs sRGB). */
	primaries?: PalettePrimaries;
	/** The color space of the palette words. "display-p3" targets a wide-
	 *  gamut canvas: sRGB-defined colors come out looking identical, while
	 *  corrected wide primaries keep saturation that sRGB would clamp. */
	outputGamut?: OutputGamut;
}

export type PalettePrimaries = "srgb" | "ntsc1953" | "smpteC" | "ebu";
export type OutputGamut = "srgb" | "display-p3";

/** The NTSC GTIA palette (defaults preserved when `options` is omitted). */
export function buildNtscPalette(options: PaletteOptions = {}): Uint32Array {
	return buildPalette(NTSC_DEFAULTS, options);
}

/** The PAL GTIA palette (defaults preserved when `options` is omitted). */
export function buildPalPalette(options: PaletteOptions = {}): Uint32Array {
	return buildPalette(PAL_DEFAULTS, options);
}

/** The palette for a TV standard (defaults to NTSC). */
export function paletteFor(
	tvSystem: "ntsc" | "pal" = "ntsc",
	options: PaletteOptions = {},
): Uint32Array {
	return tvSystem === "pal"
		? buildPalPalette(options)
		: buildNtscPalette(options);
}

interface ResolvedOptions extends Required<PaletteOptions> {
	/** The chroma phase for a hue (1-15), in degrees. */
	angleFor: (hue: number, options: Required<PaletteOptions>) => number;
	/** Chroma -> RGB matrix: rows are R/G/B, columns the two chroma axes. */
	matrix: readonly [
		readonly [number, number],
		readonly [number, number],
		readonly [number, number],
	];
}

// NTSC: YIQ decode; uniform steps from the burst-locked hue 1. Burst 303 deg
// (~ -57 deg from I, the calibrated-display convention); step 360/14 - the
// Field Service Manual pot calibration, which matches hue 15 to hue 1.
const NTSC_DEFAULTS = {
	hue1Angle: 303,
	hueStep: 360 / 14,
	saturation: 0.25,
	brightness: 0,
	contrast: 1,
	gamma: 1,
	primaries: "srgb",
	outputGamut: "srgb",
	angleFor: (hue: number, o: Required<PaletteOptions>) =>
		o.hue1Angle + (hue - 1) * o.hueStep,
	matrix: [
		[0.9563, 0.621],
		[-0.2721, -0.6474],
		[-1.107, 1.7046],
	],
} as const satisfies ResolvedOptions;

// PAL: YUV decode (U = B-Y, V = R-Y). Generator structure per the module
// comment: delay-tap counts and the fixed-180 deg inverter per hue (1-15), with
// the skipped taps (6 in the first half, 3 in the second) producing the
// hue 6/7 and 10/11 gaps. Hue 15 shares hue 1's tap - the AHRM notes they
// are identical *regardless* of the pot (14 unique hues), which pins it to
// the burst path rather than the end of the chain.
const PAL_TAPS = [0, 1, 2, 3, 4, 5, 7, 0, 1, 2, 4, 5, 6, 7, 0] as const;
const PAL_INVERTER = [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0] as const;

const PAL_DEFAULTS = {
	hue1Angle: 135,
	hueStep: 22.5,
	saturation: 0.25,
	brightness: 0,
	contrast: 1,
	gamma: 1,
	primaries: "srgb",
	outputGamut: "srgb",
	angleFor: (hue: number, o: Required<PaletteOptions>) =>
		o.hue1Angle - PAL_TAPS[hue - 1]! * o.hueStep - PAL_INVERTER[hue - 1]! * 180,
	matrix: [
		[0.0, 1.13983],
		[-0.39465, -0.5806],
		[2.03211, 0.0],
	],
} as const satisfies ResolvedOptions;

// --- Primaries conversion ----------------------------------------------------
//
// Decoded RGB is defined against some set of phosphor primaries; showing it
// on a display with different primaries needs a linear-light conversion:
// source RGB -> XYZ, Bradford-adapt the white point, XYZ -> target RGB. The
// matrices are derived from the published chromaticities below (nothing
// hardcoded from folklore). Per the AHRM, the transfer curves involved are
// all ~ gamma 2.2 (NTSC 2.2, sRGB ~ 2.2, Display P3 = sRGB curve), so the
// conversion linearizes and re-encodes with 2.2 and lets the matrix carry
// the correction. Greys are exactly preserved by construction: the source
// white maps to the target white.

interface Chromaticities {
	r: readonly [number, number];
	g: readonly [number, number];
	b: readonly [number, number];
	white: readonly [number, number];
}

const D65 = [0.3127, 0.329] as const;

const CHROMATICITIES: Record<PalettePrimaries | "display-p3", Chromaticities> =
	{
		srgb: { r: [0.64, 0.33], g: [0.3, 0.6], b: [0.15, 0.06], white: D65 },
		// Original FCC 1953 NTSC primaries, Illuminant C white.
		ntsc1953: {
			r: [0.67, 0.33],
			g: [0.21, 0.71],
			b: [0.14, 0.08],
			white: [0.31006, 0.31616],
		},
		// SMPTE C (170M): the phosphors US sets actually converged on.
		smpteC: {
			r: [0.63, 0.34],
			g: [0.31, 0.595],
			b: [0.155, 0.07],
			white: D65,
		},
		// EBU Tech 3213 (BT.470 B/G) - differs from sRGB only in green x.
		ebu: { r: [0.64, 0.33], g: [0.29, 0.6], b: [0.15, 0.06], white: D65 },
		"display-p3": {
			r: [0.68, 0.32],
			g: [0.265, 0.69],
			b: [0.15, 0.06],
			white: D65,
		},
	};

type Mat3 = readonly [
	readonly [number, number, number],
	readonly [number, number, number],
	readonly [number, number, number],
];

function mul(a: Mat3, b: Mat3): Mat3 {
	return [0, 1, 2].map((i) =>
		[0, 1, 2].map(
			(j) => a[i]![0]! * b[0][j]! + a[i]![1]! * b[1][j]! + a[i]![2]! * b[2][j]!,
		),
	) as unknown as Mat3;
}

function mulVec(m: Mat3, v: readonly [number, number, number]) {
	return [
		m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
		m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
		m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
	] as [number, number, number];
}

function invert(m: Mat3): Mat3 {
	const [[a, b, c], [d, e, f], [g, h, i]] = m;
	const A = e * i - f * h;
	const B = f * g - d * i;
	const C = d * h - e * g;
	const det = a * A + b * B + c * C;
	return [
		[A / det, (c * h - b * i) / det, (b * f - c * e) / det],
		[B / det, (a * i - c * g) / det, (c * d - a * f) / det],
		[C / det, (b * g - a * h) / det, (a * e - b * d) / det],
	];
}

// xy chromaticity -> XYZ with Y = 1.
const xyToXyz = ([x, y]: readonly [number, number]) =>
	[x / y, 1, (1 - x - y) / y] as [number, number, number];

// RGB (in the given primaries) -> XYZ: primary XYZ columns scaled so that
// RGB (1,1,1) lands on the white point.
function rgbToXyz(c: Chromaticities): Mat3 {
	const r = xyToXyz(c.r);
	const g = xyToXyz(c.g);
	const b = xyToXyz(c.b);
	const columns: Mat3 = [
		[r[0], g[0], b[0]],
		[r[1], g[1], b[1]],
		[r[2], g[2], b[2]],
	];
	const s = mulVec(invert(columns), xyToXyz(c.white));
	return [
		[r[0] * s[0], g[0] * s[1], b[0] * s[2]],
		[r[1] * s[0], g[1] * s[1], b[1] * s[2]],
		[r[2] * s[0], g[2] * s[1], b[2] * s[2]],
	];
}

// Bradford chromatic adaptation between white points.
const BRADFORD: Mat3 = [
	[0.8951, 0.2664, -0.1614],
	[-0.7502, 1.7135, 0.0367],
	[0.0389, -0.0685, 1.0296],
];

function adaptation(
	from: readonly [number, number],
	to: readonly [number, number],
): Mat3 {
	const src = mulVec(BRADFORD, xyToXyz(from));
	const dst = mulVec(BRADFORD, xyToXyz(to));
	const scale: Mat3 = [
		[dst[0] / src[0], 0, 0],
		[0, dst[1] / src[1], 0],
		[0, 0, dst[2] / src[2]],
	];
	return mul(invert(BRADFORD), mul(scale, BRADFORD));
}

// Linear-light RGB conversion matrix between two primary sets.
function conversionMatrix(from: Chromaticities, to: Chromaticities): Mat3 {
	return mul(
		invert(rgbToXyz(to)),
		mul(adaptation(from.white, to.white), rgbToXyz(from)),
	);
}

const GAMMA = 2.2;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function buildPalette(
	defaults: ResolvedOptions,
	options: PaletteOptions,
): Uint32Array {
	const o: ResolvedOptions = { ...defaults, ...options };
	const palette = new Uint32Array(256);
	const invGamma = 1 / o.gamma;

	// The primaries correction (identity -> skipped, keeping the historic
	// output byte-exact). sRGB source with a P3 canvas still converts, so
	// uncorrected colors look identical rather than oversaturated.
	const correction =
		o.primaries === "srgb" && o.outputGamut === "srgb"
			? null
			: conversionMatrix(
					CHROMATICITIES[o.primaries],
					CHROMATICITIES[
						o.outputGamut === "display-p3" ? "display-p3" : "srgb"
					],
				);

	for (let index = 0; index < 256; index++) {
		const hue = index >> 4;
		const luma = index & 0x0f;

		const y = (luma / 15 - 0.5) * o.contrast + 0.5 + o.brightness;
		let c1 = 0;
		let c2 = 0;
		if (hue > 0) {
			const angle = (o.angleFor(hue, o) * Math.PI) / 180;
			c1 = o.saturation * Math.cos(angle);
			c2 = o.saturation * Math.sin(angle);
		}

		const [mr, mg, mb] = o.matrix;
		let r = y + mr[0] * c1 + mr[1] * c2;
		let g = y + mg[0] * c1 + mg[1] * c2;
		let b = y + mb[0] * c1 + mb[1] * c2;

		if (correction) {
			// Hard-clamp first (a CRT can't emit negative light - the AHRM's
			// prescribed treatment), then convert in linear light.
			const linear = mulVec(correction, [
				Math.pow(clamp01(r), GAMMA),
				Math.pow(clamp01(g), GAMMA),
				Math.pow(clamp01(b), GAMMA),
			]);
			r = Math.pow(clamp01(linear[0]), 1 / GAMMA);
			g = Math.pow(clamp01(linear[1]), 1 / GAMMA);
			b = Math.pow(clamp01(linear[2]), 1 / GAMMA);
		}

		palette[index] =
			0xff000000 |
			(channel(b, invGamma) << 16) |
			(channel(g, invGamma) << 8) |
			channel(r, invGamma);
	}

	return palette;
}

function channel(value: number, invGamma: number): number {
	const clamped = Math.max(0, Math.min(1, value));
	const adjusted = invGamma === 1 ? clamped : Math.pow(clamped, invGamma);
	return Math.round(adjusted * 255);
}
