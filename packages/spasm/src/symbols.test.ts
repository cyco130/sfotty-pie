import { describe, test, expect } from "vitest";
import { SymbolTable } from "./symbols.ts";

const SPAN = [0, 1] as const;

describe("SymbolTable", () => {
	test("records value and kind", () => {
		const t = new SymbolTable();
		t.beginPass();
		t.define("FOO", 5n, "constant", SPAN);
		t.define("loop", 0x400n, "label", SPAN);
		expect(t.resolve("FOO")).toBe(5n);
		expect(t.kindOf("FOO")).toBe("constant");
		expect(t.kindOf("loop")).toBe("label");
		expect(t.resolve("missing")).toBeUndefined();
		expect(t.kindOf("missing")).toBeUndefined();
	});

	test("define-once within a pass; redefinable across passes", () => {
		const t = new SymbolTable();
		t.beginPass();
		expect(t.define("X", 1n, "constant", SPAN)).toBeUndefined();
		expect(t.define("X", 2n, "constant", SPAN)).toEqual(SPAN); // duplicate -> prior span
		expect(t.resolve("X")).toBe(1n); // first definition kept

		t.beginPass();
		expect(t.define("X", 9n, "constant", SPAN)).toBeUndefined(); // re-set across passes
		expect(t.resolve("X")).toBe(9n);
	});

	test("fixpoint detection via snapshot", () => {
		const t = new SymbolTable();
		t.beginPass();
		const before = t.snapshot();
		t.define("X", 1n, "constant", SPAN);
		expect(t.changedSince(before)).toBe(true);

		const after = t.snapshot();
		t.beginPass();
		t.define("X", 1n, "constant", SPAN);
		expect(t.changedSince(after)).toBe(false);
	});
});
