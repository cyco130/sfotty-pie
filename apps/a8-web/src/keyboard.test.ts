import { expect, test } from "vitest";
import { defaultBindingSet, type KeyEventLike } from "./key-bindings.ts";
import { characterModeCommand } from "./keyboard.ts";

const set = defaultBindingSet(false);

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

const cmd = (partial: Partial<KeyEventLike>) =>
	characterModeCommand(set, ev(partial));

test("typed ATASCII characters win over the positional binding", () => {
	// AZERTY: the key at the QWERTY-A position produces "q" → type Q, shadowing the
	// positional A binding. Layout-aware, by produced character.
	expect(cmd({ code: "KeyA", key: "q" })).toBe("PRESS_Q");
	expect(cmd({ code: "KeyA", key: "Q", shift: true })).toBe("PRESS_SHIFT_Q");
	// Symbols carry their own Shift in the produced glyph.
	expect(cmd({ code: "Digit1", key: "!", shift: true })).toBe("PRESS_SHIFT_1");
	// Space folds by the Shift modifier, like letters.
	expect(cmd({ code: "Space", key: " " })).toBe("PRESS_SPACE");
	expect(cmd({ code: "Space", key: " ", shift: true })).toBe(
		"PRESS_SHIFT_SPACE",
	);
});

test("Ctrl/Alt/Cmd combos and named keys fall through to the bindings", () => {
	// Ctrl resolves positionally by code (produced key is unreliable under Ctrl).
	expect(cmd({ code: "KeyA", key: "a", ctrl: true })).toBe("PRESS_CONTROL_A");
	expect(cmd({ code: "F5", key: "F5" })).toBe("PRESS_RESET");
	expect(cmd({ code: "ArrowUp", key: "ArrowUp" })).toBe("PRESS_JOY0_UP");
});

test("a non-ATASCII key falls through to its positional binding", () => {
	// Turkish ş has no ATASCII equivalent; at the Semicolon position it gives the
	// Atari ; there — and a user binding could still claim it.
	expect(cmd({ code: "Semicolon", key: "ş" })).toBe("PRESS_SEMICOLON");
});

test("dead keys yield nothing — composition delivers the glyph", () => {
	expect(cmd({ code: "BracketLeft", key: "Dead" })).toBeUndefined();
});
