// Per-TV-standard display settings. The machine always renders the full
// 376×240 frame (games draw into overscan); overscan is a display-side crop,
// and the correct amounts genuinely differ per standard — 80s NTSC sets
// showed ~204–216 lines while PAL sets showed all 240 and then some. More
// settings (palette generation parameters, frame persistence) join this
// record over time; the eventual settings page is tabbed per standard.
//
// Horizontal positions are in absolute hi-res pixels (GTIA color clocks × 2):
// the standard playfield spans 96..415, so "no overscan" (320) is exactly
// that, and wider crops add equal border per side. The frame buffer's first
// pixel is at absolute position 68 — buffer cycle x = hpos − 15 emits color
// clocks (hpos + 2)·2 (see antic-gtia.ts). Vertically the anchors are
// vcount: the buffer holds vcount 8..247 and the standard display (24 blank
// lines after VBLANK + 192 picture lines) occupies vcount 32..223, centre
// 128.
//
// The crop is capped at the rendered frame (376×240). Atari genuinely can't
// draw wider; taller exists via the ANTIC last-line bug (full 262/312 lines,
// vsync-override), so an "Extended" view may one day require a taller frame
// buffer — deliberately not modeled yet.

import {
	FRAME_BUFFER_HEIGHT,
	FRAME_BUFFER_WIDTH,
	type PalettePrimaries,
} from "@sfotty-pie/a8";
import type { TvStandard } from "./machine-config.ts";

export interface OverscanSettings {
	width: number;
	height: number;
}

/** User-facing palette generation parameters (see PaletteOptions in
 *  @sfotty-pie/a8): the display's tint knob, the GTIA trim pot, the TV's
 *  picture controls, and the decode-primaries choice — all real-world
 *  adjustments or properties of real display hardware. */
export interface PaletteSettings {
	hue1Angle: number;
	hueStep: number;
	saturation: number;
	brightness: number;
	contrast: number;
	gamma: number;
	primaries: PalettePrimaries;
}

/** The primaries choices each standard's tab offers, in display order:
 *  defaults first (hand-picked 2026-07-06), "None" (direct sRGB
 *  interpretation) last. SMPTE C leads NTSC — it approximates the phosphors
 *  70s/80s sets actually had, where the 1953 FCC set is the on-paper signal
 *  spec that consumer CRTs never really used by the Atari era. */
export const PRIMARIES_OPTIONS: Record<
	TvStandard,
	readonly PalettePrimaries[]
> = {
	ntsc: ["smpteC", "ntsc1953", "srgb"],
	pal: ["ebu", "srgb"],
};

export interface StandardDisplaySettings {
	overscan: OverscanSettings;
	palette: PaletteSettings;
}

export type DisplaySettings = Record<TvStandard, StandardDisplaySettings>;

/** The adjustable crop range: OS playfield up to the full rendered frame. */
export const OVERSCAN_MIN_WIDTH = 320;
export const OVERSCAN_MAX_WIDTH = FRAME_BUFFER_WIDTH;
export const OVERSCAN_MIN_HEIGHT = 192;
export const OVERSCAN_MAX_HEIGHT = FRAME_BUFFER_HEIGHT;

/**
 * Named palette presets per standard — parameter sets, not curated RGB
 * tables (only parameters persist; presets are buttons). Each standard pairs
 * a by-the-book calibration with the period/NTSC-vintage look, and PAL's
 * pair also settles the community's greenish-vs-blue GR.0 split.
 */
export const PALETTE_PRESETS: Record<
	TvStandard,
	Record<string, PaletteSettings>
> = {
	// Both NTSC presets use the Field Service Manual pot calibration (set the
	// background to hue 1 and the border to hue 15, adjust until they match —
	// closing the wheel exactly at 360/14° per step; the guide's hue-1-vs-15
	// row replicates the procedure) and differ only in tint, the display's
	// knob.
	ntsc: {
		// The default: a period display's tint, per Atari's own Field Repair
		// manual — "For Hue/Phase/Color Balance TV/monitor setting correct
		// with Phase −33", i.e. hue 1 at −33° from I (327). The same angle the
		// AHRM documents for the Commodore 1702, and consistent with AtariAge
		// research that NTSC games were developed on sets with a more reddish
		// hue 1 than a calibrated modern display's −57°.
		vintage: {
			hue1Angle: 327,
			hueStep: 360 / 14,
			saturation: 0.25,
			brightness: 0,
			contrast: 1,
			gamma: 1,
			primaries: "smpteC",
		},
		// A calibrated modern display: hue 1 at the specified −57° (303).
		modern: {
			hue1Angle: 303,
			hueStep: 360 / 14,
			saturation: 0.25,
			brightness: 0,
			contrast: 1,
			gamma: 1,
			primaries: "smpteC",
		},
		// The other camp in the perennial hue-1-vs-15 forum debate: the CGIA
		// manual (among others) insists all 15 hues are distinct, implying
		// equal spacing over the wheel — 360/15 = 24°/step, leaving hue 15 one
		// step shy of hue 1 instead of matching it. Tint 340 keeps GR.0's
		// blue where Vintage puts it (hue 9 ≈ 172°).
		hues15: {
			hue1Angle: 340,
			hueStep: 24,
			saturation: 0.25,
			brightness: 0,
			contrast: 1,
			gamma: 1,
			primaries: "smpteC",
		},
	},
	pal: {
		// The default: the ideal 22.5°/tap pot (sea-green GR.0).
		calibrated: {
			hue1Angle: 135,
			hueStep: 22.5,
			saturation: 0.25,
			brightness: 0,
			contrast: 1,
			gamma: 1,
			primaries: "ebu",
		},
		// The NTSC "Vintage" look on a PAL machine (which also gives the blue
		// GR.0 the name refers to): least-squares fit of the PAL generator's
		// parameters against the NTSC vintage palette (linearized-RGB distance
		// over all 256 entries). A reasonable match throughout — the tint
		// lands +19° of the PAL default, echoing vintage NTSC's +24° of
		// modern — except hue 11, which sits on the PAL wheel's structural
		// 10/11 gap and can't be bent onto NTSC's uniform wheel by any
		// parameter choice.
		blueGr0: {
			hue1Angle: 154,
			hueStep: 23,
			saturation: 0.25,
			brightness: 0,
			contrast: 1,
			gamma: 1,
			primaries: "ebu",
		},
	},
};

/**
 * Named overscan presets per standard. Normal is 336×224 on both: it's what
 * games assume (International Karate assumes ~220; tighter crops clip it),
 * matches Altirra's NTSC default, and matches broadcast action-safe practice
 * (BBC: 3.5% per side vertically). PAL sets did show all 240 lines and then
 * some, but 224 reads better as the default (hand-picked 2026-07-06) — Full
 * is one click away. None is exactly the OS playfield.
 */
export const OVERSCAN_PRESETS: Record<
	TvStandard,
	Record<string, OverscanSettings>
> = {
	ntsc: {
		full: { width: 376, height: 240 },
		normal: { width: 336, height: 224 },
		none: { width: 320, height: 192 },
	},
	pal: {
		full: { width: 376, height: 240 },
		normal: { width: 336, height: 224 },
		none: { width: 320, height: 192 },
	},
};

/** Defaults: the "Normal" overscan preset and each standard's first palette
 *  preset. Presets are starting points — only parameters are persisted. */
export function defaultDisplaySettings(): DisplaySettings {
	return {
		ntsc: {
			overscan: { ...OVERSCAN_PRESETS.ntsc["normal"]! },
			palette: { ...PALETTE_PRESETS.ntsc["vintage"]! },
		},
		pal: {
			overscan: { ...OVERSCAN_PRESETS.pal["normal"]! },
			palette: { ...PALETTE_PRESETS.pal["calibrated"]! },
		},
	};
}

// Crop anchors (see the module comment): the playfield centre in absolute
// hi-res pixels and the display centre in vcount, minus each axis's buffer
// origin.
const BUFFER_ORIGIN_X = 68;
const PLAYFIELD_CENTER = 256;
const BUFFER_ORIGIN_Y = 8;
const DISPLAY_CENTER = 128;

const clampEven = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, Math.floor(value / 2) * 2));

/** An overscan value clamped to the legal range (even, within min/max). */
export function sanitizeOverscan(overscan: OverscanSettings): OverscanSettings {
	return {
		width: clampEven(overscan.width, OVERSCAN_MIN_WIDTH, OVERSCAN_MAX_WIDTH),
		height: clampEven(
			overscan.height,
			OVERSCAN_MIN_HEIGHT,
			OVERSCAN_MAX_HEIGHT,
		),
	};
}

const clamp = (value: number, min: number, max: number) =>
	Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

/** Palette parameters clamped to sane slider ranges. The pot (hueStep) goes
 *  all the way to 0 like the real one — NTSC degenerates into bands there,
 *  but PAL's pinned burst and fixed inverter keep it semi-coherent, and low
 *  settings are where the very blue real-world PALs live. */
export function sanitizePalette(palette: PaletteSettings): PaletteSettings {
	const primaries: readonly PalettePrimaries[] = [
		"srgb",
		"ntsc1953",
		"smpteC",
		"ebu",
	];
	return {
		hue1Angle: clamp(palette.hue1Angle, 0, 360),
		hueStep: clamp(palette.hueStep, 0, 35),
		saturation: clamp(palette.saturation, 0, 0.5),
		brightness: clamp(palette.brightness, -0.5, 0.5),
		contrast: clamp(palette.contrast, 0, 2),
		gamma: clamp(palette.gamma, 0.5, 2),
		primaries: primaries.includes(palette.primaries)
			? palette.primaries
			: "srgb",
	};
}

/** A crop window within the frame buffer. */
export interface CropRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** The frame-buffer crop for an overscan setting: centred on the standard
 *  playfield/display (not the buffer), per the anchors above. */
export function overscanCrop(overscan: OverscanSettings): CropRect {
	const { width, height } = sanitizeOverscan(overscan);
	return {
		left: PLAYFIELD_CENTER - width / 2 - BUFFER_ORIGIN_X,
		top: DISPLAY_CENTER - height / 2 - BUFFER_ORIGIN_Y,
		width,
		height,
	};
}
