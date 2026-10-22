import { describe, expect, test } from "vitest";
import { assemble } from "./assemble.ts";
import type { Host } from "./loader.ts";

/** An in-memory host: module ids are their own specifiers (identity resolve). */
function memHost(files: Record<string, string>): Host {
	return {
		resolve: (specifier) => specifier,
		read: (id) => {
			if (id in files) return files[id]!;
			throw new Error(`no module "${id}"`);
		},
	};
}

/** The source map as `[address, length, line]`, which is what reads best here. */
function mapOf(src: string): [number, number, number][] {
	const result = assemble(src, "t");
	expect(result.diagnostics.map((d) => d.message)).toEqual([]);
	return result.sourceMap.map((e) => [e.address, e.length, e.line]);
}

describe("sourceMap", () => {
	test("locates each run in the output image", () => {
		// `.org` moves the address but not the offset: the file stays contiguous.
		const result = assemble(".org $0200\nnop\n.org $8000\nrts\n", "t");

		expect(result.sourceMap.map((e) => [e.address, e.offset])).toEqual([
			[0x0200, 0],
			[0x8000, 1],
		]);
		// Every run can be sliced straight out of the output.
		for (const entry of result.sourceMap) {
			expect(
				result.output.slice(entry.offset, entry.offset + entry.length),
			).toHaveLength(entry.length);
		}
	});

	test("gives each statement its address, size and line", () => {
		expect(mapOf(".org $0200\nlda #$01\nsta $10\nrts\n")).toEqual([
			[0x0200, 2, 2],
			[0x0202, 2, 3],
			[0x0204, 1, 4],
		]);
	});

	test("follows .org rather than the output offset", () => {
		expect(mapOf("nop\n.org $8000\nnop\n")).toEqual([
			[0x0000, 1, 1],
			[0x8000, 1, 3],
		]);
	});

	test("covers data directives", () => {
		expect(mapOf('.org $0300\n.byte "AB", 0\n.word $1234\n')).toEqual([
			[0x0300, 3, 2],
			[0x0303, 2, 3],
		]);
	});

	test("skips lines that emit nothing", () => {
		expect(mapOf(".org $0200\nFOO = 7\nstart:\n; a comment\nnop\n")).toEqual([
			[0x0200, 1, 5],
		]);
	});

	test("reflects the converged pass, not an earlier wider guess", () => {
		// `lda FOO` is sized absolute on pass 1 and shrinks to zero page once
		// FOO resolves, so a stale map would claim 3 bytes and misplace `nop`.
		expect(mapOf(".org $0200\nlda FOO\nnop\nFOO = $10\n")).toEqual([
			[0x0200, 2, 2],
			[0x0202, 1, 3],
		]);
	});

	test("maps a macro body's bytes to the line that emitted them", () => {
		const src = [
			".org $0200",
			".macro twice",
			"nop",
			"nop",
			".endmacro",
			"twice",
			"rts",
		].join("\n");

		// Both bodies come from the macro's own lines, the call site from its.
		expect(mapOf(src)).toEqual([
			[0x0200, 1, 3],
			[0x0201, 1, 4],
			[0x0202, 1, 7],
		]);
	});

	test("names the module each run came from", async () => {
		const host = memHost({
			main: '.import "lib"\nrts\n',
			lib: "nop\n",
		});
		const result = await assemble("main", host);

		expect(result.diagnostics.map((d) => d.message)).toEqual([]);
		expect(result.sourceMap.map((e) => [e.file, e.address, e.line])).toEqual([
			["lib", 0x0000, 1],
			["main", 0x0001, 2],
		]);
	});

	test("an address resolves back to its line, mid-instruction included", () => {
		const result = assemble(".org $0200\nlda $1234\nrts\n", "t");
		const lineAt = (address: number) =>
			result.sourceMap.find(
				(e) => address >= e.address && address < e.address + e.length,
			)?.line;

		expect(lineAt(0x0200)).toBe(2);
		expect(lineAt(0x0202)).toBe(2); // the operand's high byte
		expect(lineAt(0x0203)).toBe(3);
		expect(lineAt(0x0204)).toBeUndefined();
	});
});
