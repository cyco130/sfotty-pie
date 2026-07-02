import {
	type ConsoleBinding,
	DEFAULT_CONSOLE,
	DEFAULT_JOYSTICK,
	type JoyBinding,
} from "./gamepad.ts";
import { loadPersisted, savePersisted } from "./persist.ts";

// The gamepad binding set: the joystick layer (input → role, per port) and the
// console layer (input → command, port-0 only). Generated from the defaults on
// first run and then owned by the user, so later changes to the code defaults
// don't reach an existing store until it's reset. Bump VERSION to invalidate.
//
// This is the device-independent binding layer only. Per-device normalization
// (remap + analog conditioning for non-standard pads) is a separate store, keyed
// by gamepad id, applied ahead of these bindings.
export const GAMEPAD_BINDINGS_KEY = "gamepad-bindings";
const VERSION = 1;

export interface GamepadBindings {
	joystick: JoyBinding[];
	console: ConsoleBinding[];
}

interface Stored extends GamepadBindings {
	v: number;
}

/** The default binding set (fresh copies of the code defaults, so edits don't
 *  mutate the shared constants). */
export function defaultGamepadBindings(): GamepadBindings {
	return { joystick: [...DEFAULT_JOYSTICK], console: [...DEFAULT_CONSOLE] };
}

/** The persisted binding set, or the defaults when absent / outdated / malformed. */
export function loadGamepadBindings(): GamepadBindings {
	const stored = loadPersisted(GAMEPAD_BINDINGS_KEY) as Stored | undefined;
	if (
		stored?.v === VERSION &&
		Array.isArray(stored.joystick) &&
		Array.isArray(stored.console)
	) {
		return { joystick: stored.joystick, console: stored.console };
	}
	return defaultGamepadBindings();
}

/** Persist the binding set (the editor's save path). */
export function saveGamepadBindings(bindings: GamepadBindings): void {
	savePersisted(GAMEPAD_BINDINGS_KEY, {
		v: VERSION,
		...bindings,
	} satisfies Stored);
}
