import { expect, test } from "vitest";
import { ReadOptions } from "@sfotty-pie/sfotty";
import { Atari } from "./machine.ts";
import { detectOsVectors, textToAtascii } from "./os-traps.ts";

// A minimal OS image with the real one's trap-relevant shape: JMPs at the
// vector rows, a KEYBDV get-byte entry whose routine polls CH in a wait
// loop, and a cold start that JSRs through CIOINV and then reads keys
// forever, storing each returned character at $0600,X. The wait comes in
// the two shapes found in real OSes: a loop re-entering the routine head
// (the stock OSes), or one spinning past it (AltirraOS) - the CH-poll trap
// serves both identically.
function fakeOs(wait: "at-entry" | "past-entry" = "at-entry"): Uint8Array {
	const os = new Uint8Array(16384);
	const put = (address: number, ...bytes: number[]) =>
		os.set(bytes, address - 0xc000);

	put(0xe424, 0xff, 0xe5); // KEYBDV get entry - 1 -> $E600
	put(0xe459, 0x4c, 0x00, 0xe5); // SIOV -> RTS stub
	put(0xe46e, 0x4c, 0x20, 0xe6); // CIOINV -> $E620
	put(0xe474, 0x4c, 0x60, 0xe6); // WARMSV -> spin stub
	put(0xe477, 0x4c, 0x40, 0xe6); // COLDSV -> $E640

	put(0xe500, 0x60); // SIO stub: RTS
	if (wait === "at-entry") {
		put(0xe600, 0xad, 0xfc, 0x02, 0x4c, 0x00, 0xe6); // LDA CH; JMP entry
	} else {
		// A prelude the loop skips: LDA #0, then LDA CH; JMP back past entry.
		put(0xe600, 0xa9, 0x00, 0xad, 0xfc, 0x02, 0x4c, 0x02, 0xe6);
	}
	put(0xe620, 0x60); // CIO init stub: RTS
	// Cold start
	// prettier-ignore
	put(
		0xe640,
		0xa2, 0xff, // LDX #$FF
		0x9a, // TXS
		0xa2, 0x00, // LDX #$00
		0x20, 0x6e, 0xe4, // JSR CIOINV
		// loop:
		0x20, 0x00, 0xe6, // JSR K: get-byte
		0x9d, 0x00, 0x06, // STA $0600,X
		0xe8, // INX
		0x4c, 0x48, 0xe6, // JMP loop
	);
	put(0xe660, 0x4c, 0x60, 0xe6); // warm start: JMP self
	put(0xe6f0, 0x40); // RTI - stray interrupt backstop

	put(0xfffa, 0xf0, 0xe6);
	put(0xfffc, 0x40, 0xe6); // reset -> cold start
	put(0xfffe, 0xf0, 0xe6);
	return os;
}

function machine(wait: "at-entry" | "past-entry" = "at-entry"): Atari {
	return new Atari({ xl: true, os: fakeOs(wait) });
}

function run(m: Atari, cycles: number): void {
	for (let i = 0; i < cycles; i++) m.cycle();
}

function peek(m: Atari, address: number): number {
	return m.mmu.read(address, ReadOptions.PEEK);
}

test("detectOsVectors extracts the JMP targets and the CH poll", () => {
	expect(detectOsVectors(fakeOs())).toEqual({
		warmStart: 0xe660,
		coldStart: 0xe640,
		cioInit: 0xe620,
		keyboardChPoll: 0xe600,
	});
	// The poll can sit past the entry (AltirraOS-style prelude).
	expect(detectOsVectors(fakeOs("past-entry"))?.keyboardChPoll).toBe(0xe602);
});

test("detectOsVectors rejects unrecognized images", () => {
	expect(detectOsVectors(new Uint8Array(16384))).toBeUndefined();
	expect(detectOsVectors(new Uint8Array(8192))).toBeUndefined();

	const broken = fakeOs();
	broken[0xe477 - 0xc000] = 0x60; // COLDSV row is not a JMP
	expect(detectOsVectors(broken)).toBeUndefined();

	const stray = fakeOs();
	stray[0xe478 - 0xc000] = 0x00;
	stray[0xe479 - 0xc000] = 0x40; // COLDSV target outside the OS ROM
	expect(detectOsVectors(stray)).toBeUndefined();

	const noPoll = fakeOs();
	noPoll[0xe601 - 0xc000] = 0xfd; // the K: get-byte reads $02FD, not CH
	expect(detectOsVectors(noPoll)).toBeUndefined();
});

test("textToAtascii maps line endings and drops what has no code", () => {
	expect(textToAtascii('10 PRINT "HI"\n')).toEqual([
		0x31, 0x30, 0x20, 0x50, 0x52, 0x49, 0x4e, 0x54, 0x20, 0x22, 0x48, 0x49,
		0x22, 0x9b,
	]);
	expect(textToAtascii("a\r\nb\rc\nd")).toEqual([
		0x61, 0x9b, 0x62, 0x9b, 0x63, 0x9b, 0x64,
	]);
	// Dropped: backtick and everything outside $20-$7F (tab included).
	expect(textToAtascii("a`b\tcéd")).toEqual([0x61, 0x62, 0x63, 0x64]);
});

test("textToAtascii: ~ toggles inverse video, EOL turns it off", () => {
	expect(textToAtascii("~AB~c")).toEqual([0xc1, 0xc2, 0x63]);
	expect(textToAtascii("~A\nB")).toEqual([0xc1, 0x9b, 0x42]);
});

test("textToAtascii: {ddd} and {$hh} emit bytes", () => {
	expect(textToAtascii("{65}{$41}{0}")).toEqual([0x41, 0x41, 0x00]);
	// Escapes are raw bytes - inverse video does not apply.
	expect(textToAtascii("~{65}A")).toEqual([0x41, 0xc1]);
	// A brace that is not a well-formed escape emits as-is.
	expect(textToAtascii("{999}")).toEqual([0x7b, 0x39, 0x39, 0x39, 0x1b, 0x7d]);
	expect(textToAtascii("{}")).toEqual([0x7b, 0x1b, 0x7d]);
});

test("textToAtascii: control codes get an ESC prefix, except EOL", () => {
	// Clear screen, backspace, tab - literal or escaped - display as glyphs.
	expect(textToAtascii("}")).toEqual([0x1b, 0x7d]);
	expect(textToAtascii("{125}{$7E}{27}")).toEqual([
		0x1b, 0x7d, 0x1b, 0x7e, 0x1b, 0x1b,
	]);
	// The inverse-half controls too; EOL itself stays functional.
	expect(textToAtascii("{$9C}{$FD}{$9B}")).toEqual([
		0x1b, 0x9c, 0x1b, 0xfd, 0x9b,
	]);
});

test("textToAtascii: a glyph map translates Unicode to ATASCII codes", () => {
	const glyphs = new Map([
		["♥", 0x00],
		["ä", 0x0b],
		["↑", 0x1c],
	]);
	// Graphics glyphs emit directly; a control-code glyph gets the ESC
	// prefix; inverse video applies to glyph codes like any other.
	expect(textToAtascii("♥ä↑", glyphs)).toEqual([0x00, 0x0b, 0x1b, 0x1c]);
	expect(textToAtascii("~♥", glyphs)).toEqual([0x80]);
	expect(textToAtascii("♥", undefined)).toEqual([]);
});

test("pasted text is delivered through the K: get-byte trap", () => {
	const m = machine();
	expect(m.pasteSupported).toBe(true);

	// Boot: cold start runs, CIO init returns, the machine spins in the K:
	// get-byte wait with nothing to read.
	run(m, 500);
	expect(peek(m, 0x0600)).toBe(0);

	// Paste while the read is already spinning - the wait loop's next CH
	// poll picks it up without a keypress.
	m.paste("A b\n");
	run(m, 2000);
	expect([
		peek(m, 0x0600),
		peek(m, 0x0601),
		peek(m, 0x0602),
		peek(m, 0x0603),
	]).toEqual([0x41, 0x20, 0x62, 0x9b]);
	expect(peek(m, 0x0604)).toBe(0); // drained: back to spinning
	expect(peek(m, 0x004c)).toBe(1); // DSTAT reports success
	expect(peek(m, 0x02fb)).toBe(0x9b); // ATACHR holds the last character
	expect(m.cpu.Y).toBe(1);
});

test("a wait loop that never re-fetches the entry still delivers", () => {
	const m = machine("past-entry");
	run(m, 500); // blocked in the loop at $E602-$E607, past the $E600 entry
	expect(m.cpu.PC).toBeGreaterThanOrEqual(0xe602);
	expect(m.cpu.PC).toBeLessThanOrEqual(0xe607);

	m.paste("A\n");
	run(m, 2000);
	expect([peek(m, 0x0600), peek(m, 0x0601)]).toEqual([0x41, 0x9b]);
});

test("a forced read (ICAX1Z bit 0) stands aside", () => {
	const m = machine();
	run(m, 500);
	m.mmu.write(0x002a, 0x01, ReadOptions.NONE);
	m.paste("A");
	run(m, 2000);
	expect(peek(m, 0x0600)).toBe(0); // not consumed by the forced read

	m.mmu.write(0x002a, 0x00, ReadOptions.NONE);
	run(m, 2000);
	expect(peek(m, 0x0600)).toBe(0x41); // delivered once the flag clears
});

test("a cold start drops queued paste text", () => {
	const m = machine();
	run(m, 500);
	m.paste("XYZ");
	m.console.powerCycle();
	run(m, 2000);
	expect(peek(m, 0x0600)).toBe(0);
	// The reboot is spinning in the K: wait again, not consuming leftovers.
	expect(m.cpu.PC).toBeGreaterThanOrEqual(0xe600);
	expect(m.cpu.PC).toBeLessThanOrEqual(0xe605);
});

test("an unrecognized OS ROM disables paste", () => {
	const m = new Atari({ xl: true, os: new Uint8Array(16384) });
	expect(m.pasteSupported).toBe(false);
	m.paste("hello"); // silently ignored
	m.cancelPaste();
});
