import {
	type ConsoleBinding,
	DEFAULT_CONSOLE,
	DEFAULT_JOYSTICK,
	type JoyBinding,
} from "./gamepad.ts";
import { loadPersisted, savePersisted } from "./persist.ts";

// The gamepad binding set: the joystick layer (input -> role, per port) and the
// console layer (input -> command, port-0 only). Generated from the defaults on
// first run and then owned by the user, so later changes to the code defaults
// don't reach an existing store - bump VERSION and add a migration below to
// deliver a new default without discarding the user's edits.
//
// This is the device-independent binding layer only. Per-device normalization
// (remap + analog conditioning for non-standard pads) is a separate store, keyed
// by gamepad id, applied ahead of these bindings.
export const GAMEPAD_BINDINGS_KEY = "gamepad-bindings";

export interface GamepadBindings {
	joystick: JoyBinding[];
	console: ConsoleBinding[];
}

/** The default binding set (fresh copies of the code defaults, so edits don't
 *  mutate the shared constants). */
export function defaultGamepadBindings(): GamepadBindings {
	return { joystick: [...DEFAULT_JOYSTICK], console: [...DEFAULT_CONSOLE] };
}

/** The persisted binding set - migrated forward if from an older version - or
 *  the defaults when absent / unknown / malformed. */
export function loadGamepadBindings(): GamepadBindings {
	const stored = loadPersisted(GAMEPAD_BINDINGS_KEY) as Stored | undefined;
	if (
		!stored ||
		!Array.isArray(stored.joystick) ||
		!Array.isArray(stored.console)
	) {
		return defaultGamepadBindings();
	}
	const bindings = { joystick: stored.joystick, console: stored.console };
	if (stored.v === VERSION) return bindings;
	if (stored.v === 1) {
		const migrated = migrateV1(bindings);
		saveGamepadBindings(migrated); // one-shot upgrade, persisted as v2
		return migrated;
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

/**
 * v1 -> v2: OPEN_FAVORITES joined the default console layer on R3. The store
 * is user-owned, so instead of resetting it, append the new default - unless
 * the user already binds that button or that command. Exported for tests.
 */
export function migrateV1(stored: GamepadBindings): GamepadBindings {
	const taken = stored.console.some(
		(b) =>
			b.command === "OPEN_FAVORITES" ||
			("button" in b.input && b.input.button === 11),
	);
	if (taken) return stored;
	return {
		...stored,
		console: [
			...stored.console,
			{ input: { button: 11 }, command: "OPEN_FAVORITES" },
		],
	};
}

const VERSION = 2;

interface Stored extends GamepadBindings {
	v: number;
}
