import { expect, test } from "vitest";
import {
	defaultDisplaySettings,
	sanitizeFrameBlending,
	PALETTE_PRESETS,
	sanitizePalette,
	overscanCrop,
	sanitizeOverscan,
} from "./display-settings.ts";

test("defaults are the Normal preset per standard, frameBlending off", () => {
	const d = defaultDisplaySettings();
	expect(d.ntsc.overscan).toEqual({ width: 336, height: 224 });
	expect(d.pal.overscan).toEqual({ width: 336, height: 224 });
	expect(d.ntsc.frameBlending).toBe(0);
	expect(d.pal.frameBlending).toBe(0);
});

test("sanitizeFrameBlending clamps to 0-0.9", () => {
	expect(sanitizeFrameBlending(-1)).toBe(0);
	expect(sanitizeFrameBlending(0.5)).toBe(0.5);
	expect(sanitizeFrameBlending(1)).toBe(0.9);
});

test("the full frame crops to the whole buffer", () => {
	expect(overscanCrop({ width: 376, height: 240 })).toEqual({
		left: 0,
		top: 0,
		width: 376,
		height: 240,
	});
});

test("no-overscan is exactly the OS playfield window", () => {
	// Playfield: absolute hi-res 96..415 → buffer 28..347; display vcount
	// 32..223 → buffer rows 24..215.
	expect(overscanCrop({ width: 320, height: 192 })).toEqual({
		left: 28,
		top: 24,
		width: 320,
		height: 192,
	});
});

test("336×208 sits centred on the playfield, not the buffer", () => {
	// 336 → absolute 88..423 → buffer left 20; 208 → vcount 24..231 → top 16.
	expect(overscanCrop({ width: 336, height: 208 })).toEqual({
		left: 20,
		top: 16,
		width: 336,
		height: 208,
	});
});

test("sanitize clamps to the legal range and even values", () => {
	expect(sanitizeOverscan({ width: 300, height: 300 })).toEqual({
		width: 320,
		height: 240,
	});
	expect(sanitizeOverscan({ width: 400, height: 100 })).toEqual({
		width: 376,
		height: 192,
	});
	expect(sanitizeOverscan({ width: 335, height: 209 })).toEqual({
		width: 334,
		height: 208,
	});
});

test("palette defaults come from each standard's first preset", () => {
	const d = defaultDisplaySettings();
	expect(d.ntsc.palette).toEqual(PALETTE_PRESETS.ntsc["vintage"]);
	expect(d.pal.palette).toEqual(PALETTE_PRESETS.pal["calibrated"]);
	// The NTSC presets differ only in tint (the display's knob): Vintage's
	// period −40° hue 1 vs Modern's calibrated −57°.
	expect(PALETTE_PRESETS.ntsc["modern"]).toEqual({
		...PALETTE_PRESETS.ntsc["vintage"]!,
		hue1Angle: 303,
	});
	// "15 hues" is the equal-spacing camp: 360/15 = 24°/step (hue 15 stays
	// distinct from hue 1), tinted to keep Vintage's GR.0 blue.
	expect(PALETTE_PRESETS.ntsc["hues15"]).toEqual({
		...PALETTE_PRESETS.ntsc["vintage"]!,
		hue1Angle: 340,
		hueStep: 24,
	});
	// Blue GR. 0 is the fitted match of the NTSC vintage look (which also
	// yields the bluer background the name refers to).
	expect(PALETTE_PRESETS.pal["blueGr0"]).toEqual({
		...PALETTE_PRESETS.pal["calibrated"]!,
		hue1Angle: 154,
		hueStep: 23,
	});
});

test("sanitizePalette clamps to slider ranges", () => {
	expect(
		sanitizePalette({
			hue1Angle: 400,
			hueStep: -5,
			saturation: 1,
			brightness: -2,
			contrast: 9,
			gamma: 0,
			primaries: "vga" as never, // unknown → safe default
		}),
	).toEqual({
		hue1Angle: 360,
		hueStep: 0,
		saturation: 0.5,
		brightness: -0.5,
		contrast: 2,
		gamma: 0.5,
		primaries: "srgb",
	});
	// The pot goes all the way to 0, like the real trim pot.
	expect(
		sanitizePalette({ ...PALETTE_PRESETS.pal["calibrated"]!, hueStep: 3 }),
	).toEqual({ ...PALETTE_PRESETS.pal["calibrated"]!, hueStep: 3 });
	const ok = PALETTE_PRESETS.pal["blueGr0"]!;
	expect(sanitizePalette(ok)).toEqual(ok);
});
