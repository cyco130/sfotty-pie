import { ReadOptions, type Sfotty } from "@sfotty-pie/sfotty";
import type { Atari } from "./machine.ts";
import { SIOV } from "./sio.ts";

/** The OS CIO initialization vector row ($E46E). */
export const CIOINV = 0xe46e;
/** The OS warm-start vector row ($E474). */
export const WARMSV = 0xe474;
/** The OS cold-start vector row ($E477). */
export const COLDSV = 0xe477;
/** The KEYBDV handler table ($E420); entry 2 (+4) is get-byte, stored -1. */
export const KEYBDV = 0xe420;

/**
 * The addresses the OS trap framework anchors to, extracted from a
 * recognized OS ROM by {@link detectOsVectors}. All are JMP *targets* (or
 * the KEYBDV table entry), never the vector rows themselves: hardware reset
 * does not go through the rows on most OS revisions (OS-B's reset vector
 * points straight at the cold-start code; the XL-family reset dispatcher
 * branches or falls through to the warm/cold routines), but every start
 * provably executes the target addresses.
 */
export interface OsVectors {
	/** Warm-start routine (WARMSV's JMP target). */
	warmStart: number;
	/** Cold-start routine (COLDSV's JMP target). */
	coldStart: number;
	/** CIO initialization routine (CIOINV's JMP target). */
	cioInit: number;
	/**
	 * The K: get-byte wait loop's CH poll - the LDA/LDX/LDY $02FC
	 * instruction found by scanning from the KEYBDV get entry. Every
	 * keyboard read passes through it, fresh or already blocked, on every
	 * poll iteration (every checked OS polls with LDA CH at entry + $0B to
	 * + $12), so it is the one address the paste trap needs.
	 */
	keyboardChPoll: number;
}

/**
 * Shape-check an OS ROM image and extract the trap anchors. A recognized OS
 * keeps a JMP at each well-known vector row (SIOV, CIOINV, WARMSV, COLDSV)
 * with its target inside the ROM, and a K: get-byte routine (via the KEYBDV
 * table) that polls CH near its entry - true of every stock Atari OS
 * revision and of the bundled replacement OSes (AltirraOS, Atari++ OS).
 * Anything else is a custom ROM: return undefined and the machine installs
 * no OS-level traps at all, running pure hardware.
 *
 * Checks the ROM image directly, not the live bus - the image is fixed at
 * construction while RAM may be banked over the OS at any given moment.
 */
export function detectOsVectors(os: Uint8Array): OsVectors | undefined {
	const base =
		os.length === 16384 ? 0xc000 : os.length === 10240 ? 0xd800 : undefined;
	if (base === undefined) return undefined;
	const byte = (address: number) => os[address - base]!;
	const word = (address: number) => byte(address) | (byte(address + 1) << 8);
	// A target must land back inside the OS ROM's address space, clear of
	// the $D000-$D7FF hardware window.
	const inRom = (address: number) =>
		address >= base &&
		address <= 0xffff &&
		!(address >= 0xd000 && address <= 0xd7ff);
	const target = (row: number) => {
		const to = word(row + 1);
		return byte(row) === JMP && inRom(to) ? to : undefined;
	};

	const sio = target(SIOV);
	const cioInit = target(CIOINV);
	const warmStart = target(WARMSV);
	const coldStart = target(COLDSV);
	if (
		sio === undefined ||
		cioInit === undefined ||
		warmStart === undefined ||
		coldStart === undefined
	) {
		return undefined;
	}

	// The K: get-byte's CH poll: the first LDA/LDX/LDY $02FC within reach of
	// the entry (see OsVectors.keyboardChPoll).
	const keyboardGet = (word(KEYBDV + 4) + 1) & 0xffff;
	if (!inRom(keyboardGet) || keyboardGet + CH_POLL_SCAN > base + os.length) {
		return undefined;
	}
	for (let offset = 0; offset < CH_POLL_SCAN; offset++) {
		const at = keyboardGet + offset;
		if (
			(byte(at) === LDA_ABS || byte(at) === LDX_ABS || byte(at) === LDY_ABS) &&
			word(at + 1) === CH
		) {
			return { warmStart, coldStart, cioInit, keyboardChPoll: at };
		}
	}
	return undefined;
}

/**
 * Convert host text to the ATASCII the K: handler returns. Line endings
 * (LF, CR, CRLF) become EOL ($9B), which also turns inverse video back
 * off. `~` toggles inverse video: while it is on, characters emit with
 * bit 7 set. `{ddd}` and `{$hh}` escapes emit a byte (0-255); a brace
 * that isn't a well-formed escape emits as-is. The optional `glyphs` map
 * translates Unicode characters to ATASCII codes (the host supplies it -
 * Atari graphics and international-set glyphs). ASCII $20-$7F otherwise
 * passes through, except backtick, which has no ATASCII counterpart;
 * anything else is dropped. Every emitted control code except EOL gets an
 * ESC prefix, so the screen editor displays it instead of performing it.
 */
export function textToAtascii(
	text: string,
	glyphs?: ReadonlyMap<string, number>,
): number[] {
	const out: number[] = [];
	// ESC before a control code makes the screen editor render its glyph
	// rather than perform it; EOL stays functional. The control codes are
	// $1B-$1F and $7D-$7F in both the plain and the inverse ($9B-, $FD-)
	// halves.
	const emit = (code: number) => {
		const low = code & 0x7f;
		if (
			code !== EOL &&
			((low >= 0x1b && low <= 0x1f) || (low >= 0x7d && low <= 0x7f))
		) {
			out.push(ESC);
		}
		out.push(code);
	};
	let inverse = 0;
	for (let i = 0; i < text.length; i++) {
		const char = text[i]!;
		if (char === "\r" || char === "\n") {
			out.push(EOL);
			inverse = 0;
			if (char === "\r" && text[i + 1] === "\n") i++;
			continue;
		}
		if (char === "~") {
			inverse ^= 0x80;
			continue;
		}
		if (char === "{") {
			const escape = BYTE_ESCAPE.exec(text.slice(i));
			if (escape) {
				const body = escape[1]!;
				const value = body.startsWith("$")
					? parseInt(body.slice(1), 16)
					: parseInt(body, 10);
				if (value <= 0xff) {
					emit(value);
					i += escape[0].length - 1;
					continue;
				}
			}
		}
		const glyph = glyphs?.get(char);
		if (glyph !== undefined) {
			emit(glyph | inverse);
			continue;
		}
		const code = char.charCodeAt(0);
		if (code >= 0x20 && code <= 0x7f && code !== BACKTICK) {
			emit(code | inverse);
		}
	}
	return out;
}

// A byte escape: {decimal} or {$hex}, e.g. {125} / {$7D}.
const BYTE_ESCAPE = /^\{(\$[0-9a-f]{1,2}|[0-9]{1,3})\}/i;

export interface OsTrapsOptions {
	machine: Atari;
	cpu: Sfotty;
	vectors: OsVectors;
}

/**
 * The OS-level trap framework: boot milestones and OS-handler traps for a
 * recognized OS ROM (see {@link detectOsVectors}).
 *
 * - The WARMSV/COLDSV target traps observe every start (hardware reset,
 *   software JMP through the vectors) and reset host-side state - today
 *   that's dropping any queued paste text.
 * - The CIOINV target trap is persistent: CIO initialization runs on cold
 *   *and* warm starts (a warm start rebuilds HATABS too - that's why DOS
 *   reset-proofs itself through DOSINI), and each run arms a one-shot trap
 *   at the caller's stacked return address. When that fires, the handler
 *   table is freshly built: the place to install CIO-level traps (the K:
 *   get-byte trap today, an H: handler someday).
 * - The K: paste trap sits on the get-byte wait loop's CH poll instruction
 *   (see {@link OsVectors.keyboardChPoll}) and delivers {@link paste} text:
 *   one ATASCII character per OS keyboard read, into A and ATACHR (the
 *   stock screen editor reads the character back from ATACHR, not A),
 *   substituting an RTS for the poll - the wait loops push nothing, so it
 *   returns straight to the get-byte caller. The real E: handler does the
 *   rest - echo, line editing, tokenizing. Every keyboard read passes
 *   through the poll each iteration, so one trap covers fresh calls and
 *   reads already blocked when the text arrives alike; and because the
 *   poll is replaced before the handler's consume-store, a real key
 *   sitting in CH survives a paste and is processed once the queue drains.
 *
 * Every trap declines unless the OS ROM is mapped: with RAM banked in under
 * the OS, these addresses are the running program's own code.
 */
export class OsTraps {
	constructor(options: OsTrapsOptions) {
		this.#machine = options.machine;
		this.#cpu = options.cpu;
		this.#vectors = options.vectors;
		const machine = this.#machine;
		const osMapped = () => machine.mmu.isOsRomMapped;

		machine.observeExecute(this.#vectors.coldStart, () => {
			if (osMapped()) this.#bootStarted();
		});
		machine.observeExecute(this.#vectors.warmStart, () => {
			if (osMapped()) this.#bootStarted();
		});
		machine.observeExecute(this.#vectors.cioInit, () => {
			if (osMapped()) this.#armCioReady();
		});
	}

	/**
	 * Queue text for delivery through the K: paste trap; see
	 * {@link Atari.paste} for the contract. Returns the byte count queued.
	 */
	paste(text: string, glyphs?: ReadonlyMap<string, number>): number {
		const codes = textToAtascii(text, glyphs);
		for (const code of codes) this.#pasteQueue.push(code);
		return codes.length;
	}

	/** Drop any queued paste text. */
	cancelPaste(): void {
		this.#pasteQueue.length = 0;
	}

	readonly #machine: Atari;
	readonly #cpu: Sfotty;
	readonly #vectors: OsVectors;
	#pasteQueue: number[] = [];
	// A CIOINV run whose return trap hasn't fired yet (don't arm twice).
	#cioArmed = false;
	#keyboardTrapped = false;

	// A start of either temperature is a user-visible fresh slate: whatever
	// was queued belongs to the previous session. Also re-open the CIOINV
	// arming in case a reset interrupted an init before the return fired.
	#bootStarted(): void {
		this.#pasteQueue.length = 0;
		this.#cioArmed = false;
	}

	// CIO initialization has begun: arm a one-shot trap at the address its
	// final RTS will return to, peeked from the stack exactly as RTS will
	// pull it. (If a reset tears the init down first, the stale trap fires
	// on unrelated code eventually - #cioReady is idempotent, so no harm.)
	#armCioReady(): void {
		if (this.#cioArmed) return;
		this.#cioArmed = true;
		const s = this.#cpu.S;
		const lo = this.#peek(0x0100 | ((s + 1) & 0xff));
		const hi = this.#peek(0x0100 | ((s + 2) & 0xff));
		const ret = ((lo | (hi << 8)) + 1) & 0xffff;
		this.#machine.observeExecute(
			ret,
			() => {
				this.#cioArmed = false;
				this.#cioReady();
			},
			{ once: true },
		);
	}

	// CIO (and HATABS) is freshly initialized - the install point for
	// CIO-level traps. Traps live in the emulator, not in machine RAM, so
	// they only need installing once; future handler installs that write
	// HATABS entries will re-run here on every boot.
	#cioReady(): void {
		if (this.#keyboardTrapped) return;
		this.#keyboardTrapped = true;
		this.#machine.interceptExecute(this.#vectors.keyboardChPoll, () =>
			this.#keyboardGet(),
		);
	}

	// The K: paste trap: return the next pasted character the way the real
	// handler returns a key - ATASCII in A *and* in ATACHR (the stock
	// screen editor reloads the character from ATACHR after the call, not
	// from A), success in Y and DSTAT, flags matching. Substitutes an RTS
	// for the CH poll, back to the caller (E: get-record echoes and edits;
	// K:-direct readers just get the character). A committed opcode fetch
	// can't repeat under a WSYNC stall, so the pop is safe here.
	#keyboardGet(): number | undefined {
		if (!this.#machine.mmu.isOsRomMapped) return undefined;
		if (this.#pasteQueue.length === 0) return undefined;
		// Forced read (ICAX1Z bit 0): the get-byte returns EOL without touching
		// the keyboard. Every checked OS branches off before the CH poll, so
		// this shouldn't fire - kept as a safeguard for the semantic.
		if (this.#peek(ICAX1Z) & 1) return undefined;
		const char = this.#pasteQueue.shift()!;
		const cpu = this.#cpu;
		cpu.A = char;
		cpu.Y = 1;
		cpu.nFlag = false;
		cpu.zFlag = false;
		this.#machine.mmu.write(ATACHR, char, ReadOptions.NONE);
		this.#machine.mmu.write(DSTAT, 1, ReadOptions.NONE);
		return RTS;
	}

	#peek(address: number): number {
		return this.#machine.mmu.read(address, ReadOptions.PEEK);
	}
}

const JMP = 0x4c;
const RTS = 0x60;
const ESC = 0x1b;
const EOL = 0x9b;
const BACKTICK = 0x60; // ATASCII $60 is a glyph (diamond), not backtick
const LDA_ABS = 0xad;
const LDX_ABS = 0xae;
const LDY_ABS = 0xac;

// OS locations the K: trap touches.
const CH = 0x02fc; // the keyboard-IRQ-to-handler hand-off cell the wait polls
const ICAX1Z = 0x2a; // zero-page IOCB AUX1 - bit 0 is forced read
const DSTAT = 0x4c; // display/keyboard handler status
const ATACHR = 0x02fb; // the returned character, as the screen editor reads it

// How far from the get-byte entry the CH poll may sit (every checked OS
// polls at entry + $0B to + $12).
const CH_POLL_SCAN = 0x20;
