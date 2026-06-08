import { describe, test, expect } from "vitest";
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

function asm(src: string): {
	bytes: number[];
	symbols: Map<string, bigint | string>;
	messages: string[];
} {
	const result = assemble(src, "t");
	return {
		bytes: [...result.output],
		symbols: result.symbols,
		messages: result.diagnostics.map((d) => d.message),
	};
}

describe("basics", () => {
	test("equates and .byte", () => {
		const { bytes, symbols, messages } = asm("FOO = $12\n.byte FOO\n");
		expect(messages).toEqual([]);
		expect(bytes).toEqual([0x12]);
		expect(symbols.get("FOO")).toBe(0x12n);
	});

	test(".org sets the location counter; labels capture it", () => {
		const { symbols, bytes } = asm(".org $0400\nhere:\n.byte 0\n");
		expect(symbols.get("here")).toBe(0x0400n);
		expect(bytes).toEqual([0x00]);
	});

	test(".byte mixes strings (UTF-8) and numbers", () => {
		expect(asm('.byte "AB", $0a, 65\n').bytes).toEqual([
			0x41, 0x42, 0x0a, 0x41,
		]);
	});
});

describe("multipass", () => {
	test("forward references resolve across passes", () => {
		const { bytes, symbols } = asm(".word later\nlater:\n");
		expect(symbols.get("later")).toBe(0x0002n);
		expect(bytes).toEqual([0x02, 0x00]);
	});

	test("a forward zero-page reference shrinks abs -> zp", () => {
		// Pass 1 sizes `lda FOO` as absolute (FOO unknown); once FOO resolves to
		// a zero-page value it shrinks to 2 bytes.
		expect(asm("lda FOO\nFOO = $50\n").bytes).toEqual([0xa5, 0x50]);
	});
});

describe("diagnostics", () => {
	test("duplicate definition", () => {
		expect(asm("FOO = 1\nFOO = 2\n").messages).toEqual([
			'Symbol "FOO" is already defined',
		]);
	});

	test("undefined symbol", () => {
		const { bytes, messages } = asm("lda undef\n");
		expect(messages).toEqual(['Undefined symbol "undef"']);
		expect(bytes).toEqual([0xad, 0, 0]); // placeholder at the pessimistic size
	});
});

describe("segments", () => {
	test("emit places a segment at the OUTPUT location", () => {
		const { bytes, symbols } = asm(
			'.define_segment "CODE"\n' +
				'.segment "OUTPUT"\n.org $0400\n.emit "CODE"\n' +
				'.segment "CODE"\nstart:\n\tjmp start\n',
		);
		expect(symbols.get("start")).toBe(0x0400n);
		expect(bytes).toEqual([0x4c, 0x00, 0x04]); // jmp $0400
	});

	test("OUTPUT can reference a label in a not-yet-emitted segment", () => {
		const { bytes, symbols } = asm(
			'.define_segment "CODE"\n' +
				'.segment "OUTPUT"\n.word start\n.org $0400\n.emit "CODE"\n' +
				'.segment "CODE"\nstart:\n\tnop\n',
		);
		expect(symbols.get("start")).toBe(0x0400n);
		expect(bytes).toEqual([0x00, 0x04, 0xea]); // .word start ($0400), then nop
	});

	test("emplace reserves address space without emitting bytes", () => {
		const { bytes, symbols } = asm(
			'.define_segment "BSS"\n.define_segment "CODE"\n' +
				'.segment "OUTPUT"\n.org $0200\n.emplace "BSS"\n.org $0400\n.emit "CODE"\n' +
				'.segment "BSS"\nbuf:\n\t.byte 0, 0, 0\n' +
				'.segment "CODE"\n\tlda buf\n',
		);
		expect(symbols.get("buf")).toBe(0x0200n); // got an address...
		expect(bytes).toEqual([0xad, 0x00, 0x02]); // ...but BSS emitted no file bytes
	});

	test("an unknown segment in .emit is reported", () => {
		const { messages } = asm('.segment "OUTPUT"\n.emit "NOPE"\n');
		expect(messages).toContain('Unknown segment "NOPE"');
	});

	test("a circular .emit is reported, not looped", () => {
		const { messages } = asm(
			'.define_segment "A"\n.define_segment "B"\n' +
				'.segment "OUTPUT"\n.emit "A"\n' +
				'.segment "A"\n.emit "B"\n' +
				'.segment "B"\n.emit "A"\n',
		);
		expect(messages).toContain('Circular .emit of segment "A"');
	});

	// The lib.s-inlined hello, exercising the whole engine: cross-segment refs
	// (vectors → CODE's `start`, `lda message` → RODATA), `.org`, emit/emplace.
	// OUTPUT emits CODE before RODATA, so start=$0400 and message follows the code.
	const HELLO_SEGMENTED = `EXIT := $0200
STDOUT := $0202

.define_segment "CODE"
.define_segment "RODATA"
.define_segment "DATA"
.define_segment "BSS"
.define_segment "ZEROPAGE"

.segment "OUTPUT"
\t.byte "SFOTTY", 0, 0, 0, 0
\t.word 0
\t.word start
\t.word 0
\t.org $0000
\t.emplace "ZEROPAGE"
\t.org $0400
\t.emit "CODE"
\t.emit "RODATA"
\t.emit "DATA"
\t.emplace "BSS"

.segment "RODATA"
message:
\t.byte "Hello world!", $0a, 0

.segment "CODE"
start:
\tldx #0
loop:
\tlda message,x
\tbeq end
\tsta STDOUT
\tinx
\tjmp loop
end:
\tsta EXIT
`;

	test("assembles the inlined-lib hello", () => {
		const { bytes, symbols, messages } = asm(HELLO_SEGMENTED);
		expect(messages).toEqual([]);
		// prettier-ignore
		expect(bytes).toEqual([
			0x53, 0x46, 0x4f, 0x54, 0x54, 0x59, 0x00, 0x00, 0x00, 0x00, // "SFOTTY" + padding
			0x00, 0x00,                                                 // NMI vector
			0x00, 0x04,                                                 // reset = start ($0400)
			0x00, 0x00,                                                 // IRQ vector
			0xa2, 0x00,                                                 // ldx #0
			0xbd, 0x11, 0x04,                                           // lda message,x ($0411)
			0xf0, 0x07,                                                 // beq end
			0x8d, 0x02, 0x02,                                           // sta STDOUT
			0xe8,                                                       // inx
			0x4c, 0x02, 0x04,                                           // jmp loop ($0402)
			0x8d, 0x00, 0x02,                                           // sta EXIT
			0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x77, 0x6f, 0x72, 0x6c, 0x64, 0x21, 0x0a, 0x00, // "Hello world!\n\0"
		]);
		expect(symbols.get("start")).toBe(0x0400n);
		expect(symbols.get("loop")).toBe(0x0402n);
		expect(symbols.get("end")).toBe(0x040en);
		expect(symbols.get("message")).toBe(0x0411n);
	});
});

describe("hello.s end to end", () => {
	// Inlined (not read from notes.local/) so the test is self-contained.
	const HELLO = `EXIT = $0200
STDOUT = $0202

; Header
.byte "SFOTTY", 0, 0, 0, 0

; Vectors
.word 0       ; NMI (unused)
.word start   ; reset / entry
.word 0       ; IRQ (unused)

.org $0400
message:
\t.byte "Hello world!", $0a, 0

start:
\tldx #0
loop:
\tlda message,x
\tbeq end
\tsta STDOUT
\tinx
\tjmp loop
end:
\tsta EXIT
`;

	test("assembles to the expected bytes", () => {
		const { bytes, symbols, messages } = asm(HELLO);
		expect(messages).toEqual([]);
		// prettier-ignore
		expect(bytes).toEqual([
			0x53, 0x46, 0x4f, 0x54, 0x54, 0x59, 0x00, 0x00, 0x00, 0x00, // "SFOTTY" + padding
			0x00, 0x00,                                                 // NMI vector
			0x0e, 0x04,                                                 // reset = start ($040E)
			0x00, 0x00,                                                 // IRQ vector
			0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x77, 0x6f, 0x72, 0x6c, 0x64, 0x21, 0x0a, 0x00, // "Hello world!\n\0"
			0xa2, 0x00,                                                 // ldx #0
			0xbd, 0x00, 0x04,                                           // lda message,x
			0xf0, 0x07,                                                 // beq end
			0x8d, 0x02, 0x02,                                           // sta STDOUT
			0xe8,                                                       // inx
			0x4c, 0x10, 0x04,                                           // jmp loop
			0x8d, 0x00, 0x02,                                           // sta EXIT
		]);
		expect(symbols.get("message")).toBe(0x0400n);
		expect(symbols.get("start")).toBe(0x040en);
		expect(symbols.get("loop")).toBe(0x0410n);
		expect(symbols.get("end")).toBe(0x041cn);
	});
});

describe("modules (flat merge)", () => {
	test("an imported module's symbols are visible", () => {
		const host = memHost({
			main: '.import "consts"\n.byte FOO\n',
			consts: "FOO = $42\n",
		});
		const r = assemble("main", host);
		expect(r.diagnostics.map((d) => d.message)).toEqual([]);
		expect([...r.output]).toEqual([0x42]);
	});

	test("a module shared by a diamond loads once", () => {
		const host = memHost({
			a: '.import "b"\n.import "c"\n',
			b: '.import "d"\n',
			c: '.import "d"\n',
			d: ".byte $11\n",
		});
		const r = assemble("a", host);
		expect(r.diagnostics.map((d) => d.message)).toEqual([]);
		expect([...r.output]).toEqual([0x11]); // d's byte once, not twice
	});

	test("an unreadable module is reported", () => {
		const r = assemble("main", memHost({ main: '.import "nope"\n' }));
		expect(r.diagnostics.map((d) => d.message)).toContain(
			'Cannot read module "nope"',
		);
	});

	test("an import cycle is reported, not looped", () => {
		const host = memHost({ a: '.import "b"\n', b: '.import "a"\n' });
		const r = assemble("a", host);
		expect(r.diagnostics.some((d) => d.message.includes("cycle"))).toBe(true);
	});
});
