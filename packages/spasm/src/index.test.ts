import { test, expect } from "vitest";
import { assemble } from "./index.ts";

test("the package exposes assemble()", () => {
	const result = assemble("nop\n");
	expect([...result.output]).toEqual([0xea]);
	expect(result.diagnostics).toEqual([]);
});
