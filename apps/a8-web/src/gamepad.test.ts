import { expect, test } from "vitest";
import { padDisplayName } from "./gamepad.ts";

test("padDisplayName strips vendor/product noise", () => {
	// Chrome: trailing parenthetical.
	expect(padDisplayName("Xbox 360 Controller (XInput STANDARD GAMEPAD)")).toBe(
		"Xbox 360 Controller",
	);
	expect(padDisplayName("Trust GXT 540 (Vendor: 24f0 Product: 0104)")).toBe(
		"Trust GXT 540",
	);
	// Firefox: leading hex vendor-product ids.
	expect(padDisplayName("045e-028e-Microsoft X-Box 360 pad")).toBe(
		"Microsoft X-Box 360 pad",
	);
	// Nothing to strip.
	expect(padDisplayName("My Plain Pad")).toBe("My Plain Pad");
	// Never strips down to nothing.
	expect(padDisplayName("(weird)")).toBe("(weird)");
});
