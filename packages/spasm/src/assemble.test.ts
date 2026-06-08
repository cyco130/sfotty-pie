import { describe, test, expect } from "vitest";
import { assemble } from "./assemble.ts";

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
