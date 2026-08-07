import { expect, test } from "vitest";
import { toHostName } from "./host-names.ts";

test("passes portable names through", () => {
	expect(toHostName("game.com")).toBe("game.com");
	expect(toHostName("read-me_2.txt")).toBe("read-me_2.txt");
});

test("replaces host-hostile characters", () => {
	expect(toHostName("we!rd#n")).toBe("we_rd_n");
	expect(toHostName("a/b")).toBe("a_b");
});

test("guards hidden-file and option-lookalike names", () => {
	expect(toHostName(".hidden")).toBe("_.hidden");
	expect(toHostName("-dash")).toBe("_-dash");
	expect(toHostName("")).toBe("_");
});
