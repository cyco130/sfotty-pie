import type { NormalizeProfile } from "./gamepad-normalize.ts";
import { loadPersisted, savePersisted } from "./persist.ts";

// The per-device normalization profiles, keyed by `gamepad.id`. Identical
// pads are indistinguishable and share a profile - fine, they're identical
// hardware. This is the device-dependent layer only; the device-independent
// bindings live in gamepad-bindings-store.ts. Bump VERSION to invalidate.
export const GAMEPAD_NORMALIZE_KEY = "gamepad-normalize";
const VERSION = 1;

export type NormalizeProfiles = Record<string, NormalizeProfile>;

interface Stored {
	v: number;
	profiles: NormalizeProfiles;
}

/** The persisted profiles, or none when absent / outdated / malformed. */
export function loadNormalizeProfiles(): NormalizeProfiles {
	const stored = loadPersisted(GAMEPAD_NORMALIZE_KEY) as Stored | undefined;
	if (stored?.v === VERSION && typeof stored.profiles === "object") {
		return stored.profiles;
	}
	return {};
}

/** Persist the profiles (the calibration wizard's save path). */
export function saveNormalizeProfiles(profiles: NormalizeProfiles): void {
	savePersisted(GAMEPAD_NORMALIZE_KEY, {
		v: VERSION,
		profiles,
	} satisfies Stored);
}
