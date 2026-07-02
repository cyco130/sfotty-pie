import { expect, test } from "vitest";
import {
	type Binding,
	bakeDefaults,
	defaultBindingSet,
	keyLabel,
	labelFor,
	type KeyEventLike,
	resolveBinding,
	upperLegends,
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

// Resolve an event against the flat default set (one set; the mode lives in the
// keyboard, not the table — see keyboard.test.ts for character-channel behavior).
function resolve(event: Partial<KeyEventLike>, mac = false): string | null {
	return resolveBinding(defaultBindingSet(mac), ev(event))?.command ?? null;
}

test("Shift-agnostic device keys fire with or without Shift", () => {
	expect(resolve({ code: "F2" })).toBe("PRESS_OPTION");
	expect(resolve({ code: "F2", shift: true })).toBe("PRESS_OPTION"); // Shift+Option
	expect(resolve({ code: "F2", ctrl: true })).toBe("PRESS_OPTION"); // Ctrl-agnostic
	expect(resolve({ code: "ArrowUp", shift: true })).toBe("PRESS_JOY0_UP");
});

test("Ctrl is exact, so Reset and Power-cycle don't overlap", () => {
	expect(resolve({ code: "F5" })).toBe("PRESS_RESET");
	expect(resolve({ code: "F5", shift: true })).toBe("PRESS_RESET");
	expect(resolve({ code: "F5", ctrl: true })).toBe("POWER_CYCLE");
});

test("arrows split by modifier: joystick / cursor", () => {
	expect(resolve({ code: "ArrowUp" })).toBe("PRESS_JOY0_UP");
	expect(resolve({ code: "ArrowUp", ctrl: true })).toBe("PRESS_CONTROL_MINUS");
});

test("nav keys → 1200XL F1–F4 with inverted Shift (universal)", () => {
	// Plain nav key gives the Atari Shift+Fn (its meaning); host Shift inverts it.
	expect(resolve({ code: "PageUp" })).toBe("PRESS_SHIFT_F1");
	expect(resolve({ code: "PageUp", shift: true })).toBe("PRESS_F1");
	expect(resolve({ code: "Home" })).toBe("PRESS_SHIFT_F3");
	expect(resolve({ code: "Home", ctrl: true })).toBe("PRESS_CONTROL_F3");
	expect(resolve({ code: "End", ctrl: true })).toBe("PRESS_CONTROL_F4");
});

test("unscannable Ctrl+Shift combos get no binding", () => {
	// F1–F4 and the matrix keys L/J/;/K/+/*/V/C/B/X/Z can't be scanned with both
	// Ctrl and Shift, so the Ctrl+Shift variant is dropped.
	expect(resolve({ code: "End", ctrl: true, shift: true })).toBeNull(); // → F4
	expect(resolve({ code: "KeyL", ctrl: true, shift: true })).toBeNull();
	expect(resolve({ code: "Semicolon", ctrl: true, shift: true })).toBeNull();
	// A scannable key keeps its Ctrl+Shift binding.
	expect(resolve({ code: "KeyA", ctrl: true, shift: true })).toBe(
		"PRESS_CONTROL_SHIFT_A",
	);
});

test("Cmd (mac) / Alt (win) on -/= reach the Shift+Clear / insert-line forms", () => {
	// The Atari </ > (Clear / Insert) sit at the -/= positions. Their Ctrl forms
	// are positional (Ctrl+-/Ctrl+=), but host Shift+-/= type characters, so the
	// Shift forms have no positional route — Cmd/Alt supply them.
	expect(resolve({ code: "Minus", meta: true }, true)).toBe(
		"PRESS_SHIFT_LESS_THAN",
	);
	expect(resolve({ code: "Equal", meta: true }, true)).toBe(
		"PRESS_SHIFT_GREATER_THAN",
	);
	// Shift-agnostic, so Cmd++ (Cmd+Shift+=) lands the same as Cmd+=.
	expect(resolve({ code: "Equal", meta: true, shift: true }, true)).toBe(
		"PRESS_SHIFT_GREATER_THAN",
	);
	// Windows uses Alt for the same; the modifier doesn't cross platforms.
	expect(resolve({ code: "Minus", alt: true })).toBe("PRESS_SHIFT_LESS_THAN");
	expect(resolve({ code: "Equal", alt: true })).toBe(
		"PRESS_SHIFT_GREATER_THAN",
	);
	expect(resolve({ code: "Minus", alt: true }, true)).toBeNull();
	expect(resolve({ code: "Minus", meta: true })).toBeNull();
	// The Ctrl forms still resolve positionally (unchanged by the Cmd/Alt route).
	expect(resolve({ code: "Minus", ctrl: true })).toBe(
		"PRESS_CONTROL_LESS_THAN",
	);
});

test("keyLabel names the bare modifier keys (mac-aware, with side)", () => {
	expect(keyLabel("MetaLeft", true)).toBe("Left Cmd");
	expect(keyLabel("MetaLeft", false)).toBe("Left Win");
	expect(keyLabel("AltRight", true)).toBe("Right Opt");
	expect(keyLabel("AltRight", false)).toBe("Right Alt");
	expect(keyLabel("ShiftLeft", false)).toBe("Left Shift");
	// Non-modifier codes are unchanged.
	expect(keyLabel("KeyA", true)).toBe("A");
	expect(keyLabel("F5", false)).toBe("F5");
});

test("resolveBinding prefers the most specific match (any ranks lower)", () => {
	// An overlap only "any" can create: a catch-all and a precise binding on KeyA.
	const set: Binding[] = [
		{ on: "KeyA", shift: "any", command: "PRESS_A" }, // catch-all
		{ on: "KeyA", shift: true, command: "PRESS_SHIFT_A" }, // precise
	];
	// Shift+A matches both → the precise one wins, regardless of array order.
	expect(resolveBinding(set, ev({ code: "KeyA", shift: true }))?.command).toBe(
		"PRESS_SHIFT_A",
	);
	expect(
		resolveBinding([...set].reverse(), ev({ code: "KeyA", shift: true }))
			?.command,
	).toBe("PRESS_SHIFT_A");
	// Plain A matches only the catch-all.
	expect(resolveBinding(set, ev({ code: "KeyA" }))?.command).toBe("PRESS_A");
});

test("bakeDefaults anchors letter shortcuts to the layout's key", () => {
	// A layout where the K key has moved: physical KeyK types "M", and "K" is
	// produced by the Comma key (the shape of a Turkish-F-style rearrangement).
	const layout = new Map([
		["KeyK", "M"],
		["Comma", "K"],
	]);
	const set: Binding[] = [
		{
			on: "KeyK",
			meta: true,
			command: "OPEN_PALETTE",
			scope: "global",
			anchor: "letter",
		},
	];
	const [baked] = bakeDefaults(set, layout);
	// Follows the K key (Comma here), labeled "K", with the hint stripped.
	expect(baked).toMatchObject({ on: "Comma", label: "K" });
	expect(baked!.anchor).toBeUndefined();
	// No layout data → keeps the QWERTY position and the letter label.
	const [fallback] = bakeDefaults(set, new Map());
	expect(fallback).toMatchObject({ on: "KeyK", label: "K" });
});

test("bakeDefaults re-homes a Ctrl alias to the position's Atari key", () => {
	// Turkish-F-style: the letter N is produced by KeyI, so Alt+N should land on
	// KeyI and take that position's Atari Ctrl command (Ctrl+I), labeled "N".
	const layout = new Map([
		["KeyI", "N"],
		["KeyN", "M"],
	]);
	const set: Binding[] = [
		// The positional Ctrl layer the alias re-homes onto.
		{ on: "KeyI", ctrl: true, command: "PRESS_CONTROL_I" },
		{ on: "KeyN", ctrl: true, command: "PRESS_CONTROL_N" },
		// The Alt-for-Ctrl alias, anchored.
		{ on: "KeyN", alt: true, command: "PRESS_CONTROL_N", anchor: "ctrl" },
	];
	const alias = bakeDefaults(set, layout).find((b) => b.alt);
	expect(alias).toMatchObject({
		on: "KeyI",
		command: "PRESS_CONTROL_I",
		label: "N",
	});
	expect(alias!.anchor).toBeUndefined();
	// No layout data → stays on the QWERTY position and its command.
	const fallback = bakeDefaults(set, new Map()).find((b) => b.alt);
	expect(fallback).toMatchObject({ on: "KeyN", command: "PRESS_CONTROL_N" });
});

test("a committed label wins over the live layout (editable legends)", () => {
	const layout = new Map([["KeyA", "Q"]]); // e.g. AZERTY legend
	// No committed label → resolve from the layout (this is the bake path).
	expect(labelFor({ on: "KeyA", command: "PRESS_A" }, layout)).toBe("Q");
	// A committed label is authoritative (so user edits survive).
	expect(labelFor({ on: "KeyA", command: "PRESS_A", label: "★" }, layout)).toBe(
		"★",
	);
});

test("Turkish layout uppercases the dotted/dotless i as İ / I", () => {
	// Both i and ı present → case in the "tr" locale so each keeps its dot.
	const tr = upperLegends([
		["KeyI", "i"],
		["Backslash", "ı"],
		["KeyA", "a"],
	]);
	expect(tr.get("KeyI")).toBe("İ");
	expect(tr.get("Backslash")).toBe("I");
	expect(tr.get("KeyA")).toBe("A");
	// A non-Turkish layout (no ı) uppercases i the ordinary way.
	const us = upperLegends([["KeyI", "i"]]);
	expect(us.get("KeyI")).toBe("I");
});

test("German ß keeps its keycap form, not the SS expansion", () => {
	expect(upperLegends([["Minus", "ß"]]).get("Minus")).toBe("ß");
});

test("upperLegends numbers a symbol number row (AZERTY) but keeps a real one", () => {
	// AZERTY: the number row is symbols unshifted → label each DigitN as its numeral.
	const azerty = upperLegends([
		["Digit1", "&"],
		["Digit2", "é"],
		["Digit3", '"'],
		["Digit4", "'"],
		["Digit5", "("],
		["Digit6", "-"],
		["Digit7", "è"],
		["Digit8", "_"],
		["Digit9", "ç"],
		["Digit0", "à"],
	]);
	expect(azerty.get("Digit1")).toBe("1");
	expect(azerty.get("Digit7")).toBe("7");
	expect(azerty.get("Digit0")).toBe("0");
	// A full digit row is trusted as-is, reordering included.
	const reordered = upperLegends([
		["Digit1", "2"],
		["Digit2", "1"],
		["Digit3", "3"],
		["Digit4", "4"],
		["Digit5", "5"],
		["Digit6", "6"],
		["Digit7", "7"],
		["Digit8", "8"],
		["Digit9", "9"],
		["Digit0", "0"],
	]);
	expect(reordered.get("Digit1")).toBe("2");
	expect(reordered.get("Digit2")).toBe("1");
});

test("character keys are bound by physical code (Ctrl path + Positional mode)", () => {
	// One flat set binds the character keys by code: Positional mode uses these
	// directly, and Character mode reaches them for Ctrl combos and fallback.
	expect(resolve({ code: "KeyA" })).toBe("PRESS_A");
	expect(resolve({ code: "KeyA", shift: true })).toBe("PRESS_SHIFT_A");
	expect(resolve({ code: "KeyA", ctrl: true })).toBe("PRESS_CONTROL_A");
	expect(resolve({ code: "Space" })).toBe("PRESS_SPACE");
	expect(resolve({ code: "Space", shift: true })).toBe("PRESS_SHIFT_SPACE");
	expect(resolve({ code: "Space", ctrl: true })).toBe("PRESS_CONTROL_SPACE");
});

test("Ctrl combos resolve by code, not produced character", () => {
	// Distinct physical keys give distinct commands even when the OS reports the
	// same key (Turkish Ctrl+\ vs Ctrl+, both report ",").
	const set = defaultBindingSet(false);
	const cmd = (code: string) =>
		resolveBinding(set, ev({ code, ctrl: true }))?.command;
	expect(cmd("Backslash")).toBe("PRESS_CONTROL_ASTERISK");
	expect(cmd("Comma")).toBe("PRESS_CONTROL_COMMA");
	expect(cmd("Semicolon")).toBe("PRESS_CONTROL_SEMICOLON");
});

test("Windows aliases browser-grabbed Ctrl combos onto Alt", () => {
	// Alt stands in for Ctrl on the grabbed keys only (non-mac).
	expect(resolve({ code: "Digit1", alt: true })).toBe("PRESS_CONTROL_1");
	expect(resolve({ code: "Digit1", alt: true, shift: true })).toBe(
		"PRESS_CONTROL_SHIFT_1",
	);
	expect(resolve({ code: "KeyN", alt: true })).toBe("PRESS_CONTROL_N");
	// Not on Mac (Option is for chars / F-keys there)…
	expect(resolve({ code: "Digit1", alt: true }, true)).toBeNull();
	// …and only the grabbed keys — other Alt+letter stays free for commands.
	expect(resolve({ code: "KeyA", alt: true })).toBeNull();
});

test("macOS overlay: Cmd+Arrow cursor, Option+Arrow F1–F4", () => {
	expect(resolve({ code: "ArrowUp", meta: true })).toBeNull();
	expect(resolve({ code: "ArrowUp", meta: true }, true)).toBe(
		"PRESS_CONTROL_MINUS",
	);
	// Option+Arrow → F1–F4 is mac-only (Alt is unusable for it on Windows).
	expect(resolve({ code: "ArrowUp", alt: true })).toBeNull();
	expect(resolve({ code: "ArrowUp", alt: true }, true)).toBe("PRESS_F1");
});

test("the palette chord is a global binding (Cmd+K mac / Alt+K win)", () => {
	const mac = defaultBindingSet(true).find((b) => b.command === "OPEN_PALETTE");
	expect(mac).toMatchObject({ on: "KeyK", meta: true, scope: "global" });
	const win = defaultBindingSet(false).find(
		(b) => b.command === "OPEN_PALETTE",
	);
	expect(win).toMatchObject({ on: "KeyK", alt: true, scope: "global" });
	// Machine keys carry no scope (default "a8" — resolved on the focused input).
	expect(
		defaultBindingSet(false).find((b) => b.command === "PRESS_A")?.scope,
	).toBeUndefined();
});

test("relocated F-key homes (Help/Tab/Esc/Inverse)", () => {
	expect(resolve({ code: "F1", ctrl: true })).toBe("PRESS_CONTROL_HELP");
	expect(resolve({ code: "F9", ctrl: true })).toBe("PRESS_CONTROL_TAB");
	expect(resolve({ code: "F8" })).toBe("PRESS_BREAK");
	expect(resolve({ code: "F10" })).toBe("PRESS_INVERSE_VIDEO");
	expect(resolve({ code: "F12" })).toBeNull(); // F12 left free
});
