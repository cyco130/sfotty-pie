import {
	defaultDisplaySettings,
	type DisplaySettings,
	type OverscanSettings,
	sanitizeOverscan,
} from "./display-settings.ts";
import { loadPersisted, savePersisted } from "./persist.ts";

// The persisted per-standard display settings (see display-settings.ts).
// Unknown/malformed fields fall back to the defaults per standard, and
// overscan values are re-sanitized on load — so a hand-edited or outdated
// store degrades gracefully instead of resetting wholesale.
export const DISPLAY_SETTINGS_KEY = "display-settings";
const VERSION = 1;

interface Stored {
	v: number;
	settings: DisplaySettings;
}

function sanitize(raw: unknown, fallback: OverscanSettings): OverscanSettings {
	const o = raw as { width?: unknown; height?: unknown } | undefined;
	return sanitizeOverscan({
		width: typeof o?.width === "number" ? o.width : fallback.width,
		height: typeof o?.height === "number" ? o.height : fallback.height,
	});
}

/** The persisted settings, defaulted and sanitized per field. */
export function loadDisplaySettings(): DisplaySettings {
	const defaults = defaultDisplaySettings();
	const stored = loadPersisted(DISPLAY_SETTINGS_KEY) as Stored | undefined;
	if (stored?.v !== VERSION || typeof stored.settings !== "object") {
		return defaults;
	}
	return {
		ntsc: {
			overscan: sanitize(
				stored.settings.ntsc?.overscan,
				defaults.ntsc.overscan,
			),
		},
		pal: {
			overscan: sanitize(stored.settings.pal?.overscan, defaults.pal.overscan),
		},
	};
}

/** Persist the settings (the future settings page's save path). */
export function saveDisplaySettings(settings: DisplaySettings): void {
	savePersisted(DISPLAY_SETTINGS_KEY, {
		v: VERSION,
		settings,
	} satisfies Stored);
}
