import { expect, test } from "vitest";
import { characterChords, charCommand } from "./char-keys.ts";

// The four printable characters with no ATASCII equivalent.
const EXCLUDED = new Set(["`", "{", "}", "~"]);

test("covers every printable ASCII except ` { } ~", () => {
	for (let code = 0x20; code <= 0x7e; code++) {
		const ch = String.fromCharCode(code);
		const hex = `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
		if (EXCLUDED.has(ch)) {
			expect(charCommand(ch, false), `${ch} (${hex})`).toBeUndefined();
		} else {
			expect(charCommand(ch, false), `${ch} (${hex})`).toBeDefined();
		}
	}
});

test("letter case follows the Shift modifier, not the produced case", () => {
	expect(charCommand("a", false)).toBe("PRESS_A");
	expect(charCommand("a", true)).toBe("PRESS_SHIFT_A");
	// A produced by CapsLock (no Shift modifier) is still a plain letter.
	expect(charCommand("A", false)).toBe("PRESS_A");
	// A produced by Shift is the Shift variant.
	expect(charCommand("A", true)).toBe("PRESS_SHIFT_A");
});

test("symbols ignore the Shift modifier (it's baked into the character)", () => {
	expect(charCommand("!", false)).toBe("PRESS_SHIFT_1");
	expect(charCommand("!", true)).toBe("PRESS_SHIFT_1");
	expect(charCommand(";", false)).toBe("PRESS_SEMICOLON");
});

test("space folds by the Shift modifier (like letters)", () => {
	expect(charCommand(" ", false)).toBe("PRESS_SPACE");
	expect(charCommand(" ", true)).toBe("PRESS_SHIFT_SPACE");
});

test("characterChords inverts the channel for shortcut display", () => {
	// Symbols show the glyph (Shift baked in); letters show Shift explicitly.
	expect(characterChords.get("PRESS_A")).toBe("A");
	expect(characterChords.get("PRESS_SHIFT_A")).toBe("Shift+A");
	expect(characterChords.get("PRESS_SHIFT_1")).toBe("!");
	expect(characterChords.get("PRESS_MINUS")).toBe("-");
	expect(characterChords.get("PRESS_LESS_THAN")).toBe("<");
	expect(characterChords.get("PRESS_SPACE")).toBe("Space");
	expect(characterChords.get("PRESS_SHIFT_SPACE")).toBe("Shift+Space");
	// Ctrl variants aren't in the character channel (they resolve positionally).
	expect(characterChords.has("PRESS_CONTROL_A")).toBe(false);
});
