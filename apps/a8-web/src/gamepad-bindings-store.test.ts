import { expect, test } from "vitest";
import { type GamepadBindings, migrateV1 } from "./gamepad-bindings-store.ts";

test("v1 stores gain the R3 game-picker binding, edits untouched", () => {
	const v1: GamepadBindings = {
		joystick: [{ input: { button: 2 }, role: "trigger" }],
		console: [{ input: { button: 9 }, command: "PRESS_START" }],
	};
	const out = migrateV1(v1);
	expect(out.console).toContainEqual({
		input: { button: 11 },
		command: "OPEN_FAVORITES",
	});
	expect(out.console[0]).toEqual(v1.console[0]);
	expect(out.joystick).toEqual(v1.joystick);
});

test("migration defers to an existing button-11 or OPEN_FAVORITES binding", () => {
	const button11: GamepadBindings = {
		joystick: [],
		console: [{ input: { button: 11 }, command: "TOGGLE_PAUSE" }],
	};
	expect(migrateV1(button11)).toBe(button11);
	const rebound: GamepadBindings = {
		joystick: [],
		console: [{ input: { button: 3 }, command: "OPEN_FAVORITES" }],
	};
	expect(migrateV1(rebound)).toBe(rebound);
});
