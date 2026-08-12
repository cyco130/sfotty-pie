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

test("guards the names Windows reserves for devices", () => {
	// Resolved before the directory is consulted, and for any extension, so
	// "con.txt" would open the console rather than make a file. Every one of
	// these is a legal Atari name.
	expect(toHostName("con")).toBe("_con");
	expect(toHostName("CON.TXT")).toBe("_CON.TXT");
	expect(toHostName("aux")).toBe("_aux");
	expect(toHostName("prn.obj")).toBe("_prn.obj");
	expect(toHostName("nul")).toBe("_nul");
	expect(toHostName("com1")).toBe("_com1");
	expect(toHostName("lpt9.sys")).toBe("_lpt9.sys");
	// Only the whole stem counts - these are ordinary names.
	expect(toHostName("console")).toBe("console");
	expect(toHostName("conman.txt")).toBe("conman.txt");
});

test("guards trailing dots, which Windows strips silently", () => {
	// Without this "abc." and "abc" would land on the same file.
	expect(toHostName("abc.")).toBe("abc_");
	expect(toHostName("a..")).toBe("a__");
	expect(toHostName("..")).toBe("__");
});
