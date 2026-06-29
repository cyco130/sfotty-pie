import { expect, test } from "vitest";
import { paletteCommands } from "./commands.ts";

test("dead Ctrl+Shift combos are hidden from the palette", () => {
	const listed = new Set(paletteCommands);
	// Unscannable while Ctrl+Shift held (base $00–$07 / $10–$17) — no-ops.
	expect(listed.has("PRESS_CONTROL_SHIFT_L")).toBe(false); // $C0
	expect(listed.has("PRESS_CONTROL_SHIFT_F1")).toBe(false); // $C3
	expect(listed.has("PRESS_CONTROL_SHIFT_HELP")).toBe(false); // $D1
	expect(listed.has("PRESS_CONTROL_SHIFT_Z")).toBe(false); // $D7
	// Scannable Ctrl+Shift keys and everything else stay listed.
	expect(listed.has("PRESS_CONTROL_SHIFT_A")).toBe(true); // $FF
	expect(listed.has("PRESS_A")).toBe(true);
	expect(listed.has("PRESS_CONTROL_HELP")).toBe(true);
});
