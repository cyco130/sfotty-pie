import {
	defaultDisplaySettings,
	type DisplaySettings,
	type OverscanSettings,
	type PaletteSettings,
	sanitizeOverscan,
	sanitizePalette,
	sanitizeFrameBlending,
	type StandardDisplaySettings,
} from "./display-settings.ts";
import { loadPersisted, savePersisted } from "./persist.ts";

// The persisted per-standard display settings (see display-settings.ts).
// Unknown/malformed fields fall back to the defaults per field, and values
// are re-sanitized on load - so a hand-edited or outdated store degrades
// gracefully instead of resetting wholesale.
export const DISPLAY_SETTINGS_KEY = "display-settings";
const VERSION = 1;

interface Stored {
	v: number;
	settings: DisplaySettings;
}

function number(raw: unknown, fallback: number): number {
	return typeof raw === "number" ? raw : fallback;
}

function sanitizeStandard(
	raw: StandardDisplaySettings | undefined,
	fallback: StandardDisplaySettings,
): StandardDisplaySettings {
	const o = raw?.overscan as Partial<OverscanSettings> | undefined;
	const p = raw?.palette as Partial<PaletteSettings> | undefined;
	return {
		overscan: sanitizeOverscan({
			width: number(o?.width, fallback.overscan.width),
			height: number(o?.height, fallback.overscan.height),
		}),
		palette: sanitizePalette({
			hue1Angle: number(p?.hue1Angle, fallback.palette.hue1Angle),
			hueStep: number(p?.hueStep, fallback.palette.hueStep),
			saturation: number(p?.saturation, fallback.palette.saturation),
			brightness: number(p?.brightness, fallback.palette.brightness),
			contrast: number(p?.contrast, fallback.palette.contrast),
			gamma: number(p?.gamma, fallback.palette.gamma),
			// Non-strings sanitize to the safe default downstream.
			primaries:
				typeof p?.primaries === "string"
					? p.primaries
					: fallback.palette.primaries,
		}),
		frameBlending: sanitizeFrameBlending(
			number(raw?.frameBlending, fallback.frameBlending),
		),
	};
}

/** The persisted settings, defaulted and sanitized per field. */
export function loadDisplaySettings(): DisplaySettings {
	const defaults = defaultDisplaySettings();
	const stored = loadPersisted(DISPLAY_SETTINGS_KEY) as Stored | undefined;
	if (stored?.v !== VERSION || typeof stored.settings !== "object") {
		return defaults;
	}
	return {
		ntsc: sanitizeStandard(stored.settings.ntsc, defaults.ntsc),
		pal: sanitizeStandard(stored.settings.pal, defaults.pal),
	};
}

/** Persist the settings (the future settings page's save path). */
export function saveDisplaySettings(settings: DisplaySettings): void {
	savePersisted(DISPLAY_SETTINGS_KEY, {
		v: VERSION,
		settings,
	} satisfies Stored);
}
