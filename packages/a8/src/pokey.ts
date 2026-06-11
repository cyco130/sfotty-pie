import type { Memory } from "@sfotty-pie/sfotty";

export interface PokeyOptions {
	/** Source of the RANDOM register's byte. Defaults to `Math.random`. */
	random?: () => number;
}

// IRQEN/IRQST bits (only the ones modeled so far).
const IRQ_BREAK = 0x80;
const IRQ_KEYBOARD = 0x40;

// SKSTAT bits (active low: 0 = condition present).
const SKSTAT_SHIFT_HELD = 0x08;
const SKSTAT_KEY_HELD = 0x04;

/**
 * POKEY stub. 16 registers mirrored every $10 across $D200-$D2FF. RANDOM and
 * the keyboard-facing registers — KBCODE, the keyboard/Break bits of
 * IRQEN/IRQST, and the key/Shift sense bits of SKSTAT — are modeled;
 * everything else reads back 0.
 *
 * There is no keyboard scan timing yet: key events latch the registers and
 * raise the IRQ line immediately.
 *
 * TODO: audio (AUDF/AUDC/AUDCTL), serial I/O, timers, the remaining IRQ
 * sources, SKCTL (including the keyboard scan/debounce modes), and real scan
 * timing.
 */
export class Pokey implements Memory {
	#random: () => number;

	// IRQST latches are active low (0 = interrupt occurred). An event only
	// latches while its IRQEN bit is set; writing 0 to an IRQEN bit clears the
	// latch.
	#irqen = 0;
	#irqst = 0xff;

	#kbcode = 0xff;
	#keyHeld = false;
	#shiftHeld = false;

	constructor(options: PokeyOptions = {}) {
		this.#random = options.random ?? (() => (Math.random() * 256) | 0);
	}

	/** The IRQ output line (true = asserted). */
	get irq(): boolean {
		return (this.#irqen & ~this.#irqst) !== 0;
	}

	/**
	 * Press a keyboard matrix key. `code` is the full KBCODE byte: the 6-bit
	 * matrix scan code with bit 6 (Shift) and bit 7 (Ctrl) composed by the
	 * caller.
	 */
	keyDown(code: number): void {
		code &= 0xff;

		// With both Ctrl and Shift held, the matrix can't scan the keys with
		// scan codes $00-$07 and $10-$17 (L J ; K + * and V C B X Z, plus
		// Help and F1-F4 on machines that have them). Real hardware doesn't
		// see those presses at all, so neither do we.
		const scan = code & 0x3f;
		if (
			(code & 0xc0) === 0xc0 &&
			(scan <= 0x07 || (scan >= 0x10 && scan <= 0x17))
		) {
			return;
		}

		this.#kbcode = code;
		this.#keyHeld = true;
		if (this.#irqen & IRQ_KEYBOARD) {
			this.#irqst &= ~IRQ_KEYBOARD;
		}
	}

	/** Release the keyboard matrix key (no matrix key is held anymore). */
	keyUp(): void {
		this.#keyHeld = false;
	}

	/** Press the Shift key. Drives the SKSTAT shift sense, nothing else. */
	shiftKeyDown(): void {
		this.#shiftHeld = true;
	}

	/** Release the Shift key. */
	shiftKeyUp(): void {
		this.#shiftHeld = false;
	}

	/**
	 * Press the Break key. There is no key-up: a Break release is not
	 * observable by software.
	 */
	breakKeyDown(): void {
		if (this.#irqen & IRQ_BREAK) {
			this.#irqst &= ~IRQ_BREAK;
		}
	}

	/**
	 * POKEY has no reset pin, so only a power cycle (`cold`) clears it; on a
	 * warm reset the OS reinitializes it in software. The key/Shift held
	 * states reflect physical switches and are left alone either way.
	 */
	reset(cold: boolean): void {
		if (!cold) return;
		this.#irqen = 0;
		this.#irqst = 0xff;
		this.#kbcode = 0xff;
	}

	read(address: number): number {
		switch (address & 0x0f) {
			// KBCODE ($D209): the last latched key code.
			case 0x09:
				return this.#kbcode;
			// RANDOM ($D20A): free-running polynomial counter.
			case 0x0a:
				return this.#random() & 0xff;
			// IRQST ($D20E)
			case 0x0e:
				return this.#irqst;
			// SKSTAT ($D20F): unmodeled bits (serial state etc.) read 1.
			case 0x0f:
				return (
					0xff &
					~(this.#keyHeld ? SKSTAT_KEY_HELD : 0) &
					~(this.#shiftHeld ? SKSTAT_SHIFT_HELD : 0)
				);
			default:
				return 0;
		}
	}

	write(address: number, value: number): void {
		// IRQEN ($D20E): writing 0 to a bit both disables the source and
		// clears its IRQST latch.
		if ((address & 0x0f) === 0x0e) {
			this.#irqen = value & 0xff;
			this.#irqst |= ~value & 0xff;
		}
		// TODO: latch the remaining POKEY registers / drive audio.
	}
}
