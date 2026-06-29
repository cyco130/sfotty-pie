import { expect, test } from "vitest";
import {
	defaultBindings,
	type KeyboardMode,
	type KeyEventLike,
	resolveBinding,
} from "./key-bindings.ts";

// A KeyEventLike with all modifiers up by default.
function ev(partial: Partial<KeyEventLike>): KeyEventLike {
	return {
		code: "",
		key: "",
		shift: false,
		ctrl: false,
		alt: false,
		meta: false,
		...partial,
	};
}

function resolve(
	event: Partial<KeyEventLike>,
	mode: KeyboardMode = "character",
	mac = false,
): string | null {
	return resolveBinding(defaultBindings(mac, mode), ev(event))?.command ?? null;
}

test("Shift-agnostic device keys fire with or without Shift", () => {
	expect(resolve({ key: "F2" })).toBe("PRESS_OPTION");
	expect(resolve({ key: "F2", shift: true })).toBe("PRESS_OPTION"); // Shift+Option
	expect(resolve({ key: "F2", ctrl: true })).toBe("PRESS_OPTION"); // Ctrl-agnostic
	expect(resolve({ key: "ArrowUp", shift: true })).toBe("PRESS_JOY0_UP");
});

test("Ctrl is exact, so Reset and Power-cycle don't overlap", () => {
	expect(resolve({ key: "F5" })).toBe("PRESS_RESET");
	expect(resolve({ key: "F5", shift: true })).toBe("PRESS_RESET");
	expect(resolve({ key: "F5", ctrl: true })).toBe("POWER_CYCLE");
});

test("arrows split by modifier: joystick / cursor", () => {
	expect(resolve({ key: "ArrowUp" })).toBe("PRESS_JOY0_UP");
	expect(resolve({ key: "ArrowUp", ctrl: true })).toBe("PRESS_CONTROL_MINUS");
});

test("nav keys → 1200XL F1–F4 with inverted Shift (universal)", () => {
	// Plain nav key gives the Atari Shift+Fn (its meaning); host Shift inverts it.
	expect(resolve({ key: "PageUp" })).toBe("PRESS_SHIFT_F1");
	expect(resolve({ key: "PageUp", shift: true })).toBe("PRESS_F1");
	expect(resolve({ key: "Home" })).toBe("PRESS_SHIFT_F3");
	expect(resolve({ key: "Home", ctrl: true })).toBe("PRESS_CONTROL_F3");
	expect(resolve({ key: "End", ctrl: true, shift: true })).toBe(
		"PRESS_CONTROL_SHIFT_F4",
	);
});

test("positional char keys are mode-gated", () => {
	// Character mode: the char keys belong to the character channel, not bindings.
	expect(resolve({ code: "KeyA", key: "a" }, "character")).toBeNull();
	// Positional mode: matched by physical code, with exact modifiers.
	expect(resolve({ code: "KeyA", key: "a" }, "positional")).toBe("PRESS_A");
	expect(resolve({ code: "KeyA", key: "a", shift: true }, "positional")).toBe(
		"PRESS_SHIFT_A",
	);
});

test("Ctrl combos resolve by code, not produced character", () => {
	// The keyboard resolves Ctrl combos against the positional layer — distinct
	// physical keys give distinct commands even when the OS reports the same key
	// (Turkish Ctrl+\ vs Ctrl+, both report ",").
	const pos = defaultBindings(false, "positional");
	const cmd = (code: string) =>
		resolveBinding(pos, ev({ code, ctrl: true }))?.command;
	expect(cmd("Backslash")).toBe("PRESS_CONTROL_ASTERISK");
	expect(cmd("Comma")).toBe("PRESS_CONTROL_COMMA");
	expect(cmd("Semicolon")).toBe("PRESS_CONTROL_SEMICOLON");
});

test("Windows aliases browser-grabbed Ctrl combos onto Alt", () => {
	// Alt stands in for Ctrl on the grabbed keys only (non-mac).
	expect(resolve({ code: "Digit1", alt: true }, "character", false)).toBe(
		"PRESS_CONTROL_1",
	);
	expect(
		resolve({ code: "Digit1", alt: true, shift: true }, "character", false),
	).toBe("PRESS_CONTROL_SHIFT_1");
	expect(resolve({ code: "KeyN", alt: true }, "character", false)).toBe(
		"PRESS_CONTROL_N",
	);
	// Not on Mac (Option is for chars / F-keys there)…
	expect(resolve({ code: "Digit1", alt: true }, "character", true)).toBeNull();
	// …and only the grabbed keys — other Alt+letter stays free for commands.
	expect(resolve({ code: "KeyA", alt: true }, "character", false)).toBeNull();
});

test("macOS overlay: Cmd+Arrow cursor, Option+Arrow F1–F4", () => {
	expect(
		resolve({ key: "ArrowUp", meta: true }, "character", false),
	).toBeNull();
	expect(resolve({ key: "ArrowUp", meta: true }, "character", true)).toBe(
		"PRESS_CONTROL_MINUS",
	);
	// Option+Arrow → F1–F4 is mac-only (Alt is unusable for it on Windows).
	expect(resolve({ key: "ArrowUp", alt: true }, "character", false)).toBeNull();
	expect(resolve({ key: "ArrowUp", alt: true }, "character", true)).toBe(
		"PRESS_F1",
	);
});

test("relocated F-key homes (Help/Tab/Esc/Inverse)", () => {
	expect(resolve({ key: "F10", ctrl: true })).toBe("PRESS_CONTROL_HELP");
	expect(resolve({ key: "F9", ctrl: true })).toBe("PRESS_CONTROL_TAB");
	expect(resolve({ key: "F8" })).toBe("PRESS_BREAK");
	expect(resolve({ key: "F12" })).toBe("PRESS_INVERSE_VIDEO");
});
