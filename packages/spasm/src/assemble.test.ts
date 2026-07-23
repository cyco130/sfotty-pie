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
			'Macro "one" expects 1 argument(s), got 0',
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

	test("a shaped operand argument in expression position is a type error", () => {
		expect(
			asm(".macro bad v\n\t.byte v\n.endmacro\nbad (foo),y\n").messages,
		).toContain(
			'Macro argument "v" has an operand value and can only be used as a whole operand',
		);
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
	test("entries define and resolve via ::", () => {
		const { bytes, symbols, messages } = asm(
			"N = { V: 1, B: 2 }\n.byte N::V, N::B\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([1, 2]);
		expect(symbols.get("N::V")).toBe(1n);
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

	test("an unknown key is an undefined symbol with the full path", () => {
		expect(asm("N = { V: 1 }\n.byte N::NOPE\n").messages).toContain(
			'Undefined symbol "N::NOPE"',
		);
	});

	test("duplicate keys are duplicate definitions", () => {
		expect(asm("N = { V: 1, V: 2 }\n").messages).toContain(
			'Symbol "N::V" is already defined',
		);
	});

	test("the root name is define-once too", () => {
		expect(asm("N = { V: 1 }\nN = 2\n").messages).toContain(
			'Symbol "N" is already defined',
		);
	});

	test("a dictionary is not a value in expression position", () => {
		expect(asm(".byte { V: 1 }\n").messages).toContain(
			"A dictionary literal can only be the right-hand side of a `=` definition",
		);
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

describe("placement attributes", () => {
	test(".sizeof and .attributes()::size read a declared size", () => {
		const { bytes, messages } = asm(
			"BUF := $0600, size: 3\n.byte .sizeof(BUF), .attributes(BUF)::size\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([3, 3]);
	});

	test("an equate defaults to size 1; a label to 0", () => {
		const { bytes, messages } = asm(
			"PORTA := $D300\nstart:\n.byte .sizeof(PORTA), .sizeof(start)\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([1, 0]);
	});

	test("a size may forward-reference", () => {
		const { bytes, messages } = asm(
			"BUF := $0600, size: LEN\nLEN = 2\n.byte .sizeof(BUF)\n",
		);
		expect(messages).toEqual([]);
		expect(bytes).toEqual([2]);
	});

	test("constants have no attributes", () => {
		expect(asm("K = 5\n.byte .sizeof(K)\n").messages).toContain(
			'Only labels have attributes - "K" is a constant',
		);
		expect(asm("K = 5, size: 2\n").messages).toContain(
			"Only labels have attributes - use `:=` for an address",
		);
	});

	test("unknown attribute keys error on both sides", () => {
		expect(asm("B := 1, foo: 2\n").messages).toContain(
			'Unknown attribute "foo"',
		);
		expect(asm("B := 1\n.byte .attributes(B)::foo\n").messages).toContain(
			'Unknown attribute "foo"',
		);
	});

	test("a bare .attributes() is not a value", () => {
		expect(asm("B := 1\n.byte .attributes(B)\n").messages).toContain(
			"`.attributes(...)` is a dictionary - access an attribute with `::`",
		);
	});

	test("size must be a non-negative number, set once", () => {
		expect(asm('B := 1, size: "x"\n').messages).toContain(
			"`size:` requires a number",
		);
		expect(asm("B := 1, size: -1\n").messages).toContain(
			"`size:` must not be negative",
		);
		expect(asm("B := 1, size: 2, size: 3\n").messages).toContain(
			'Attribute "size" is already set',
		);
	});

	test("attributes travel through exports and namespaced imports", async () => {
		const host = memHost({
			main:
				'lib = .import "lib"\n.import "lib"\n' +
				".byte .sizeof(BUF), .sizeof(lib::BUF)\n",
			lib: ".export BUF := $0600, size: 3\n",
		});
		const r = await assemble("main", host);
		expect(r.diagnostics.map((d) => d.message)).toEqual([]);
		expect([...r.output]).toEqual([3, 3]);
	});

	test(".sizeof in a macro body is hygienic", async () => {
		const host = memHost({
			main: '.import "lib"\nput\n',
			lib:
				"BUF := $0600, size: 7\n" +
				".export .macro put\n\t.byte .sizeof(BUF)\n.endmacro\n",
		});
		const r = await assemble("main", host);
		expect(r.diagnostics.map((d) => d.message)).toEqual([]);
		expect([...r.output]).toEqual([7]);
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
