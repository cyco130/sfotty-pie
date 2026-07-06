import { expect, test } from "vitest";
import {
	defaultDisplaySettings,
	overscanCrop,
	sanitizeOverscan,
} from "./display-settings.ts";

test("defaults are the Normal preset per standard", () => {
	const d = defaultDisplaySettings();
	expect(d.ntsc.overscan).toEqual({ width: 336, height: 224 });
	expect(d.pal.overscan).toEqual({ width: 336, height: 240 });
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
