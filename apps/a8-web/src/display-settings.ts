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

import { FRAME_BUFFER_HEIGHT, FRAME_BUFFER_WIDTH } from "@sfotty-pie/a8";
import type { TvStandard } from "./machine-config.ts";

export interface OverscanSettings {
	width: number;
	height: number;
}

export interface StandardDisplaySettings {
	overscan: OverscanSettings;
}

export type DisplaySettings = Record<TvStandard, StandardDisplaySettings>;

/** The adjustable crop range: OS playfield up to the full rendered frame. */
export const OVERSCAN_MIN_WIDTH = 320;
export const OVERSCAN_MAX_WIDTH = FRAME_BUFFER_WIDTH;
export const OVERSCAN_MIN_HEIGHT = 192;
export const OVERSCAN_MAX_HEIGHT = FRAME_BUFFER_HEIGHT;

/** Defaults: the "Normal" preset. NTSC 224 matches Altirra's default —
 *  tighter crops clip real games (International Karate assumes ~220) even
 *  though 80s sets often showed less; 224/240 also matches broadcast
 *  action-safe practice (BBC: 3.5% per side vertically). PAL sets showed all
 *  240. */
export function defaultDisplaySettings(): DisplaySettings {
	return {
		ntsc: { overscan: { width: 336, height: 224 } },
		pal: { overscan: { width: 336, height: 240 } },
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
