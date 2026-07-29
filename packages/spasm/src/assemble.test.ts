import { describe, test, expect } from "vitest";
import { assemble } from "./assemble.ts";
import { Codes } from "./codes.ts";
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
	symbols: Map<string, import("./value.ts").Value>;
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
		const { bytes, symbols, messages } = asm(
			'.define_segment "BSS"\n.define_segment "CODE"\n' +
				'.segment "OUTPUT"\n.org $0200\n.emplace "BSS"\n.org $0400\n.emit "CODE"\n' +
				'.segment "BSS"\nbuf:\n\t.res 3\n' +
				'.segment "CODE"\n\tlda buf\n',
		);
		expect(messages).toEqual([]);
		expect(symbols.get("buf")).toBe(0x0200n); // got an address...
		expect(bytes).toEqual([0xad, 0x00, 0x02]); // ...but BSS emitted no file bytes
	});

	test("an unknown segment in .emit is reported", () => {
		const { messages } = asm('.segment "OUTPUT"\n.emit "NOPE"\n');
		expect(messages).toContain('Unknown segment "NOPE"');
	});

	test(".res reserves zero bytes", () => {
		expect(asm(".byte $11\n.res 3\n.byte $22\n").bytes).toEqual([
			0x11, 0, 0, 0, 0x22,
		]);
	});

	test("a branch across a *-relative fill gets the right offset", () => {
		// The fill size is render-resolved and fed back into collect's running
		// location, so the branch pc after the fill is correct.
		const { bytes, messages } = asm(
			'.define_segment "CODE"\n' +
				'.segment "OUTPUT"\n.org $0400\n.emit "CODE"\n' +
				'.segment "CODE"\nstart:\n\tlda #1\n\t.res $0410 - *\n\tbeq start\n',
		);
		expect(messages).toEqual([]);
		// lda #1, 14 fill bytes, then beq back: $0400 - ($0410 + 2) = -$12.
		expect(bytes).toHaveLength(18);
		expect(bytes.slice(-2)).toEqual([0xf0, 0xee]);
	});

	test("content past the fill boundary is an overflow error", () => {
		expect(asm(".org $10\n.byte 1, 2, 3\n.res $12 - *\n").messages).toContain(
			"`.res` count is negative - content overflows the fill boundary",
		);
	});

	test("a string .res count is a type error", () => {
		expect(asm('.res "x"\n').messages).toContain(
			"`.res` requires a numeric count",
		);
	});

	test("a *-relative .res fill in an emitted segment converges", () => {
		// Regression: the fill count reads the segment base, which is not a
		// symbol - with symbol-only convergence this exited after pass 1 with a
		// stale base-0 count (8K of garbage). Byte-stable convergence keeps
		// iterating until the fill settles.
		const { bytes, messages } = asm(
			'.define_segment "CODE"\n' +
				'.segment "OUTPUT"\n.org $1f00\n.emit "CODE"\n' +
				'.segment "CODE"\n\tlda #1\n\t.res $2000 - *\n\t.byte $aa\n',
		);
		expect(messages).toEqual([]);
		// 2 bytes of code at $1f00, fill to $2000, one sentinel byte.
		expect(bytes).toHaveLength(257);
		expect(bytes[bytes.length - 1]).toBe(0xaa);
	});

	test("a segment shorthand switches the current segment", () => {
		const { bytes, symbols } = asm(
			'.define_segment "CODE"\n.segment "OUTPUT"\n.org $0400\n.emit "CODE"\n' +
				".code\nstart:\n\tnop\n",
		);
		expect(symbols.get("start")).toBe(0x0400n);
		expect(bytes).toEqual([0xea]);
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

	test("placing a segment twice is reported", () => {
		const { messages } = asm(
			'.segment "OUTPUT"\n.org $0400\n.emit "A"\n.emit "A"\n' +
				'.segment "A"\n.byte 1\n',
		);
		expect(messages).toContain('Segment "A" is placed more than once');
	});

	test("an .emit after an .emplace of the same segment is also a double placement", () => {
		const { messages } = asm(
			'.segment "OUTPUT"\n.org $0400\n.emplace "A"\n.emit "A"\n' +
				'.segment "A"\n.byte 1\n',
		);
		expect(messages).toContain('Segment "A" is placed more than once');
	});

	test("a single placement stays clean", () => {
		const { messages } = asm(
			'.segment "OUTPUT"\n.org $0400\n.emit "A"\n.segment "A"\n.byte 1\n',
		);
		expect(messages).toEqual([]);
	});

	test("a defined but never-placed segment is reported", () => {
		const { messages } = asm('.define_segment "CODW"\n.byte 1\n');
		expect(messages).toEqual([
			'Segment "CODW" is never placed - `.emit`, `.emplace`, or `.discard` it',
		]);
	});

	test("a switched-to but never-placed segment is reported", () => {
		const { messages } = asm('.segment "A"\n.byte 1\n');
		expect(messages).toEqual([
			'Segment "A" is never placed - `.emit`, `.emplace`, or `.discard` it',
		]);
	});

	test(".discard satisfies the consumption check and drops the bytes", () => {
		const { bytes, messages } = asm(
			'.discard "A"\n.byte 9\n.segment "A"\n.byte 1\n',
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([9]); // A's content never reaches the file
	});

	test("a reference into a discarded segment errors, with an explanation", () => {
		const r = assemble(
			'.discard "A"\n.word entry\n.segment "A"\nentry: .byte 1\n',
			"t",
		);
		const error = r.diagnostics.find(
			(d) => d.message === 'Undefined symbol "entry"',
		)!;
		expect(error.notes?.map((n) => n.message)).toEqual([
			'Defined here, in discarded segment "A"',
			"Discarded here",
		]);
		expect(error.formatted).toContain(
			'note: Defined here, in discarded segment "A"',
		);
	});

	test("a cross-module reference into a discarded segment is explained too", async () => {
		const host = memHost({
			main: '.import "lib"\n.discard "SOUND"\n\tjsr sfx_beep\n',
			lib: '.export sfx_beep\n.segment "SOUND"\nsfx_beep:\n\trts\n',
		});
		const r = await assemble("main", host);
		const error = r.diagnostics.find(
			(d) => d.message === 'Undefined symbol "sfx_beep"',
		)!;
		expect(error.file).toBe("main");
		expect(error.notes?.map((n) => [n.message, n.file])).toEqual([
			['Defined here, in discarded segment "SOUND"', "lib"],
			["Discarded here", "main"],
		]);
		// The bare `.export sfx_beep` in lib gets the same explanation.
		const exportError = r.diagnostics.find(
			(d) => d.code === Codes.ExportNeverDefined,
		)!;
		expect(exportError.notes?.map((n) => n.message)).toEqual([
			'Defined here, in discarded segment "SOUND"',
			"Discarded here",
		]);
	});

	test("a namespaced reference into a discarded segment is explained", async () => {
		const host = memHost({
			main: 'snd = .import "lib"\n.discard "SOUND"\n\tjsr snd::sfx_beep\n',
			lib: '.export sfx_beep\n.segment "SOUND"\nsfx_beep:\n\trts\n',
		});
		const r = await assemble("main", host);
		const error = r.diagnostics.find(
			(d) => d.message === 'Undefined symbol "snd::sfx_beep"',
		)!;
		expect(error.notes?.map((n) => n.message)).toContain(
			'Defined here, in discarded segment "SOUND"',
		);
	});

	test("an unrelated undefined symbol with the same name is not annotated", async () => {
		const host = memHost({
			// main does NOT import lib's exports, so its `sfx_beep` cannot
			// resolve to the discarded label - no note.
			main: '.import "layout"\n\tjsr sfx_beep\n',
			layout: '.discard "SOUND"\n.segment "SOUND"\nsfx_beep_local:\n\trts\n',
		});
		const r = await assemble("main", host);
		const error = r.diagnostics.find(
			(d) => d.message === 'Undefined symbol "sfx_beep"',
		)!;
		expect(error.notes).toBeUndefined();
	});

	test("discarding an unknown segment is reported", () => {
		expect(asm('.discard "NOPE"\n.byte 1\n').messages).toEqual([
			'Unknown segment "NOPE"',
		]);
	});

	test("discarding a placed segment is contradictory", () => {
		const r = assemble(
			'.segment "OUTPUT"\n.emit "A"\n.discard "A"\n.segment "A"\n.byte 1\n',
			"t",
		);
		const error = r.diagnostics[0]!;
		expect(error.message).toBe('Segment "A" is discarded but also placed');
		expect(error.notes?.[0]?.message).toBe("Placed here");
	});

	test("a duplicate discard is reported with the first site", () => {
		const r = assemble(
			'.discard "A"\n.discard "A"\n.segment "A"\n.byte 1\n',
			"t",
		);
		const error = r.diagnostics[0]!;
		expect(error.message).toBe('Segment "A" is already discarded');
		expect(error.notes?.[0]?.message).toBe("First discarded here");
	});

	test("byte-emitting content in an emplaced segment is reported", () => {
		const { messages } = asm(
			'.segment "OUTPUT"\n.org $0200\n.emplace "BSS"\n' +
				'.segment "BSS"\nbuf: .res 3\n.byte 1\n\tnop\n',
		);
		expect(messages).toEqual([
			'Emplaced segment "BSS" contains byte-emitting content - only `.res` is allowed',
			'Emplaced segment "BSS" contains byte-emitting content - only `.res` is allowed',
		]);
	});

	test("the emplaced-content rule applies transitively", () => {
		const { messages } = asm(
			'.segment "OUTPUT"\n.org $0200\n.emplace "A"\n' +
				'.segment "A"\n.emplace "B"\n' +
				'.segment "B"\n.byte 1\n',
		);
		expect(messages).toEqual([
			'Emplaced segment "B" contains byte-emitting content - only `.res` is allowed',
		]);
	});

	test(".emit inside an emplaced segment is reported", () => {
		const { messages } = asm(
			'.segment "OUTPUT"\n.org $0200\n.emplace "A"\n' +
				'.segment "A"\n.emit "B"\n' +
				'.segment "B"\n.res 2\n',
		);
		expect(messages).toEqual([
			"Cannot `.emit` inside an emplaced segment - use `.emplace`",
		]);
	});

	// The lib.s-inlined hello, exercising the whole engine: cross-segment refs
	// (vectors -> CODE's `start`, `lda message` -> RODATA), `.org`, emit/emplace.
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

describe("modules", () => {
	test("an exported symbol is visible to a splat importer", async () => {
		const host = memHost({
			main: '.import "consts"\n.byte FOO\n',
			consts: ".export FOO = $42\n",
		});
		const r = await assemble("main", host);
		expect(r.diagnostics.map((d) => d.message)).toEqual([]);
		expect([...r.output]).toEqual([0x42]);
	});

	test("a non-exported symbol stays private", async () => {
		const host = memHost({
			main: '.import "consts"\n.byte FOO\n',
			consts: "FOO = $42\n", // not exported
		});
		const r = await assemble("main", host);
		expect(r.diagnostics.map((d) => d.message)).toContain(
			'Undefined symbol "FOO"',
		);
	});

	test("an exported macro is the entry-point channel (no globals)", async () => {
		const host = memHost({
			main: '.import "fmt"\nxex start\nstart:\n\tnop\n',
			fmt: ".export .macro xex entry\n\t.word entry\n.endmacro\n",
		});
		const r = await assemble("main", host);
		expect(r.diagnostics.map((d) => d.message)).toEqual([]);
		// The expanded .word emits start's address; start ($0002) follows it.
		expect([...r.output]).toEqual([0x02, 0x00, 0xea]);
	});

	test("a non-exported macro stays private to its module", async () => {
		const host = memHost({
			main: '.import "fmt"\nhidden\n',
			fmt: ".macro hidden\n\t.byte 1\n.endmacro\n",
		});
		const r = await assemble("main", host);
		expect(r.diagnostics.map((d) => d.message)).toContain(
			'Unknown mnemonic "hidden"',
		);
	});

	test("a macro body's free names bind where the macro is defined", async () => {
		const host = memHost({
			// lib's `secret` is private and not exported - the body still sees it,
			// and the caller's own `secret` neither collides nor leaks in.
			main: '.import "lib"\nsecret = 2\nput\n.byte secret\n',
			lib: "secret = 1\n.export .macro put\n\t.byte secret\n.endmacro\n",
		});
		const r = await assemble("main", host);
		expect(r.diagnostics.map((d) => d.message)).toEqual([]);
		expect([...r.output]).toEqual([0x01, 0x02]);
	});

	test("a body's macro calls resolve where the macro is defined", async () => {
		const host = memHost({
			main: '.import "lib"\nouter\n',
			lib: ".macro helper\n\t.byte 9\n.endmacro\n.export .macro outer\n\thelper\n.endmacro\n",
		});
		const r = await assemble("main", host);
		expect(r.diagnostics.map((d) => d.message)).toEqual([]);
		expect([...r.output]).toEqual([0x09]);
	});

	test("a body's macro calls inside .if arms resolve where the macro is defined", async () => {
		const host = memHost({
			main: '.import "lib"\nouter 1\n',
			lib: ".macro helper\n\t.byte 9\n.endmacro\n.export .macro outer flag\n\t.if flag\n\t\thelper\n\t.endif\n.endmacro\n",
		});
		const r = await assemble("main", host);
		expect(r.diagnostics.map((d) => d.message)).toEqual([]);
		expect([...r.output]).toEqual([0x09]);
	});

	test("a module shared by a diamond loads once", async () => {
		const host = memHost({
			a: '.import "b"\n.import "c"\n',
			b: '.import "d"\n',
			c: '.import "d"\n',
			d: ".byte $11\n",
		});
		const r = await assemble("a", host);
		expect(r.diagnostics.map((d) => d.message)).toEqual([]);
		expect([...r.output]).toEqual([0x11]); // d's byte once, not twice
	});

	test("an unreadable module is reported", async () => {
		const r = await assemble("main", memHost({ main: '.import "nope"\n' }));
		expect(r.diagnostics.map((d) => d.message)).toContain(
			'Cannot read module "nope"',
		);
	});

	test("an import cycle is reported, not looped", async () => {
		const host = memHost({ a: '.import "b"\n', b: '.import "a"\n' });
		const r = await assemble("a", host);
		expect(r.diagnostics.some((d) => d.message.includes("cycle"))).toBe(true);
	});

	// The capstone: hello split into a program module + an imported system
	// module (lib). Exercises splat import (STDOUT/EXIT), `.export`, the
	// exported format macro as the entry-point channel, and segments defined by
	// the macro while CODE/RODATA are filled by the program. Same 47 bytes as
	// the single-file inlined golden.
	const LIB = `.export EXIT := $0200
.export STDOUT := $0202
.export .macro output_sfotty_exe start
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
.endmacro
`;
	const HELLO = `.import "./lib.s"
output_sfotty_exe start
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

	test("two-file hello assembles across modules", async () => {
		const host = memHost({ "hello.s": HELLO, "./lib.s": LIB });
		const r = await assemble("hello.s", host);
		expect(r.diagnostics.map((d) => d.message)).toEqual([]);
		// prettier-ignore
		expect([...r.output]).toEqual([
			0x53, 0x46, 0x4f, 0x54, 0x54, 0x59, 0x00, 0x00, 0x00, 0x00, // "SFOTTY" + padding
			0x00, 0x00,                                                 // NMI
			0x00, 0x04,                                                 // reset = start ($0400)
			0x00, 0x00,                                                 // IRQ
			0xa2, 0x00,                                                 // ldx #0
			0xbd, 0x11, 0x04,                                           // lda message,x ($0411)
			0xf0, 0x07,                                                 // beq end
			0x8d, 0x02, 0x02,                                           // sta STDOUT
			0xe8,                                                       // inx
			0x4c, 0x02, 0x04,                                           // jmp loop ($0402)
			0x8d, 0x00, 0x02,                                           // sta EXIT
			0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x77, 0x6f, 0x72, 0x6c, 0x64, 0x21, 0x0a, 0x00, // "Hello world!\n\0"
		]);
		expect(r.symbols.get("start")).toBe(0x0400n);
		expect(r.symbols.get("message")).toBe(0x0411n);
	});
});

describe("anonymous labels", () => {
	test(":+ is the next one, :- the previous", () => {
		const { bytes, messages } = asm(
			".org $2000\n\tbne :+\n\tlda #0\n:\n\tsta $600\n\tjmp :-\n",
		);
		expect(messages).toEqual([]);
		// The branch skips `lda #0` to the label; the jump goes back to it.
		expect(bytes).toEqual([
			0xd0, 0x02, 0xa9, 0x00, 0x8d, 0x00, 0x06, 0x4c, 0x04, 0x20,
		]);
	});

	test("repeated signs count further out", () => {
		const { bytes, messages } = asm(
			".org $2000\n\tbne :++\n\tnop\n:\n\tnop\n:\n\tnop\n\tjmp :--\n\tjmp :-\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([
			0xd0, 0x02, 0xea, 0xea, 0xea, 0x4c, 0x03, 0x20, 0x4c, 0x04, 0x20,
		]);
	});

	test("a label on the same statement counts as previous", () => {
		expect(asm(".org $2000\n: jmp :-\n").bytes).toEqual([0x4c, 0x00, 0x20]);
	});

	test("`bne :+` is an instruction, not a label named bne", () => {
		// The colon binds rightwards when a sign hugs it; nothing else could
		// follow a label's colon that way.
		const { bytes, messages } = asm(".org $2000\n\tbne :+\n\tnop\n:\n\trts\n");
		expect(messages).toEqual([]);
		expect(bytes).toEqual([0xd0, 0x01, 0xea, 0x60]);
	});

	test("a keyed entry with a signed value is untouched", () => {
		// `key: -1` must stay a key and a negative value: the entry rule eats
		// the colon, so the reference syntax never sees it.
		expect(asm("N = { A1: -1, B: +2 }\n.byte <N::A1, N::B\n").bytes).toEqual([
			0xff, 0x02,
		]);
		expect(asm("L := $1234, size: -1\n.byte <L\n").messages).toEqual([]);
	});

	test("out-of-range references say so", () => {
		expect(asm(".org $2000\n\tjmp :+\n").messages).toContain(
			"There is no anonymous label after this point",
		);
		expect(asm(".org $2000\n:\n\tjmp :--\n").messages).toContain(
			"There is no second anonymous label before this point",
		);
	});

	test("a macro body is its own numbering context", () => {
		// The body's `:+` finds the body's own label, per expansion, and the
		// caller's `:-` skips past both expansions to the caller's own.
		const { bytes, messages } = asm(
			".org $2000\n.macro hop\n\tbne :+\n\tnop\n:\n.endmacro\n:\nhop\nhop\n\tjmp :-\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([
			0xd0, 0x01, 0xea, 0xd0, 0x01, 0xea, 0x4c, 0x00, 0x20,
		]);
	});
});

describe("local labels", () => {
	test("two scopes may reuse a local name", () => {
		const { bytes, symbols, messages } = asm(
			".org $2000\n" +
				"read_word:\n\tbcc @eof\n@eof:\n\trts\n" +
				"fill_buffer:\n\tbeq @eof\n@eof:\n\trts\n",
		);
		expect(messages).toEqual([]);
		expect(symbols.get("read_word@eof")).toBe(0x2002n);
		expect(symbols.get("fill_buffer@eof")).toBe(0x2005n);
		// Each branch reaches its own scope's `@eof`, one byte ahead.
		expect(bytes).toEqual([0x90, 0x00, 0x60, 0xf0, 0x00, 0x60]);
	});

	test("a local resolves in either direction within its scope", () => {
		const { symbols, messages } = asm(
			".org $2000\nfoo:\n\tjmp @fwd\n@back:\n\tnop\n@fwd:\n\tjmp @back\n",
		);
		expect(messages).toEqual([]);
		expect(symbols.get("foo@back")).toBe(0x2003n);
		expect(symbols.get("foo@fwd")).toBe(0x2004n);
	});

	test("a reference outside its scope is undefined, and reads as written", () => {
		// The qualified form is unspellable, so this can't silently reach
		// another scope's label - and the message shows the source spelling.
		expect(asm("foo:\n@loop:\n\trts\nbar:\n\tjmp @loop\n").messages).toContain(
			'Undefined symbol "@loop"',
		);
	});

	test("locals before any label get a module-initial scope", () => {
		const { symbols, messages } = asm(
			".org $2000\n@start:\n\tjmp @start\nfoo:\n@start:\n\trts\n",
		);
		expect(messages).toEqual([]);
		expect(symbols.get("@@start")).toBe(0x2000n);
		expect(symbols.get("foo@start")).toBe(0x2003n);
	});

	test("`.export name:` opens a scope", () => {
		const { symbols, messages } = asm(
			".org $2000\n.export entry:\n@loop:\n\tjmp @loop\n",
		);
		expect(messages).toEqual([]);
		expect(symbols.get("entry@loop")).toBe(0x2000n);
	});

	test("a local cannot be exported", () => {
		expect(asm("foo:\n.export @loop:\n\trts\n").messages).toContain(
			'Local label "@loop" is private to its scope and cannot be exported',
		);
	});

	test("an `.if` arm belongs to the scope in effect at the `.if`", () => {
		// Arms neither open nor close a scope, so which arm wins can never
		// change what a local label means.
		const { bytes, messages } = asm(
			".org $2000\nfoo:\n@target:\n.if 1\n\tjmp @target\n.else\n\tnop\n.endif\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([0x4c, 0x00, 0x20]);
	});

	test("a macro body's locals are per-expansion, not the caller's", () => {
		// Macro hygiene already renames body-defined names per expansion, so
		// the local-label pass leaves bodies alone.
		const { bytes, messages } = asm(
			".org $2000\n.macro hop\n@skip:\n\tjmp @skip\n.endmacro\nfoo:\nhop\nhop\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([0x4c, 0x00, 0x20, 0x4c, 0x03, 0x20]);
	});

	test("a macro body cannot capture the caller's local", () => {
		const { messages } = asm(
			".macro hop\n\tjmp @skip\n.endmacro\nfoo:\n@skip:\n\thop\n",
		);
		expect(messages.join("\n")).toContain("@skip");
		expect(messages).not.toEqual([]);
	});
});

describe("macros", () => {
	test("expands a call, substituting the parameter", () => {
		const { bytes } = asm(
			".macro twice v\n\t.byte v, v\n.endmacro\ntwice $42\ntwice $43\n",
		);
		expect(bytes).toEqual([0x42, 0x42, 0x43, 0x43]);
	});

	test("body-local labels are unique per expansion", () => {
		const { bytes } = asm(
			".macro lbl\nloc:\n\t.byte <loc, >loc\n.endmacro\n.org $0300\nlbl\nlbl\n",
		);
		// loc is $0300 in the first expansion, $0302 in the second.
		expect(bytes).toEqual([0x00, 0x03, 0x02, 0x03]);
	});

	test("a switching macro emits into another segment (the mprint pattern)", () => {
		const { bytes, symbols } = asm(
			'.define_segment "CODE"\n.define_segment "RODATA"\n' +
				".macro mprint s\n\t.rodata\nmsg:\n\t.byte s, 0\n\t.code\n\tlda #<msg\n.endmacro\n" +
				'.segment "OUTPUT"\n.org $0400\n.emit "CODE"\n.emit "RODATA"\n' +
				'.segment "CODE"\nstart:\n\tmprint "hi"\n',
		);
		expect(symbols.get("start")).toBe(0x0400n);
		// CODE: lda #<msg (2 bytes) -> msg lands at $0402 in RODATA.
		expect(bytes).toEqual([0xa9, 0x02, 0x68, 0x69, 0x00]);
	});

	test("an argument-count mismatch is reported", () => {
		expect(asm(".macro one v\n\t.byte v\n.endmacro\none\n").messages).toContain(
			'Macro "one" is missing the argument "v"',
		);
	});

	test("multi-argument call passes whole operands (the mva pattern)", () => {
		const { bytes, messages } = asm(
			"ptr = $20\ndst = $22\n" +
				".macro mva src, dest\n\tlda src\n\tsta dest\n.endmacro\n" +
				"mva (ptr),y, (dst),y\n",
		);
		expect(messages).toEqual([]);
		// lda (ptr),y / sta (dst),y - the ",y" shape survives substitution.
		expect(bytes).toEqual([0xb1, 0x20, 0x91, 0x22]);
	});

	test("a nested call inside a .if arm expands (the mwa/sta_hi pattern)", () => {
		const src = (flag: number) =>
			".macro inner\n\tnop\n.endmacro\n" +
			".macro outer flag\n\t.if flag\n\t\tinner\n\t.else\n\t\tbrk\n\t.endif\n.endmacro\n" +
			`outer ${flag}\n`;
		expect(asm(src(1)).messages).toEqual([]);
		expect(asm(src(1)).bytes).toEqual([0xea]);
		expect(asm(src(0)).bytes).toEqual([0x00]);
	});

	test("multi-argument call with plain expressions", () => {
		const { bytes, messages } = asm(
			".macro pair lo, hi\n\t.byte lo, hi\n.endmacro\npair 1, 2\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([1, 2]);
	});

	test("an immediate argument splices as a whole operand", () => {
		const { bytes, messages } = asm(
			".macro put v\n\tlda v\n.endmacro\nput #$42\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([0xa9, 0x42]);
	});

	test("a shaped operand argument in expression position is an operand value", () => {
		// Previously an error; now the value is introspectable - and using it
		// as data stays an error, with an unwrap hint.
		expect(
			asm(".macro bad v\n\t.byte v\n.endmacro\nbad (foo),y\nfoo = 1\n")
				.messages,
		).toContain("An operand is not data - unwrap it with `.operand_value()`");
	});

	test("a real instruction rejects an operand list", () => {
		expect(asm("lda 1, 2\n").messages).toContain("Too many operands for LDA");
	});

	test("an .out param defines a caller-visible symbol", () => {
		const { bytes, symbols, messages } = asm(
			".macro alloc .out name\nname: .res 1\n.endmacro\n.org $10\nalloc buffer\n.byte <buffer\n",
		);
		expect(messages).toEqual([]);
		expect(symbols.get("buffer")).toBe(0x10n);
		expect(bytes).toEqual([0x00, 0x10]);
	});

	test("a non-identifier .out argument is rejected at the call", () => {
		expect(
			asm(".macro alloc .out name\nname: .res 1\n.endmacro\nalloc 1+2\n")
				.messages,
		).toContain(
			'Argument for `.out` parameter "name" must be a plain identifier',
		);
	});

	test("an .out param the body never defines is an error", () => {
		expect(asm(".macro bad .out v\n\tnop\n.endmacro\n").messages).toContain(
			'`.out` parameter "v" is never defined in the macro body',
		);
	});

	test("a plain param defined by the body demands .out", () => {
		expect(asm(".macro bad v\nv = 1\n.endmacro\n").messages).toContain(
			'Parameter "v" is defined in the macro body - declare it `.out`',
		);
	});

	test("forwarding to a nested .out position satisfies and demands .out", () => {
		const { bytes, messages } = asm(
			".macro inner .out n\nn = 7\n.endmacro\n" +
				".macro outer .out m\n\tinner m\n.endmacro\n" +
				"outer foo\n.byte foo\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([7]);
		// The flip side: a plain param forwarded to an .out position is an error.
		expect(
			asm(
				".macro inner .out n\nn = 7\n.endmacro\n" +
					".macro outer m\n\tinner m\n.endmacro\nouter foo\n",
			).messages,
		).toContain(
			'Parameter "m" is defined in the macro body - declare it `.out`',
		);
	});

	test("an unused macro's free names are checked at the definition site", () => {
		expect(asm(".macro bad\n\t.byte nope\n.endmacro\n").messages).toContain(
			'Undefined symbol "nope" in macro "bad"',
		);
	});

	test("an unused macro referencing defined names is fine", () => {
		expect(
			asm("FOO = 1\n.macro fine\n\t.byte FOO\n.endmacro\n").messages,
		).toEqual([]);
	});

	test("module-level directives are rejected inside a body", () => {
		expect(asm('.macro bad\n.import "x"\n.endmacro\n').messages).toContain(
			"`.import` is not allowed inside a macro body",
		);
	});
});

describe("namespaces (dict-valued symbols)", () => {
	test("entries resolve via ::", () => {
		const { bytes, symbols, messages } = asm(
			"N = { V: 1, B: 2 }\n.byte N::V, N::B\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([1, 2]);
		// The symbol map holds the dictionary whole, not flattened entries.
		expect(symbols.get("N")).toEqual({
			type: "dict",
			entries: new Map([
				["V", 1n],
				["B", 2n],
			]),
		});
	});

	test("multiline literal: newline separators, comments, trailing comma", () => {
		const { bytes, messages } = asm(
			"HATABS_OFFSET = {\n" +
				"\tOPEN: 0 ; open vector\n" +
				"\tCLOSE: 2\n" +
				"\tGET_BYTE: 4, PUT_BYTE: 6,\n" +
				"}\n" +
				".byte HATABS_OFFSET::PUT_BYTE\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([6]);
	});

	test("nested dictionaries chain with ::", () => {
		const { bytes, messages } = asm("N = { M: { W: 5 } }\n.byte N::M::W\n");
		expect(messages).toEqual([]);
		expect(bytes).toEqual([5]);
	});

	test("entry values may forward-reference (multipass)", () => {
		const { bytes, messages } = asm(
			"N = { V: LATER }\nLATER = 7\n.byte N::V\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([7]);
	});

	test("a missing key is a hard error, not an undefined symbol", () => {
		// Keys are statically known, so this can never resolve on a later pass.
		expect(asm("N = { V: 1 }\n.byte N::NOPE\n").messages).toContain(
			'Dictionary "N" has no entry "NOPE"',
		);
	});

	test("a key that exists but hasn't resolved is still 'undefined'", () => {
		expect(asm("N = { V: NEVER }\n.byte N::V\n").messages).toContain(
			'Undefined symbol "N::V"',
		);
	});

	test("indexing a non-dictionary reports what it is", () => {
		expect(asm("K = 5\n.byte K::V\n").messages).toContain(
			'"K" is not a dictionary',
		);
	});

	test("duplicate keys error", () => {
		expect(asm("N = { V: 1, V: 2 }\n").messages).toContain(
			'Duplicate dictionary key "V"',
		);
	});

	test("the root name is define-once too", () => {
		expect(asm("N = { V: 1 }\nN = 2\n").messages).toContain(
			'Symbol "N" is already defined',
		);
	});

	test("a dictionary is a value, but not data", () => {
		expect(asm(".byte { V: 1 }\n").messages).toContain(
			"A dictionary is not data - select an entry with `::`",
		);
		expect(asm("N = { V: 1 }\n.byte N\n").messages).toContain(
			"A dictionary is not data - select an entry with `::`",
		);
	});

	test("a dictionary can be aliased", () => {
		const { bytes, messages } = asm(
			"N = { V: 1, M: { W: 5 } }\nA1 = N\n.byte A1::V, A1::M::W\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([1, 5]);
	});

	test("an entry may read a sibling through the root", () => {
		// Legal, and the fixpoint settles it in either order.
		expect(
			asm("N = { foo: 1, bar: N::foo + 1 }\n.byte N::bar\n").bytes,
		).toEqual([2]);
		expect(
			asm("N = { bar: N::foo + 1, foo: 1 }\n.byte N::bar\n").bytes,
		).toEqual([2]);
	});

	test("a dictionary may not contain itself", () => {
		// Bare `N` inside `N`'s own literal would nest a level deeper each pass.
		expect(asm("N = { A1: N }\n").messages[0]).toContain(
			"A dictionary cannot contain itself",
		);
		expect(asm("N = { A1: { B: N } }\n").messages[0]).toContain(
			"A dictionary cannot contain itself",
		);
	});

	test("an unresolved entry doesn't stop the parent from being a value", () => {
		// `N` is a perfectly good dictionary; only `V` is missing.
		const { messages } = asm("N = { V: NEVER }\nA1 = N\n.byte A1::V\n");
		expect(messages).toEqual([
			'Undefined symbol "NEVER"',
			'Undefined symbol "A1::V"',
		]);
	});

	test("a change in flight inside a dictionary still converges", () => {
		// Each hop through a dictionary costs a pass, and in the intermediate
		// pass the dictionary is the only thing that changed - bytes and scalars
		// are both stable. Convergence has to notice it anyway.
		const { bytes, messages } = asm(
			".byte M\nM = N::A1\nN = { A1: LATER }\nLATER = 7\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([7]);
	});

	test(":= rejects a dictionary", () => {
		expect(asm("N := { V: 1 }\n").messages).toContain(
			"A dictionary is a value, not an address - define it with `=`",
		);
	});

	test("an exported dictionary's entries resolve through the import", async () => {
		const host = memHost({
			main: '.import "lib"\n.byte N::V\n',
			lib: ".export N = { V: 9 }\n",
		});
		const r = await assemble("main", host);
		expect(r.diagnostics.map((d) => d.message)).toEqual([]);
		expect([...r.output]).toEqual([9]);
	});

	test("a path chains through a namespaced import into a dictionary", async () => {
		// The trickiest resolution path: `lib` is a namespace binding rather than
		// a value, so it spends the first key reaching the export, and the rest
		// is ordinary value indexing.
		const host = memHost({
			main: 'lib = .import "lib"\n.byte lib::Config::HEIGHT, lib::Config::W::X1\n',
			lib: ".export Config = { HEIGHT: 24, W: { X1: 40 } }\n",
		});
		const r = await assemble("main", host);
		expect(r.diagnostics.map((d) => d.message)).toEqual([]);
		expect([...r.output]).toEqual([24, 40]);
	});

	test("a missing key through an import names the right prefix", async () => {
		const host = memHost({
			main: 'lib = .import "lib"\n.byte lib::Config::NOPE\n',
			lib: ".export Config = { HEIGHT: 24 }\n",
		});
		const r = await assemble("main", host);
		expect(r.diagnostics.map((d) => d.message)).toContain(
			'Dictionary "lib::Config" has no entry "NOPE"',
		);
	});

	test("namespace references in macro bodies are hygienic", async () => {
		const host = memHost({
			// lib's N is private; the body still binds it, and the caller's own N
			// neither collides nor leaks in.
			main: '.import "lib"\nN = { V: 2 }\nput\n.byte N::V\n',
			lib: "N = { V: 1 }\n.export .macro put\n\t.byte N::V\n.endmacro\n",
		});
		const r = await assemble("main", host);
		expect(r.diagnostics.map((d) => d.message)).toEqual([]);
		expect([...r.output]).toEqual([1, 2]);
	});

	test("a namespace passes through a macro parameter", () => {
		const { bytes, messages } = asm(
			"NOTES = { C4: 60, E4: 64 }\n" +
				".macro play n\n\t.byte n::E4\n.endmacro\nplay NOTES\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([64]);
	});
});

describe("namespaced imports", () => {
	test("binds the module's exports: symbols, dicts, and macros", async () => {
		const host = memHost({
			main: 'lib = .import "lib"\nlib::put 5\n.byte lib::FOO, lib::N::V\n',
			lib:
				".export FOO = 7\n.export N = { V: 3 }\n" +
				".export .macro put v\n\t.byte v\n.endmacro\n",
		});
		const r = await assemble("main", host);
		expect(r.diagnostics.map((d) => d.message)).toEqual([]);
		expect([...r.output]).toEqual([5, 7, 3]);
	});

	test("non-exported symbols stay hidden behind a binding", async () => {
		const host = memHost({
			main: 'lib = .import "lib"\n.byte lib::SECRET\n',
			lib: "SECRET = 1\n.export FOO = 7\n",
		});
		const r = await assemble("main", host);
		expect(r.diagnostics.map((d) => d.message)).toContain(
			'Undefined symbol "lib::SECRET"',
		);
	});

	test("a non-exported macro is unknown through a binding", async () => {
		const host = memHost({
			main: 'lib = .import "lib"\nlib::hidden\n',
			lib: ".macro hidden\n\t.byte 1\n.endmacro\n",
		});
		const r = await assemble("main", host);
		expect(r.diagnostics.map((d) => d.message)).toContain(
			'Unknown macro "lib::hidden"',
		);
	});

	test("names don't splat-leak from a namespaced import", async () => {
		const host = memHost({
			main: 'lib = .import "lib"\n.byte FOO\n',
			lib: ".export FOO = 7\n",
		});
		const r = await assemble("main", host);
		expect(r.diagnostics.map((d) => d.message)).toContain(
			'Undefined symbol "FOO"',
		);
	});

	test("the binding name is define-once", async () => {
		const host = memHost({
			main: 'lib = .import "lib"\nlib = 5\n',
			lib: ".export FOO = 7\n",
		});
		const r = await assemble("main", host);
		expect(r.diagnostics.map((d) => d.message)).toContain(
			'Symbol "lib" is already defined',
		);
	});

	test("a body's namespaced references resolve in the defining module", async () => {
		const host = memHost({
			main: '.import "liba"\nouter\n',
			liba:
				'libb = .import "libb"\n' +
				".export .macro outer\n\tlibb::inner\n\t.byte libb::VAL\n.endmacro\n",
			libb: ".export VAL = 4\n.export .macro inner\n\t.byte 9\n.endmacro\n",
		});
		const r = await assemble("main", host);
		expect(r.diagnostics.map((d) => d.message)).toEqual([]);
		expect([...r.output]).toEqual([9, 4]);
	});
});

// Attribute semantics are deferred until the address-vs-number value split
// lands, so the tail is checked for shape and discarded. These tests pin the
// shape rules (which survive any future semantics) and the discarding itself.
describe("placement attributes (parsed, then discarded)", () => {
	test("a declared attribute is accepted and has no effect", () => {
		const { bytes, messages, symbols } = asm(
			"BUF := $0600, size: 3\n.byte <BUF\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([0x00]);
		expect(symbols.get("BUF")).toBe(0x0600n);
	});

	test("the value is never evaluated", () => {
		// Nonsense a live `size:` would have rejected: a string, a negative, and
		// a name that is never defined anywhere.
		expect(asm('B := 1, size: "x"\n').messages).toEqual([]);
		expect(asm("B := 1, size: -1\n").messages).toEqual([]);
		expect(asm("B := 1, size: NEVER_DEFINED\n").messages).toEqual([]);
	});

	test("only `:=` definitions may carry a tail", () => {
		expect(asm("K = 5, size: 2\n").messages).toContain(
			"Only labels have attributes - use `:=` for an address",
		);
	});

	test("unknown keys are rejected, so adding keys later stays additive", () => {
		expect(asm("B := 1, foo: 2\n").messages).toContain(
			'Unknown attribute "foo"',
		);
	});

	test("a key may be given only once", () => {
		expect(asm("B := 1, size: 2, size: 3\n").messages).toContain(
			'Attribute "size" is already set',
		);
	});

	test("a tail survives export and namespaced import", async () => {
		const host = memHost({
			main: 'lib = .import "lib"\n.import "lib"\n.byte <BUF, <lib::BUF\n',
			lib: ".export BUF := $0600, size: 3\n",
		});
		const r = await assemble("main", host);
		expect(r.diagnostics.map((d) => d.message)).toEqual([]);
		expect([...r.output]).toEqual([0x00, 0x00]);
	});
});

describe("expression macros (function-valued symbols)", () => {
	test("definition and application", () => {
		const { bytes, messages } = asm(
			"DOUBLE(v) = 2 * v\n.byte DOUBLE(3), DOUBLE(DOUBLE(2))\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([6, 8]);
	});

	test("multiple parameters", () => {
		const { bytes, messages } = asm(
			"NIBBLES(hi, lo) = hi * 16 + lo\n.byte NIBBLES(2, 5)\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([0x25]);
	});

	test("aliasing: a function is a value", () => {
		const { bytes, messages } = asm(
			"DOUBLE(v) = 2 * v\nD = DOUBLE\n.byte D(4)\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([8]);
	});

	test("forward reference to a function resolves via the multipass", () => {
		const { bytes, messages } = asm(".byte D(1)\nD(v) = v + 9\n");
		expect(messages).toEqual([]);
		expect(bytes).toEqual([10]);
	});

	test("arity and non-function calls are errors", () => {
		expect(asm("DOUBLE(v) = 2 * v\n.byte DOUBLE(1, 2)\n").messages).toContain(
			'"DOUBLE" expects 1 argument(s), got 2',
		);
		expect(asm("K = 5\n.byte K(2)\n").messages).toContain(
			'"K" is not a function',
		);
	});

	test("a function is not data or an operand", () => {
		expect(asm("D(v) = v\n.byte D\n").messages).toContain(
			"A function is not data - apply it with `(...)`",
		);
		expect(asm("D(v) = v\n\tlda D\n").messages).toContain(
			"Operand must be a number, not a function",
		);
	});

	test("runaway recursion hits the depth cap", () => {
		expect(asm("R(v) = R(v)\n.byte R(1)\n").messages).toContain(
			"Expression macro application too deep (recursion?)",
		);
	});

	test("body free names bind in the defining module", async () => {
		const host = memHost({
			// lib's SCALE is private; the exported function still sees it, and the
			// caller's own SCALE neither collides nor leaks in.
			main: '.import "lib"\nSCALE = 100\n.byte TIMES(3), SCALE\n',
			lib: "SCALE = 4\n.export TIMES(v) = SCALE * v\n",
		});
		const r = await assemble("main", host);
		expect(r.diagnostics.map((d) => d.message)).toEqual([]);
		expect([...r.output]).toEqual([12, 100]);
	});

	test("functions apply through namespaced imports", async () => {
		const host = memHost({
			main: 'lib = .import "lib"\n.byte lib::TIMES(5)\n',
			lib: "SCALE = 4\n.export TIMES(v) = SCALE * v\n",
		});
		const r = await assemble("main", host);
		expect(r.diagnostics.map((d) => d.message)).toEqual([]);
		expect([...r.output]).toEqual([20]);
	});

	test("function params shadow code-macro substitution", () => {
		// The macro param `v` and the function param `v` collide: the function
		// body's `v` must stay the function's own (F(1) = 2), while the call
		// argument `v` IS macro-substituted (F(5) = 10). The function itself is
		// body-local (hygiene renames it), used inside the body.
		const { bytes, messages } = asm(
			".macro emitdouble v\nF(v) = v * 2\n\t.byte F(1), F(v)\n.endmacro\nemitdouble 5\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([2, 10]);
	});
});

describe("bitwise xor", () => {
	test("^ evaluates at multiplicative precedence", () => {
		expect(asm(".byte 5 ^ 3, 1 + 2 ^ 2\n").bytes).toEqual([6, 1]);
	});
});

describe("line continuation", () => {
	test("statements continue across a backslash-newline", () => {
		const { bytes, messages } = asm(".byte 1, \\\n\t2, 3\nlda \\\n\t#5\n");
		expect(messages).toEqual([]);
		expect(bytes).toEqual([1, 2, 3, 0xa9, 5]);
	});
});

describe("bitwise operators", () => {
	test("and, or, not", () => {
		expect(asm(".byte $F0 & $3C, $0C | $30, ~0 & $FF\n").bytes).toEqual([
			0x30, 0x3c, 0xff,
		]);
	});

	test("~ in an immediate encodes the complement by arithmetic", () => {
		// ~$0C = -$0D as an unbounded integer; the byte truncation yields $F3.
		expect(asm("MASK = $0C\n\tand #~MASK\n").bytes).toEqual([0x29, 0xf3]);
	});

	test("shifts, at multiplicative precedence", () => {
		expect(asm(".byte 1 << 4, $80 >> 3\n").bytes).toEqual([16, 16]);
		// & and << bind tighter than |; | sits with + -.
		expect(asm(".word 1 << 8 | 2, 1 | 2 & 2\n").bytes).toEqual([
			0x02, 0x01, 0x03, 0x00,
		]);
	});

	test("a negative shift count is an error", () => {
		expect(asm(".byte 1 << (0 - 1)\n").messages).toContain(
			"Shift count must not be negative",
		);
	});
});

describe("diagnostics with locations", () => {
	test("errors carry their module and a formatted file:line:col", async () => {
		const host = memHost({
			main: '.import "lib"\n.byte OK\n',
			lib: ".export OK = 1\n.byte NOPE\n",
		});
		const r = await assemble("main", host);
		const error = r.diagnostics.find((d) => d.message.includes("NOPE"))!;
		expect(error.file).toBe("lib");
		expect(error.formatted).toMatch(
			/^lib:2:7 - error SP2001: Undefined symbol "NOPE"/,
		);
		// The excerpt shows a line-number gutter and squiggles under the span.
		expect(error.formatted).toContain("\n\n2 .byte NOPE\n");
		expect(error.formatted).toMatch(/\n {8}~{4}$/);
		// The colored twin carries ANSI codes.
		expect(error.formattedColor).toContain("\x1b[36mlib\x1b[0m");
		expect(error.formattedColor).toContain("\x1b[31merror SP2001\x1b[0m");
	});

	test("an error inside a macro body points into the macro's file", async () => {
		const host = memHost({
			main: '.import "lib"\nput\n',
			lib: ".export .macro put\n\t.byte MISSING\n.endmacro\n",
		});
		const r = await assemble("main", host);
		const error = r.diagnostics.find((d) => d.message.includes("MISSING"))!;
		// The span is a body token: hygiene's origin doubles as the file.
		expect(error.file).toBe("lib");
		expect(error.formatted).toMatch(
			/^lib:2:8 - error SP2001: Undefined symbol/,
		);
	});

	test("parse errors are attributed to their module", async () => {
		const host = memHost({
			main: '.import "lib"\nnop\n',
			lib: ".segment\n",
		});
		const r = await assemble("main", host);
		const error = r.diagnostics[0]!;
		expect(error.file).toBe("lib");
		expect(error.formatted).toMatch(/^lib:1:\d+ - error SP1001: /);
	});

	test("single-source diagnostics use the given name", () => {
		const { messages } = asm("lda undef\n");
		expect(messages).toEqual(['Undefined symbol "undef"']);
		const r = assemble("lda undef\n", "prog.s");
		expect(r.diagnostics[0]!.formatted).toMatch(
			/^prog\.s:1:5 - error SP2001: /,
		);
	});

	test("a host shortName shortens the printed path, not the id", async () => {
		const host: Host = {
			resolve: (specifier) => specifier,
			read: () => "lda undef\n",
			shortName: (id) => id.split("/").pop()!,
		};
		const r = await assemble("/deep/path/main.s", host);
		const error = r.diagnostics[0]!;
		// The module id stays canonical; only the formatted rendering shortens.
		expect(error.file).toBe("/deep/path/main.s");
		expect(error.formatted).toMatch(/^main\.s:1:5 - error SP2001: /);
	});
});

describe("diagnostic codes", () => {
	test("every diagnostic carries a stable code", () => {
		const r = assemble("lda undef\nFOO = 1\nFOO = 2\n", "t");
		expect(r.diagnostics.map((d) => d.code)).toEqual([
			Codes.UndefinedSymbol,
			Codes.AlreadyDefined,
		]);
	});

	test("undefined-symbol diagnostics carry the symbol name", () => {
		const r = assemble("lda undef\n", "t");
		expect(r.diagnostics[0]!.symbol).toBe("undef");
	});

	test("the code registry has no duplicate codes", () => {
		const values = Object.values(Codes);
		expect(new Set(values).size).toBe(values.length);
	});
});

describe("diagnostic notes", () => {
	test("a duplicate symbol notes the first definition", () => {
		const r = assemble("FOO = 1\nFOO = 2\n", "t");
		const error = r.diagnostics[0]!;
		expect(error.message).toBe('Symbol "FOO" is already defined');
		expect(error.notes).toEqual([
			{ message: "First defined here", start: 0, end: 3, file: "t" },
		]);
		// The note renders as its own file:line:col block after the error.
		expect(error.formatted).toMatch(/^t:2:1 - error SP2002: /);
		expect(error.formatted).toContain("\n\nt:1:1 - note: First defined here\n");
		expect(error.formatted).toMatch(/\n {2}~{3}$/);
	});

	test("a duplicate label notes the first definition", () => {
		const r = assemble("here:\nhere:\n", "t");
		const error = r.diagnostics[0]!;
		expect(error.message).toBe('Symbol "here" is already defined');
		expect(error.notes).toEqual([
			{ message: "First defined here", start: 0, end: 4, file: "t" },
		]);
	});

	test("a duplicate export notes the first export", () => {
		const r = assemble(".export FOO = 1\n.export FOO\n", "t");
		const error = r.diagnostics[0]!;
		expect(error.message).toBe('Symbol "FOO" is already exported');
		expect(error.notes).toEqual([
			{ message: "First exported here", start: 8, end: 11, file: "t" },
		]);
	});

	test("a duplicate macro notes the first definition", () => {
		const r = assemble(
			".macro m\n\tnop\n.endmacro\n.macro m\n\tnop\n.endmacro\n",
			"t",
		);
		const error = r.diagnostics[0]!;
		expect(error.message).toBe('Macro "m" is already defined');
		expect(error.notes?.[0]?.message).toBe("First defined here");
		expect(error.formatted).toContain("note: First defined here");
	});

	test("a double placement notes the first placement", () => {
		const r = assemble(
			'.segment "OUTPUT"\n.emit "A"\n.emit "A"\n.segment "A"\n.byte 1\n',
			"t",
		);
		const error = r.diagnostics[0]!;
		expect(error.message).toBe('Segment "A" is placed more than once');
		expect(error.notes?.[0]?.message).toBe("First placed here");
		expect(error.formatted).toMatch(/note: First placed here\n\n2 \.emit "A"/);
	});

	test("a circular placement notes the chain of open placements", () => {
		const r = assemble(
			'.segment "OUTPUT"\n.emit "A"\n' +
				'.segment "A"\n.emit "B"\n' +
				'.segment "B"\n.emit "A"\n',
			"t",
		);
		const error = r.diagnostics.find((d) => d.message.includes("Circular"))!;
		expect(error.notes?.map((n) => n.message)).toEqual([
			'While placing "A"',
			'While placing "B"',
		]);
	});

	test("an import cycle notes the chain of open imports", async () => {
		const host = memHost({
			main: '.import "a"\nnop\n',
			a: '.import "b"\n',
			b: '.import "a"\n',
		});
		const r = await assemble("main", host);
		const error = r.diagnostics.find((d) =>
			d.message.includes("Import cycle"),
		)!;
		expect(error.file).toBe("b");
		expect(error.notes).toEqual([
			{ message: 'While importing "a"', start: 8, end: 11, file: "main" },
			{ message: 'While importing "b"', start: 8, end: 11, file: "a" },
		]);
		expect(error.formatted).toContain('main:1:9 - note: While importing "a"');
		expect(error.formatted).toContain('a:1:9 - note: While importing "b"');
	});
});

describe("conditional assembly (.if/.elseif/.else/.endif)", () => {
	test("a true condition takes its arm", () => {
		expect(asm(".if 1\n.byte 1\n.else\n.byte 2\n.endif\n").bytes).toEqual([1]);
	});

	test("a false condition falls through to .else", () => {
		expect(asm(".if 0\n.byte 1\n.else\n.byte 2\n.endif\n").bytes).toEqual([2]);
	});

	test(".elseif chains take the first true arm", () => {
		const src = (v: number) =>
			`V = ${v}\n.if V = 1\n.byte 1\n.elseif V = 2\n.byte 2\n.else\n.byte 3\n.endif\n`;
		expect(asm(src(1)).bytes).toEqual([1]);
		expect(asm(src(2)).bytes).toEqual([2]);
		expect(asm(src(9)).bytes).toEqual([3]);
	});

	test("a macro call inside an arm expands", () => {
		const { bytes, messages } = asm(
			".macro put\n\t.byte 7\n.endmacro\n.if 1\n\tput\n.endif\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([7]);
	});

	test("no matching arm and no .else collects nothing", () => {
		expect(asm(".if 0\n.byte 1\n.endif\n.byte 9\n").bytes).toEqual([9]);
	});

	test("an unresolved condition falls to .else and errors at convergence", () => {
		const { bytes, messages } = asm(
			".if nope\n.byte 1\n.else\n.byte 2\n.endif\n",
		);
		expect(bytes).toEqual([2]);
		expect(messages).toEqual(['Undefined symbol "nope"']);
	});

	test("a non-numeric condition is a type error", () => {
		expect(asm('.if "x"\n.byte 1\n.endif\n').messages).toContain(
			"`.if` requires a numeric condition",
		);
	});

	test("a span-dependent condition converges (backward, near)", () => {
		const { bytes, messages } = asm(
			".org $0400\nstart:\n\tnop\n.if start - * < 130 && * - start < 127\n\tbne start\n.else\n\tbeq skip\n\tjmp start\nskip:\n.endif\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([0xea, 0xd0, 0xfd]); // nop; bne start
	});

	test("a span-dependent condition converges (backward, far)", () => {
		const { bytes, messages } = asm(
			".org $0400\nstart:\n\tnop\n.res 200\n.if start - * < 130 && * - start < 127\n\tbne start\n.else\n\tbeq skip\n\tjmp start\nskip:\n.endif\n",
		);
		expect(messages).toEqual([]);
		// nop, 200 fill bytes, then the long form: beq +3; jmp start.
		expect(bytes).toHaveLength(206);
		expect(bytes.slice(-5)).toEqual([0xf0, 0x03, 0x4c, 0x00, 0x04]);
	});

	test("a forward target starts long (pessimistic) and shrinks to short", () => {
		const { bytes, messages } = asm(
			".org $0400\n.if fwd - * < 130 && * - fwd < 127\n\tbne fwd\n.else\n\tbeq skip\n\tjmp fwd\nskip:\n.endif\n\tnop\nfwd:\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([0xd0, 0x01, 0xea]); // bne fwd; nop
	});

	test("arm-local names are invisible outside the arm", () => {
		const { bytes, messages } = asm(".if 1\ntmp: .byte 5\n.endif\n\tlda tmp\n");
		expect(messages).toEqual(['Undefined symbol "tmp"']);
		expect(bytes).toEqual([5, 0xad, 0, 0]);
	});

	test("both arms may define the same name without colliding", () => {
		const { bytes, messages } = asm(
			".if 1\nv = 1\n.byte v\n.else\nv = 2\n.byte v\n.endif\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([1]);
	});

	test("a label on the .if statement names the winning arm's address", () => {
		const { bytes, symbols, messages } = asm(
			".org $0400\nentry: .if 1\n\tnop\n.endif\n.word entry\n",
		);
		expect(messages).toEqual([]);
		expect(symbols.get("entry")).toBe(0x0400n);
		expect(bytes).toEqual([0xea, 0x00, 0x04]);
	});

	test("nested arms shadow the outer arm's locals", () => {
		const { bytes, messages } = asm(
			".if 1\nn = 1\n.if 1\nn = 2\n.byte n\n.endif\n.byte n\n.endif\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([2, 1]);
	});

	test("module-level directives are rejected inside arms", () => {
		expect(asm(".if 1\n.export foo = 1\n.endif\n").messages).toContain(
			"`.export` is not allowed inside an `.if` arm",
		);
	});

	test("a macro parameter can gate an .if in the body", () => {
		const { bytes, messages } = asm(
			".macro maybe_byte flag, v\n.if flag\n.byte v\n.endif\n.endmacro\n" +
				"maybe_byte 1, 7\nmaybe_byte 0, 8\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([7]);
	});

	test("a jne-style macro picks short or long per call site", () => {
		const { bytes, messages } = asm(
			".macro jne target\n" +
				".if target - * < 130 && * - target < 127\n\tbne target\n" +
				".else\n\tbeq skip\n\tjmp target\nskip:\n.endif\n" +
				".endmacro\n" +
				".org $0400\nstart:\n\tnop\n\tjne start\n.res 200\n\tjne start\n",
		);
		expect(messages).toEqual([]);
		// Near call: bne; far call: beq skip; jmp start (skip is per-expansion).
		expect(bytes.slice(0, 3)).toEqual([0xea, 0xd0, 0xfd]);
		expect(bytes.slice(-5)).toEqual([0xf0, 0x03, 0x4c, 0x00, 0x04]);
	});

	test("a parameter defined inside an arm is rejected at the definition site", () => {
		expect(
			asm(".macro m .out name\n.if 1\nname: .byte 1\n.endif\n.endmacro\n")
				.messages,
		).toContain(
			'Parameter "name" is defined inside an `.if` arm - arm definitions are arm-local',
		);
	});
});

describe(".error", () => {
	test("fires when its arm is taken", () => {
		expect(asm('.if 1\n.error "boom"\n.endif\n').messages).toEqual(["boom"]);
	});

	test("does not fire in an untaken arm", () => {
		expect(asm('.if 0\n.error "boom"\n.endif\n').messages).toEqual([]);
	});

	test("an address-dependent bounds check fires only on overflow", () => {
		const src = (n: number) =>
			`.org 0\n.res ${n}\n.if * > 2\n.error "overflow"\n.endif\n`;
		expect(asm(src(2)).messages).toEqual([]);
		expect(asm(src(3)).messages).toEqual(["overflow"]);
	});

	test("a bounds check after a placement sees the placed segment's size", () => {
		// `*` after an `.emit`/`.emplace` advances by the previous render's
		// segment size (fed back like `.res` sizes), so the format-macro idiom
		// "emplace, then check the boundary" works.
		const src = (n: number) =>
			'.segment "OUTPUT"\n.org $80\n.emplace "ZP"\n' +
			'.if * > $100\n.error "zp overflow"\n.endif\n' +
			`.segment "ZP"\n.res ${n}\n`;
		expect(asm(src(128)).messages).toEqual([]);
		expect(asm(src(200)).messages).toEqual(["zp overflow"]);
	});

	test("a macro-body .error attributes to the call site, noting the directive", async () => {
		const main = '.import "lib"\ncheck\n';
		const lib =
			'.export .macro check\n.if 1\n.error "boom"\n.endif\n.endmacro\n';
		const host = memHost({ main, lib });
		const r = await assemble("main", host);

		expect(r.diagnostics).toHaveLength(1);
		const error = r.diagnostics[0]!;
		expect(error.message).toBe("boom");
		// The macro rejected its call - the call is the error.
		expect(error.file).toBe("main");
		const call = main.indexOf("check");
		expect([error.start, error.end]).toEqual([call, call + 5]);

		// The note walks into the body, down to the directive itself.
		expect(error.notes).toHaveLength(1);
		const note = error.notes![0]!;
		expect(note.message).toBe("While expanding `check`");
		expect(note.file).toBe("lib");
		expect([note.start, note.end]).toEqual([
			lib.indexOf(".error"),
			lib.indexOf('"boom"') + 6,
		]);
	});

	test("a nested body .error narrates the whole path", async () => {
		const main = '.import "outer"\ngo\n';
		const outer = '.import "inner"\n.export .macro go\n\tvalidate\n.endmacro\n';
		const inner = '.export .macro validate\n\t.error "nope"\n.endmacro\n';
		const host = memHost({ main, outer, inner });
		const r = await assemble("main", host);

		expect(r.diagnostics).toHaveLength(1);
		const error = r.diagnostics[0]!;
		expect(error.message).toBe("nope");
		expect(error.file).toBe("main");
		const call = main.indexOf("go", main.indexOf("outer"));
		expect([error.start, error.end]).toEqual([call, call + 2]);

		expect(error.notes!.map((n) => [n.message, n.file])).toEqual([
			["While expanding `go`", "outer"],
			["While expanding `validate`", "inner"],
		]);
		expect(error.notes![0]!.start).toBe(outer.indexOf("validate\n"));
		expect(error.notes![1]!.start).toBe(inner.indexOf(".error"));
	});

	test("the message must be a string", () => {
		expect(asm(".error 42\n").messages).toEqual([
			"`.error` requires a string message",
		]);
	});

	test("an anchor argument attributes the error to the caller's argument", async () => {
		const lib =
			'.export .macro put src\n.if .is_simple_operand(src)\n\tlda src\n.else\n.error "bad operand", src\n.endif\n.endmacro\n';
		const main = '.import "lib"\nput ($12,x)\n';
		const host = memHost({ main, lib });
		const r = await assemble("main", host);

		expect(r.diagnostics).toHaveLength(1);
		const error = r.diagnostics[0]!;
		expect(error.message).toBe("bad operand");
		// The offending argument itself, punctuation included.
		expect(error.file).toBe("main");
		const arg = main.indexOf("($12,x)");
		expect([error.start, error.end]).toEqual([arg, arg + 7]);

		// The note lands on the param occurrence on the `.error` line.
		expect(error.notes).toHaveLength(1);
		const note = error.notes![0]!;
		expect(note.message).toBe("While expanding `put`");
		expect(note.file).toBe("lib");
		const use = lib.indexOf("src", lib.indexOf(".error"));
		expect([note.start, note.end]).toEqual([use, use + 3]);
	});

	test("a nested anchor narrates each hop's param occurrence", async () => {
		const inner = '.export .macro guts v\n.error "nope", v\n.endmacro\n';
		const outer =
			'.import "inner"\n.export .macro shell w\n\tguts w\n.endmacro\n';
		const main = '.import "outer"\nshell #5\n';
		const host = memHost({ main, outer, inner });
		const r = await assemble("main", host);

		expect(r.diagnostics).toHaveLength(1);
		const error = r.diagnostics[0]!;
		expect(error.message).toBe("nope");
		expect(error.file).toBe("main");
		const arg = main.indexOf("#5");
		expect([error.start, error.end]).toEqual([arg, arg + 2]);

		expect(error.notes!.map((n) => [n.message, n.file])).toEqual([
			["While expanding `shell`", "outer"],
			["While expanding `guts`", "inner"],
		]);
		expect(error.notes![0]!.start).toBe(
			outer.indexOf("w", outer.indexOf("guts")),
		);
		expect(error.notes![1]!.start).toBe(
			inner.indexOf("v", inner.indexOf(".error")),
		);
	});

	test("a top-level anchor attributes to the expression, unevaluated", () => {
		// `nowhere` is undefined; the anchor is location-only, so no
		// undefined-symbol diagnostic fires.
		const src = 'here:\n.error "boom", nowhere\n';
		const { messages } = asm(src);
		expect(messages).toEqual(["boom"]);
		const r = assemble(src, "t");
		const error = r.diagnostics[0]!;
		expect([error.start, error.end]).toEqual([
			src.indexOf("nowhere"),
			src.indexOf("nowhere") + 7,
		]);
		expect(error.notes).toBeUndefined();
	});
});

describe("export name forms", () => {
	test(".export name exports an elsewhere-defined symbol", async () => {
		const host = memHost({
			main: '.import "lib"\n.byte FOO\nlda entry\n',
			lib: ".export FOO\nFOO = 7\n.export entry\nentry:\n\tnop\n",
		});
		const r = await assemble("main", host);
		expect(r.diagnostics.map((d) => d.message)).toEqual([]);
		// lib collects first: entry/nop at 0; then main's byte and a zp lda.
		expect([...r.output]).toEqual([0xea, 7, 0xa5, 0x00]);
	});

	test("exporting the same symbol twice is an error", async () => {
		const host = memHost({
			main: '.import "lib"\n.byte FOO\n',
			lib: ".export FOO\n.export FOO\nFOO = 7\n",
		});
		const r = await assemble("main", host);
		const error = r.diagnostics[0]!;
		expect(error.message).toBe('Symbol "FOO" is already exported');
		expect(error.formatted).toMatch(/^lib:2:9 - error SP2003: /);
	});

	test("a bare re-export of a defining export is an error too", async () => {
		const host = memHost({
			main: '.import "lib"\n.byte FOO\n',
			lib: ".export FOO = 7\n.export FOO\n",
		});
		const r = await assemble("main", host);
		expect(r.diagnostics.map((d) => d.message)).toEqual([
			'Symbol "FOO" is already exported',
		]);
	});

	test(".export label: defines and exports in place", async () => {
		const host = memHost({
			main: '.import "lib"\n.word start\n',
			lib: "\t.byte 9\n.export start:\n\tnop\n",
		});
		const r = await assemble("main", host);
		expect(r.diagnostics.map((d) => d.message)).toEqual([]);
		// lib collects first: byte at 0, start = 1 (the nop); then main's word.
		expect([...r.output]).toEqual([9, 0xea, 0x01, 0x00]);
	});

	test("a bare export of a never-defined name is an error", async () => {
		const host = memHost({
			main: '.import "lib"\nnop\n',
			lib: ".export NOPE\n",
		});
		const r = await assemble("main", host);
		const error = r.diagnostics[0]!;
		expect(error.message).toBe('Exported symbol "NOPE" is never defined');
		expect(error.formatted).toMatch(/^lib:1:9 - error SP2004: /);
	});
});

describe("definition spans", () => {
	const SEP = "\0";

	function span(src: string, text: string): [number, number] {
		const start = src.indexOf(text);
		expect(start).toBeGreaterThanOrEqual(0);
		return [start, start + text.length];
	}

	test("labels and constants record their defining token", () => {
		const src = "\t.org $0600\nSIZE = 3\nstart:\n\tlda #SIZE\n";
		const result = assemble(src, "t");
		expect(result.diagnostics).toEqual([]);

		const size = result.definitions.get("t" + SEP + "SIZE")!;
		expect([size.start, size.end]).toEqual(span(src, "SIZE"));
		expect(size.kind).toBe("constant");
		expect(size.file).toBe("t");

		const start = result.definitions.get("t" + SEP + "start")!;
		expect([start.start, start.end]).toEqual(span(src, "start"));
		expect(start.kind).toBe("label");
	});

	test("a dictionary defines entries under NUL-joined names, at key tokens", () => {
		const src = "N = { OPEN: 0, CLOSE: 2 }\n\t.byte N::CLOSE\n";
		const result = assemble(src, "t");
		expect(result.diagnostics).toEqual([]);

		const n = result.definitions.get("t" + SEP + "N")!;
		expect(n.kind).toBe("namespace");
		expect([n.start, n.end]).toEqual(span(src, "N"));

		const close = result.definitions.get("t" + SEP + "N" + SEP + "CLOSE")!;
		expect([close.start, close.end]).toEqual(span(src, "CLOSE"));
		expect(close.kind).toBe("constant");
		expect(close.value).toBe(2n);

		// Entries surface through the dict, not as flattened symbols.
		expect([...result.symbols.keys()]).toEqual(["N"]);
	});

	test("expression macros appear in definitions but not in symbols", () => {
		const src = "DOUBLE(v) = 2 * v\n\t.byte DOUBLE(3)\n";
		const result = assemble(src, "t");
		expect(result.diagnostics).toEqual([]);

		expect(result.symbols.has("DOUBLE")).toBe(false);
		const double = result.definitions.get("t" + SEP + "DOUBLE")!;
		expect([double.start, double.end]).toEqual(span(src, "DOUBLE"));
		expect(double.kind).toBe("function");
	});

	test("an imported symbol's definition points into the defining module", async () => {
		const lib = ".export SIZE = 7\n";
		const host = memHost({
			main: '.import "lib"\n\t.byte SIZE\n',
			lib,
		});
		const result = await assemble("main", host);
		expect(result.diagnostics).toEqual([]);

		const size = result.definitions.get("lib" + SEP + "SIZE")!;
		expect(size.file).toBe("lib");
		expect([size.start, size.end]).toEqual(span(lib, "SIZE"));
	});

	test("a macro-stamped definition attributes to the macro's module", async () => {
		const lib = ".export .macro setup\nMAGIC = 42\n.endmacro\n";
		const host = memHost({
			main: '.import "lib"\nsetup\n\tnop\n',
			lib,
		});
		const result = await assemble("main", host);
		expect(result.diagnostics).toEqual([]);

		const entry = [...result.definitions].find(([key]) =>
			key.slice(key.indexOf(SEP) + 1).startsWith("MAGIC"),
		);
		expect(entry).toBeDefined();
		const [, magic] = entry!;
		expect(magic.file).toBe("lib");
		expect([magic.start, magic.end]).toEqual(span(lib, "MAGIC"));
	});

	test("a duplicate definition keeps the first span", () => {
		const src = "foo = 1\nfoo = 2\n\t.byte foo\n";
		const result = assemble(src, "t");
		expect(result.diagnostics.map((d) => d.code)).toEqual(["SP2002"]);

		const foo = result.definitions.get("t" + SEP + "foo")!;
		expect(foo.start).toBe(src.indexOf("foo"));
	});
});

describe("reference recording", () => {
	const SEP = "\0";

	function refAt(
		result: {
			references: Map<string, { start: number; end: number; symbol: string }[]>;
		},
		file: string,
		src: string,
		text: string,
		from = 0,
	): string | undefined {
		const start = src.indexOf(text, from);
		expect(start).toBeGreaterThanOrEqual(0);
		return result.references
			.get(file)
			?.find((r) => r.start === start && r.end === start + text.length)?.symbol;
	}

	test("operand and forward-label references record their spans", () => {
		const src = "SIZE = 3\nstart:\n\tlda #SIZE\n\tbne done\ndone:\n\trts\n";
		const result = assemble(src, "t");
		expect(result.diagnostics).toEqual([]);

		expect(refAt(result, "t", src, "SIZE", src.indexOf("#"))).toBe(
			"t" + SEP + "SIZE",
		);
		expect(refAt(result, "t", src, "done")).toBe("t" + SEP + "done");
	});

	test("local labels record under their qualified names", () => {
		const src = "start:\n@loop:\n\tbne @loop\n\trts\n";
		const result = assemble(src, "t");
		expect(result.diagnostics).toEqual([]);

		expect(refAt(result, "t", src, "@loop", src.indexOf("bne"))).toBe(
			"t" + SEP + "start@loop",
		);
	});

	test("a splat-imported reference records the defining module's key", async () => {
		const main = '.import "lib"\n\t.byte SIZE\n';
		const host = memHost({ main, lib: ".export SIZE = 7\n" });
		const result = await assemble("main", host);
		expect(result.diagnostics).toEqual([]);

		expect(refAt(result, "main", main, "SIZE")).toBe("lib" + SEP + "SIZE");
	});

	test("a namespaced path records per-segment spans", async () => {
		const main = 'lib = .import "lib"\n\t.byte lib::FOO\n';
		const host = memHost({ main, lib: ".export FOO = 7\n" });
		const result = await assemble("main", host);
		expect(result.diagnostics).toEqual([]);

		// Cursor over `FOO` finds the export; over `lib`, the binding.
		expect(refAt(result, "main", main, "FOO")).toBe("lib" + SEP + "FOO");
		expect(refAt(result, "main", main, "lib", main.indexOf("::") - 3)).toBe(
			"main" + SEP + "lib",
		);
	});

	test("an undefined name records no reference", () => {
		const src = "\t.byte nope\n";
		const result = assemble(src, "t");
		expect(result.diagnostics.map((d) => d.code)).toEqual(["SP2001"]);
		expect(result.references.get("t") ?? []).toEqual([]);
	});

	test("references pair with definitions for round trips", () => {
		const src = "SIZE = 3\n\tlda #SIZE\n";
		const result = assemble(src, "t");
		const symbol = refAt(result, "t", src, "SIZE", src.indexOf("#"))!;
		const definition = result.definitions.get(symbol)!;
		expect(definition.file).toBe("t");
		expect(definition.start).toBe(src.indexOf("SIZE"));
		expect(definition.value).toBe(3n);
	});
});

describe("dict-entry and import navigation", () => {
	const SEP = "\0";

	function refAt(
		result: {
			references: Map<string, { start: number; end: number; symbol: string }[]>;
		},
		file: string,
		src: string,
		text: string,
		from = 0,
	): string | undefined {
		const start = src.indexOf(text, from);
		expect(start).toBeGreaterThanOrEqual(0);
		return result.references
			.get(file)
			?.find((r) => r.start === start && r.end === start + text.length)?.symbol;
	}

	test("nested dict keys reference their entry definitions", () => {
		const src =
			"N = { Command: { OPEN: 3, CLOSE: 12 } }\n\t.byte N::Command::OPEN\n";
		const result = assemble(src, "t");
		expect(result.diagnostics).toEqual([]);

		const use = src.indexOf(".byte");
		expect(refAt(result, "t", src, "Command", use)).toBe(
			"t" + SEP + "N" + SEP + "Command",
		);
		expect(refAt(result, "t", src, "OPEN", use)).toBe(
			"t" + SEP + "N" + SEP + "Command" + SEP + "OPEN",
		);

		const command = result.definitions.get("t" + SEP + "N" + SEP + "Command")!;
		expect(command.kind).toBe("namespace");
		const open = result.definitions.get(
			"t" + SEP + "N" + SEP + "Command" + SEP + "OPEN",
		)!;
		expect([open.start, open.end]).toEqual([
			src.indexOf("OPEN"),
			src.indexOf("OPEN") + 4,
		]);
		expect(open.value).toBe(3n);
	});

	test("dict keys navigate through a namespaced import", async () => {
		const lib = ".export Command = { OPEN: 3, CLOSE: 12 }\n";
		const main = 'cio = .import "lib"\n\t.byte cio::Command::OPEN\n';
		const host = memHost({ main, lib });
		const result = await assemble("main", host);
		expect(result.diagnostics).toEqual([]);

		expect(refAt(result, "main", main, "OPEN")).toBe(
			"lib" + SEP + "Command" + SEP + "OPEN",
		);
		const open = result.definitions.get(
			"lib" + SEP + "Command" + SEP + "OPEN",
		)!;
		expect(open.file).toBe("lib");
		expect([open.start, open.end]).toEqual([
			lib.indexOf("OPEN"),
			lib.indexOf("OPEN") + 4,
		]);
	});

	test("an import specifier references the imported module", async () => {
		const main =
			'.import "lib"\nlib2 = .import "lib2"\n\t.byte FOO, lib2::BAR\n';
		const host = memHost({
			main,
			lib: ".export FOO = 1\n",
			lib2: ".export BAR = 2\n",
		});
		const result = await assemble("main", host);
		expect(result.diagnostics).toEqual([]);

		expect(refAt(result, "main", main, '"lib"')).toBe("lib");
		expect(refAt(result, "main", main, '"lib2"')).toBe("lib2");
		const module = result.definitions.get("lib")!;
		expect(module.kind).toBe("module");
		expect(module.file).toBe("lib");
		expect([module.start, module.end]).toEqual([0, 0]);
	});
});

describe("macro navigation", () => {
	const SEP = "\0";

	function refAt(
		result: {
			references: Map<string, { start: number; end: number; symbol: string }[]>;
		},
		file: string,
		src: string,
		text: string,
		from = 0,
	): string | undefined {
		const start = src.indexOf(text, from);
		expect(start).toBeGreaterThanOrEqual(0);
		return result.references
			.get(file)
			?.find((r) => r.start === start && r.end === start + text.length)?.symbol;
	}

	const lib = ".export .macro mva src, dst\n\tlda src\n\tsta dst\n.endmacro\n";

	test("a call references the macro; body occurrences reference params", async () => {
		const main = '.import "lib"\nfoo = $80\nbar = $81\n\tmva foo, bar\n\trts\n';
		const host = memHost({ main, lib });
		const result = await assemble("main", host);
		expect(result.diagnostics).toEqual([]);

		const macroSym = "lib" + SEP + SEP + "mva";
		expect(refAt(result, "main", main, "mva")).toBe(macroSym);

		const macro = result.definitions.get(macroSym)!;
		expect(macro.kind).toBe("macro");
		expect([macro.start, macro.end]).toEqual([
			lib.indexOf("mva"),
			lib.indexOf("mva") + 3,
		]);

		// Spliced call-site arguments reference the caller's symbols.
		const call = main.indexOf("mva");
		expect(refAt(result, "main", main, "foo", call)).toBe("main" + SEP + "foo");

		// Param occurrences in the body reference the param definitions.
		expect(refAt(result, "lib", lib, "src", lib.indexOf("lda"))).toBe(
			macroSym + SEP + "src",
		);
		expect(refAt(result, "lib", lib, "dst", lib.indexOf("sta"))).toBe(
			macroSym + SEP + "dst",
		);
		const param = result.definitions.get(macroSym + SEP + "src")!;
		expect(param.kind).toBe("parameter");
		expect([param.start, param.end]).toEqual([
			lib.indexOf("src"),
			lib.indexOf("src") + 3,
		]);
	});

	test("a namespaced call references the binding and the macro", async () => {
		const main =
			'l = .import "lib"\nfoo = $80\nbar = $81\n\tl::mva foo, bar\n\trts\n';
		const host = memHost({ main, lib });
		const result = await assemble("main", host);
		expect(result.diagnostics).toEqual([]);

		const call = main.indexOf("l::");
		expect(refAt(result, "main", main, "l", call)).toBe("main" + SEP + "l");
		expect(refAt(result, "main", main, "mva", call)).toBe(
			"lib" + SEP + SEP + "mva",
		);
	});

	test("an uncalled macro's body call still references the callee", async () => {
		// mwa is never called, so it never expands - the sta_hi call in its
		// `.if` arm must still be navigable and count as a use.
		const helperLib =
			".macro sta_hi dst\n\tsta dst\n.endmacro\n" +
			".export .macro mwa src, dst\n\t.if 1\n\t\tsta_hi dst\n\t.endif\n.endmacro\n";
		const main = '.import "lib"\n\trts\n';
		const host = memHost({ main, lib: helperLib });
		const result = await assemble("main", host);
		expect(result.diagnostics).toEqual([]);

		expect(
			refAt(result, "lib", helperLib, "sta_hi", helperLib.indexOf("mwa")),
		).toBe("lib" + SEP + SEP + "sta_hi");
	});

	test("an uncalled body's namespaced call references binding and macro", async () => {
		const outer = 'l = .import "lib"\n.macro wrap\n\tl::mva 1, 2\n.endmacro\n';
		const main = '.import "outer"\n\trts\n';
		const host = memHost({ main, outer, lib });
		const result = await assemble("main", host);
		expect(result.diagnostics).toEqual([]);

		const call = outer.indexOf("l::mva");
		expect(refAt(result, "outer", outer, "l", call)).toBe("outer" + SEP + "l");
		expect(refAt(result, "outer", outer, "mva", call)).toBe(
			"lib" + SEP + SEP + "mva",
		);
	});
});

describe("module scopes", () => {
	test("the result carries per-module visibility", async () => {
		const host = memHost({
			main: '.import "lib"\nns = .import "lib2"\n\t.byte FOO, ns::BAR\n',
			lib: ".export FOO = 1\n.export .macro nothing\n.endmacro\n.macro private\n.endmacro\n",
			lib2: ".export BAR = 2\n",
		});
		const result = await assemble("main", host);
		expect(result.diagnostics).toEqual([]);

		const main = result.moduleScopes.get("main")!;
		expect(main.splats).toEqual(["lib"]);
		expect([...main.bindings]).toEqual([["ns", "lib2"]]);

		const lib = result.moduleScopes.get("lib")!;
		expect([...lib.exports]).toEqual(["FOO"]);
		expect([...lib.macroExports]).toEqual(["nothing"]);
	});
});

describe("macro-expansion diagnostics", () => {
	const lib =
		".export .macro emit_boot target\n\tjmp target\n\tlda #target\n.endmacro\n";

	test("a spliced argument's range error spans the call-site arg, with a note", async () => {
		const main = '.import "lib"\n\t.org $2000\ninit:\n\temit_boot init\n';
		const host = memHost({ main, lib });
		const result = await assemble("main", host);

		expect(result.diagnostics).toHaveLength(1);
		const error = result.diagnostics[0]!;
		expect(error.code).toBe("SP3004");
		expect(error.file).toBe("main");
		// The second `init` - the macro argument, exactly.
		const arg = main.indexOf("init", main.indexOf("emit_boot"));
		expect([error.start, error.end]).toEqual([arg, arg + 4]);

		// The note points into the macro body, at the failing value as
		// written there - the param occurrence the argument replaced.
		expect(error.notes).toHaveLength(1);
		const note = error.notes![0]!;
		expect(note.message).toBe("While expanding `emit_boot`");
		expect(note.file).toBe("lib");
		expect([note.start, note.end]).toEqual([
			lib.indexOf("#target") + 1,
			lib.indexOf("#target") + 7,
		]);
	});

	test("a body expression's range error attributes to the macro file, without a note", async () => {
		const bigLib = ".export .macro emit\nBIG = $1234\n\tlda #BIG\n.endmacro\n";
		const main = '.import "lib"\n\temit\n';
		const host = memHost({ main, lib: bigLib });
		const result = await assemble("main", host);

		expect(result.diagnostics).toHaveLength(1);
		const error = result.diagnostics[0]!;
		expect(error.code).toBe("SP3004");
		expect(error.file).toBe("lib");
		const use = bigLib.indexOf("BIG", bigLib.indexOf("#"));
		expect([error.start, error.end]).toEqual([use, use + 3]);
		expect(error.notes).toBeUndefined();
	});

	test("a spliced operand's mode error spans the call-site arg, with a note", async () => {
		const addLib =
			".export .macro add operand\n\tclc\n\tadc operand\n.endmacro\n";
		const main = '.import "lib"\n\tadd ($1234)\n';
		const host = memHost({ main, lib: addLib });
		const result = await assemble("main", host);

		expect(result.diagnostics).toHaveLength(1);
		const error = result.diagnostics[0]!;
		expect(error.code).toBe("SP3003");
		expect(error.message).toBe("ADC has no indirect addressing mode");
		// The call-site argument, whole operand: the parens are the caller's
		// tokens too, so the span widens past the expression.
		expect(error.file).toBe("main");
		const arg = main.indexOf("($1234)");
		expect([error.start, error.end]).toEqual([arg, arg + 7]);

		// The note underlines the whole body instruction - the mnemonic is
		// the other half of what failed, not just the spliced operand.
		expect(error.notes).toHaveLength(1);
		const note = error.notes![0]!;
		expect(note.message).toBe("While expanding `add`");
		expect(note.file).toBe("lib");
		const adc = addLib.indexOf("adc");
		const use = addLib.indexOf("operand", adc);
		expect([note.start, note.end]).toEqual([adc, use + 7]);
	});

	test("an instruction inside a .if arm still narrates its expansion", async () => {
		const madLib =
			".export .macro madd flag, operand\n\t.if flag\n\t\tadc operand\n\t.endif\n.endmacro\n";
		const main = '.import "lib"\n\tmadd 1, ($12)\n';
		const host = memHost({ main, lib: madLib });
		const result = await assemble("main", host);

		expect(result.diagnostics).toHaveLength(1);
		const error = result.diagnostics[0]!;
		expect(error.code).toBe("SP3003");
		expect(error.file).toBe("main");

		expect(error.notes).toHaveLength(1);
		const note = error.notes![0]!;
		expect(note.message).toBe("While expanding `madd`");
		expect(note.file).toBe("lib");
		const adc = madLib.indexOf("adc");
		expect([note.start, note.end]).toEqual([
			adc,
			madLib.indexOf("operand", adc) + 7,
		]);
	});

	test("a body-written shape around a spliced value keeps the value span", async () => {
		const wrapLib = ".export .macro wrap v\n\tadc (v)\n.endmacro\n";
		const main = '.import "lib"\n\twrap $1234\n';
		const host = memHost({ main, lib: wrapLib });
		const result = await assemble("main", host);

		expect(result.diagnostics).toHaveLength(1);
		const error = result.diagnostics[0]!;
		expect(error.code).toBe("SP3003");
		// The parens are the body's, the value the caller's - a whole-operand
		// span would mix files, so only the spliced value is underlined.
		expect(error.file).toBe("main");
		const arg = main.indexOf("$1234");
		expect([error.start, error.end]).toEqual([arg, arg + 5]);

		expect(error.notes).toHaveLength(1);
		expect(error.notes![0]!.file).toBe("lib");
	});

	test("a body-written mode error attributes to the macro file, once", async () => {
		const badLib = ".export .macro bump\n\tadc ($80)\n.endmacro\n";
		const main = '.import "lib"\n\tbump\n\tbump\n';
		const host = memHost({ main, lib: badLib });
		const result = await assemble("main", host);

		// The shape is the body's own; two expansions dedup to one error.
		expect(result.diagnostics).toHaveLength(1);
		const error = result.diagnostics[0]!;
		expect(error.code).toBe("SP3003");
		expect(error.file).toBe("lib");
		// Fully body-owned, so the span widens to the whole operand.
		const bad = badLib.indexOf("($80)");
		expect([error.start, error.end]).toEqual([bad, bad + 5]);
		expect(error.notes).toBeUndefined();
	});

	test("a plain range error spans the expression, not the # marker", () => {
		const src = "\tlda #$1234\n";
		const result = assemble(src, "t");
		const error = result.diagnostics[0]!;
		expect(error.code).toBe("SP3004");
		expect([error.start, error.end]).toEqual([
			src.indexOf("$1234"),
			src.indexOf("$1234") + 5,
		]);
	});
});

describe("macro-expansion trails", () => {
	test("nested expansions narrate the whole path, outermost first", async () => {
		const inner = ".export .macro emit_boot target\n\tlda #target\n.endmacro\n";
		const main = [
			'.import "inner"',
			".macro wrapper t",
			"\temit_boot t",
			".endmacro",
			"\t.org $2000",
			"init:",
			"\twrapper init",
			"",
		].join("\n");
		const host = memHost({ main, inner });
		const result = await assemble("main", host);

		expect(result.diagnostics).toHaveLength(1);
		const error = result.diagnostics[0]!;
		expect(error.code).toBe("SP3004");
		// Main span: the argument of the outermost, source-level call.
		expect(error.file).toBe("main");
		const arg = main.indexOf("init", main.indexOf("wrapper init"));
		expect([error.start, error.end]).toEqual([arg, arg + 4]);

		expect(error.notes!.map((n) => [n.message, n.file])).toEqual([
			["While expanding `wrapper`", "main"],
			["While expanding `emit_boot`", "inner"],
		]);
		// Each hop underlines the failing value as written in that macro's
		// body: `t` in wrapper's call, `target` in emit_boot's operand.
		expect(error.notes![0]!.start).toBe(main.indexOf("emit_boot t") + 10);
		expect(error.notes![1]!.start).toBe(inner.indexOf("#target") + 1);
	});
});

describe("export references", () => {
	test("a bare .export records a reference to the symbol", async () => {
		const lib = "FOO = 7\n.export FOO\n";
		const host = memHost({ main: '.import "lib"\n\t.byte FOO\n', lib });
		const result = await assemble("main", host);
		expect(result.diagnostics).toEqual([]);

		const exportRef = result.references
			.get("lib")
			?.find((r) => r.start === lib.indexOf("FOO", lib.indexOf(".export")));
		expect(exportRef?.symbol).toBe("lib\0FOO");
	});
});

describe("expression-macro params", () => {
	const SEP = "\0";

	test("params are parameter symbols; body uses record references", () => {
		const src = "SCALE(v, unused) = 2 * v\n\t.byte SCALE(3, 0)\n";
		const result = assemble(src, "t");
		expect(result.diagnostics).toEqual([]);

		const v = result.definitions.get("t" + SEP + "SCALE" + SEP + "v")!;
		expect(v.kind).toBe("parameter");
		expect([v.start, v.end]).toEqual([
			src.indexOf("v,"),
			src.indexOf("v,") + 1,
		]);

		const use = src.indexOf("v", src.indexOf("2 *"));
		const ref = result.references
			.get("t")
			?.find((r) => r.start === use && r.end === use + 1);
		expect(ref?.symbol).toBe("t" + SEP + "SCALE" + SEP + "v");

		// The unused param has a definition and no references.
		const unusedKey = "t" + SEP + "SCALE" + SEP + "unused";
		expect(result.definitions.get(unusedKey)?.kind).toBe("parameter");
		const refs = [...result.references.values()].flat();
		expect(refs.some((r) => r.symbol === unusedKey)).toBe(false);

		// Params stay out of the public symbols map.
		expect([...result.symbols.keys()]).toEqual([]);
	});
});

describe("uncalled-macro params", () => {
	test("param uses are recorded without any call", async () => {
		const lib =
			".export .macro emit_boot target, unused\n\tjmp target\n.endmacro\n";
		const host = memHost({ main: '.import "lib"\n\tnop\n', lib });
		const result = await assemble("main", host);
		expect(result.diagnostics).toEqual([]);

		const use = lib.indexOf("target", lib.indexOf("jmp"));
		const ref = result.references
			.get("lib")
			?.find((r) => r.start === use && r.end === use + 6);
		expect(ref?.symbol).toBe("lib\0\0emit_boot\0target");

		const refs = [...result.references.values()].flat();
		expect(refs.some((r) => r.symbol === "lib\0\0emit_boot\0unused")).toBe(
			false,
		);
	});
});

describe("segment stack (.segment(), .push, .pop)", () => {
	test("the save/restore pattern emits into the right segments", () => {
		const src = [
			"\t.org $0600",
			"\t.byte 1",
			".push .segment() ; save OUTPUT",
			".rodata",
			"\t.byte 9",
			".segment .pop() ; restore",
			"\t.byte 2",
			'.emit "RODATA"',
			"",
		].join("\n");
		const { bytes, messages } = asm(src);
		expect(messages).toEqual([]);
		// OUTPUT: 1, 2, then the emitted RODATA: 9.
		expect(bytes).toEqual([1, 2, 9]);
	});

	test(".segment() evaluates to the current segment's name", () => {
		const src =
			'HERE = .segment()\n.rodata\nTHERE = .segment()\n\tnop\n.emit "RODATA"\n';
		const result = assemble(src, "t");
		expect(result.diagnostics).toEqual([]);
		expect(result.symbols.get("HERE")).toBe("OUTPUT");
		expect(result.symbols.get("THERE")).toBe("RODATA");
	});

	test("a macro can save and restore its caller's segment", async () => {
		const lib = [
			".export .macro emit_data value",
			".push .segment()",
			".rodata",
			"\t.byte value",
			".segment .pop()",
			".endmacro",
			"",
		].join("\n");
		const main = [
			'.import "lib"',
			"\t.org $0600",
			"\t.byte 1",
			"\temit_data 7",
			"\t.byte 2",
			'.emit "RODATA"',
			"",
		].join("\n");
		const result = await assemble("main", memHost({ main, lib }));
		expect(result.diagnostics).toEqual([]);
		expect([...result.output]).toEqual([1, 2, 7]);
	});

	test("an unpopped value is an error at the push site", () => {
		const { messages } = asm(".push 1\n\tnop\n");
		expect(messages).toEqual(["Pushed value is never popped"]);
	});

	test("popping past the top of the stack is an error", () => {
		const { messages } = asm("SAVED = .pop()\n\tnop\n");
		expect(messages).toEqual(["`.pop` with nothing pushed"]);
	});

	test(".pop is rejected inside expression-macro bodies", () => {
		const { messages } = asm(
			".push 1\nF(v) = v + .pop()\n\t.byte F(1)\nDRAIN = .pop()\n\tnop\n",
		);
		expect(messages).toContain("`.pop` is not allowed here");
	});

	test(".pop is rejected in .if conditions", () => {
		const { messages } = asm(
			".push 1\n.if .pop()\n\tnop\n.endif\nDRAIN = .pop()\n\tnop\n",
		);
		expect(messages).toContain("`.pop` is not allowed here");
	});

	test("a non-string segment name is an error", () => {
		const { messages } = asm(".segment 42\n\tnop\n");
		expect(messages).toEqual(["Segment name must be a string"]);
	});

	test("an arm-gated balanced push/pop converges quietly", () => {
		const src = [
			"\t.org $0600",
			".if BIG > 0",
			".push .segment()",
			".rodata",
			"\t.byte 5",
			".segment .pop()",
			".endif",
			"BIG = 1",
			"\t.byte 1",
			'.emit "RODATA"',
			"",
		].join("\n");
		const { bytes, messages } = asm(src);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([1, 5]);
	});
});

describe("operand values", () => {
	test("constructors coerce in operand position", () => {
		const src = [
			"IMM = .immediate_operand(3)",
			"IDX = .x_indexed_operand($10)",
			"ACC = .a_operand()",
			"\tlda IMM",
			"\tlda IDX",
			"\tasl ACC",
			"\tlda .immediate_operand(7)",
			"",
		].join("\n");
		const { bytes, messages } = asm(src);
		expect(messages).toEqual([]);
		// lda #3; lda $10,x; asl a; lda #7
		expect(bytes).toEqual([0xa9, 3, 0xb5, 0x10, 0x0a, 0xa9, 7]);
	});

	test("structural equality dispatches on shape and value", () => {
		const src = [
			"CH = .immediate_operand(0)",
			"SAME = CH = .immediate_operand(0)",
			"OTHER = CH = .immediate_operand(1)",
			"SHAPE = CH = .x_indexed_operand(0)",
			"REG = .x_operand() = .x_operand()",
			"\tnop",
			"",
		].join("\n");
		const result = assemble(src, "t");
		expect(result.diagnostics).toEqual([]);
		expect(result.symbols.get("SAME")).toBe(1n);
		expect(result.symbols.get("OTHER")).toBe(0n);
		expect(result.symbols.get("SHAPE")).toBe(0n);
		expect(result.symbols.get("REG")).toBe(1n);
	});

	test("different kinds compare unequal, never coerce, never error", () => {
		const src = [
			'NUM_STR = 1 = "one"',
			"PLAIN_OP = 0 = .immediate_operand(0)",
			'NE = 1 != "one"',
			"\tnop",
			"",
		].join("\n");
		const result = assemble(src, "t");
		expect(result.diagnostics).toEqual([]);
		expect(result.symbols.get("NUM_STR")).toBe(0n);
		expect(result.symbols.get("PLAIN_OP")).toBe(0n);
		expect(result.symbols.get("NE")).toBe(1n);
	});

	test("string equality works", () => {
		const result = assemble('OK = .segment() = "OUTPUT"\n\tnop\n', "t");
		expect(result.diagnostics).toEqual([]);
		expect(result.symbols.get("OK")).toBe(1n);
	});

	test("predicates classify shapes and values", () => {
		const src = [
			".macro probe arg",
			"IS_IMM = .is_immediate_operand(arg)",
			"IS_SIMPLE = .is_simple_operand(arg)",
			"IS_STR = .is_string(arg)",
			"IS_OP = .is_operand(arg)",
			".endmacro",
			'probe "hello"',
			"\tnop",
			"",
		].join("\n");
		const result = assemble(src, "t");
		expect(result.diagnostics).toEqual([]);
		// A bare string argument splices as a plain expression: simple, a
		// string, not an operand.
		const get = (name: string) =>
			[...result.definitions].find(([k]) => k.includes(name))?.[1].value;
		expect(get("IS_IMM")).toBe(0n);
		expect(get("IS_SIMPLE")).toBe(1n);
		expect(get("IS_STR")).toBe(1n);
		expect(get("IS_OP")).toBe(0n);
	});

	test(".operand_value unwraps; registers wrap nothing", () => {
		const src = [
			"V = .operand_value(.immediate_operand(41 + 1))",
			"\tnop",
			"",
		].join("\n");
		const result = assemble(src, "t");
		expect(result.diagnostics).toEqual([]);
		expect(result.symbols.get("V")).toBe(42n);

		expect(asm("R = .operand_value(.x_operand())\n\tnop\n").messages).toContain(
			"A register operand wraps no value",
		);
		expect(asm("W = .operand_value(3)\n\tnop\n").messages).toContain(
			"`.operand_value` takes an operand value",
		);
	});

	test("register operands parse but no instruction takes them", () => {
		expect(asm("\tldx y\n").messages).toContain(
			"No instruction takes a register operand",
		);
		expect(asm("FOO = .x_operand()\n\tlda FOO\n").messages).toContain(
			"No instruction takes a register operand",
		);
	});

	test("an operand value cannot nest inside a shaped operand", () => {
		expect(asm("FOO = .immediate_operand(3)\n\tlda #FOO\n").messages).toContain(
			"An operand value can only be used as a whole operand",
		);
	});

	test("operand values reject arithmetic", () => {
		expect(asm("BAD = .immediate_operand(3) + 1\n\tnop\n").messages).toContain(
			"Expected a number, got an operand",
		);
	});

	test("forward references defer through constructors and predicates", () => {
		const src = [
			"OP = .immediate_operand(LATER)",
			"CHECK = .is_integer(FWD)",
			"\tlda OP",
			"LATER = 5",
			"FWD = 9",
			"",
		].join("\n");
		const { bytes, messages } = asm(src);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([0xa9, 5]);
	});

	test("the cio store/xio dispatch pattern works", async () => {
		const lib = [
			"ICCOM := $0342, size: 1",
			".macro store channel, dest",
			"\t.if .is_immediate_operand(channel) && .operand_value(channel) = 0",
			"\t\tsta dest",
			"\t.else",
			"\t\tsta dest,x",
			"\t.endif",
			".endmacro",
			".export .macro xio channel, command",
			"\tldx channel",
			"\tlda command",
			"\tstore channel, ICCOM",
			".endmacro",
			"",
		].join("\n");
		const main = ['.import "lib"', "\txio #0, #7", "\txio #$10, #7", ""].join(
			"\n",
		);
		const result = await assemble("main", memHost({ main, lib }));
		expect(result.diagnostics).toEqual([]);
		// #0 channel: ldx #0; lda #7; sta $0342 (absolute, no ,x).
		// #$10 channel: ldx #$10; lda #7; sta $0342,x.
		expect([...result.output]).toEqual([
			0xa2, 0x00, 0xa9, 0x07, 0x8d, 0x42, 0x03, 0xa2, 0x10, 0xa9, 0x07, 0x9d,
			0x42, 0x03,
		]);
	});
});

describe("null", () => {
	test(".null is a value: storable, comparable across kinds, testable", () => {
		const src = [
			"NOTHING = .null",
			"IS = .is_null(NOTHING)",
			"ISNT = .is_null(3)",
			"EQ = NOTHING = .null",
			"CROSS = 3 = .null",
			"\tnop",
			"",
		].join("\n");
		const result = assemble(src, "t");
		expect(result.diagnostics).toEqual([]);
		expect(result.symbols.get("IS")).toBe(1n);
		expect(result.symbols.get("ISNT")).toBe(0n);
		expect(result.symbols.get("EQ")).toBe(1n);
		expect(result.symbols.get("CROSS")).toBe(0n);
	});

	test(".null is rejected as data, arithmetic, and operands", () => {
		expect(asm("\t.byte .null\n").messages).toContain("`.null` is not data");
		expect(asm("BAD = .null + 1\n\tnop\n").messages).toContain(
			"Expected a number, got null",
		);
		expect(asm("N = .null\n\tlda N\n").messages).toContain(
			"Operand must be a number, not null",
		);
	});

	test(".is_null defers on unresolved arguments", () => {
		const src = "CHECK = .is_null(LATER)\nLATER = .null\n\tnop\n";
		const result = assemble(src, "t");
		expect(result.diagnostics).toEqual([]);
		expect(result.symbols.get("CHECK")).toBe(1n);
	});
});

describe("default arguments", () => {
	test("expression-macro defaults fill missing trailing args", () => {
		const src = [
			"SCALE(v, factor = 2) = v * factor",
			"R1 = SCALE(3)",
			"R2 = SCALE(3, 10)",
			"\tnop",
			"",
		].join("\n");
		const result = assemble(src, "t");
		expect(result.diagnostics).toEqual([]);
		expect(result.symbols.get("R1")).toBe(6n);
		expect(result.symbols.get("R2")).toBe(30n);
	});

	test("a function default may reference earlier params and module symbols", () => {
		const src = [
			"BASE = 100",
			"F(p, q = p + BASE) = q",
			"RES = F(1)",
			"\tnop",
			"",
		].join("\n");
		const result = assemble(src, "t");
		expect(result.diagnostics).toEqual([]);
		expect(result.symbols.get("RES")).toBe(101n);
	});

	test("function arity reports a range", () => {
		expect(asm("F(p, q = 1) = p\nRES = F()\n\tnop\n").messages).toContain(
			'"F" expects 1-2 argument(s), got 0',
		);
	});

	test("a required function param cannot follow a defaulted one", () => {
		expect(asm("F(p = 1, q) = p\n\tnop\n").messages).toContain(
			'Parameter "q" without a default follows one with a default',
		);
	});

	test("macro defaults fill in, resolve in the defining module, and accept shapes", async () => {
		const lib = [
			"LIB_BASE = $20",
			".export .macro load val = LIB_BASE, mode = #1",
			"\tlda val",
			"\tldx mode",
			".endmacro",
			"",
		].join("\n");
		const main = [
			'.import "lib"',
			"LIB_BASE = $99 ; a decoy: the default must NOT see this",
			"\tload",
			"\tload $30",
			"",
		].join("\n");
		const result = await assemble("main", memHost({ main, lib }));
		expect(result.diagnostics).toEqual([]);
		// load: lda $20 (zp, lib's LIB_BASE); ldx #1.
		// load $30: lda $30; ldx #1.
		expect([...result.output]).toEqual([
			0xa5, 0x20, 0xa2, 0x01, 0xa5, 0x30, 0xa2, 0x01,
		]);
	});

	test("a macro default may reference earlier params", () => {
		const src = [
			".macro pair lo, hi = lo + 1",
			"\t.byte lo, hi",
			".endmacro",
			"pair 5",
			"pair 5, 9",
			"",
		].join("\n");
		const { bytes, messages } = asm(src);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([5, 6, 5, 9]);
	});

	test("macro default rules: trailing-only, no .out defaults, arity range", () => {
		expect(
			asm(".macro bad p = 1, q\n\tnop\n.endmacro\n\tnop\n").messages,
		).toContain('Parameter "q" without a default follows one with a default');
		expect(
			asm(".macro bad .out o = 1\n\tnop\n.endmacro\n\tnop\n").messages,
		).toContain('`.out` parameter "o" cannot have a default');
		expect(
			asm(".macro two p, q = 1\n\tnop\n.endmacro\ntwo\n").messages,
		).toContain('Macro "two" is missing the argument "p"');
	});

	test("the println pattern: defaulted segment name with a null-style dispatch", async () => {
		const lib = [
			'.export .macro emit_to value, target = "RODATA"',
			"current = .segment()",
			".segment target",
			"\t.byte value",
			".segment current",
			".endmacro",
			"",
		].join("\n");
		const main = [
			'.import "lib"',
			"\t.org $0600",
			"\t.byte 1",
			"\temit_to 7",
			'\temit_to 8, "EXTRA"',
			"\t.byte 2",
			'.emit "RODATA"',
			'.emit "EXTRA"',
			"",
		].join("\n");
		const result = await assemble("main", memHost({ main, lib }));
		expect(result.diagnostics).toEqual([]);
		expect([...result.output]).toEqual([1, 2, 7, 8]);
	});
});

describe("keyword arguments", () => {
	const lib = [
		".export .macro emit v1, aux1 = .null, aux2 = .null, aux3 = .null",
		"\t.byte v1",
		"\t.if aux1 != .null",
		"\t\t.byte aux1",
		"\t.endif",
		"\t.if aux3 != .null",
		"\t\t.byte aux3",
		"\t.endif",
		".endmacro",
		"",
	].join("\n");

	test("keywords skip over defaulted params", async () => {
		const main = [
			'.import "lib"',
			"\temit 1, aux3: 9",
			"\temit 2, aux1: 5, aux3: 6",
			"\temit v1: 3",
			"",
		].join("\n");
		const result = await assemble("main", memHost({ main, lib }));
		expect(result.diagnostics).toEqual([]);
		expect([...result.output]).toEqual([1, 9, 2, 5, 6, 3]);
	});

	test("keyword diagnostics: unknown, duplicate, positional-after, missing", async () => {
		const bad = async (line: string) => {
			const main = `.import "lib"\n${line}\n`;
			const r = await assemble("main", memHost({ main, lib }));
			return r.diagnostics.map((d) => d.message);
		};
		expect(await bad("\temit 1, nope: 2")).toContain(
			'Macro "emit" has no parameter "nope"',
		);
		expect(await bad("\temit 1, v1: 2")).toContain(
			'Argument "v1" is already given',
		);
		expect(await bad("\temit aux1: 2, 1")).toContain(
			"A positional argument cannot follow a keyword argument",
		);
		expect(await bad("\temit aux1: 2")).toContain(
			'Macro "emit" is missing the argument "v1"',
		);
	});

	test("keyword args on a real instruction are rejected", () => {
		expect(asm("\tlda foo: 1\n").messages).toContain(
			"Keyword arguments are for macro calls",
		);
	});

	test("a keyword name references its parameter", async () => {
		const main = '.import "lib"\n\temit 1, aux3: 9\n';
		const result = await assemble("main", memHost({ main, lib }));
		const at = main.indexOf("aux3:");
		const ref = result.references
			.get("main")
			?.find((r) => r.start === at && r.end === at + 4);
		expect(ref?.symbol).toBe("lib\0\0emit\0aux3");
	});

	test("anonymous-label operands still parse next to keywords", () => {
		// `bne :+` must not be mistaken for a keyword arg.
		const src = "\tbne :+\n\tnop\n:\tnop\n";
		const { messages } = asm(src);
		expect(messages).toEqual([]);
	});
});
