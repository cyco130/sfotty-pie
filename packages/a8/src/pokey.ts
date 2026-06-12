import type { Memory } from "@sfotty-pie/sfotty";

// IRQEN/IRQST bits (only the ones modeled so far).
const IRQ_BREAK = 0x80;
const IRQ_KEYBOARD = 0x40;

// SKSTAT bits (active low: 0 = condition present).
const SKSTAT_SHIFT_HELD = 0x08;
const SKSTAT_KEY_HELD = 0x04;

// AUDC bits
const AUDC_VOLUME_ONLY = 0x10;

/**
 * POKEY. 16 registers mirrored every $10 across $D200-$D2FF.
 *
 * Modeled: the four audio channels (AUDF/AUDC/AUDCTL with 16-bit linking and
 * 1.79MHz clocking), the polynomial counters and RANDOM, and the
 * keyboard-facing registers — KBCODE, the keyboard/Break bits of IRQEN/IRQST,
 * and the key/Shift sense bits of SKSTAT.
 *
 * The host clocks the chip by calling {@link cycle} once per machine cycle;
 * the return value is the summed audio output (0-60), for the host to sample
 * and filter as it sees fit.
 *
 * There is no keyboard scan timing yet: key events latch the registers and
 * raise the IRQ line immediately.
 *
 * TODO: timer IRQs, STIMER, serial I/O, high-pass filters, two-tone mode,
 * SKCTL (including init mode and the keyboard scan/debounce modes), exact
 * timer phase/reload behavior (Acid800's POKEY suite), POT scanning, and
 * real keyboard scan timing.
 */
export class Pokey implements Memory {
	// IRQST latches are active low (0 = interrupt occurred). An event only
	// latches while its IRQEN bit is set; writing 0 to an IRQEN bit clears the
	// latch.
	#irqen = 0;
	#irqst = 0xff;

	#kbcode = 0xff;
	#keyHeld = false;
	#shiftHeld = false;

	#audf1 = 0;
	#audf2 = 0;
	#audf3 = 0;
	#audf4 = 0;

	#audc1 = 0;
	#audc2 = 0;
	#audc3 = 0;
	#audc4 = 0;

	#counter1 = 0;
	#counter2 = 0;
	#counter3 = 0;
	#counter4 = 0;

	#out1 = 0;
	#out2 = 0;
	#out3 = 0;
	#out4 = 0;

	// AUDCTL bits
	#usePoly9 = false;
	#fastClock1 = false;
	#fastClock3 = false;
	#link12 = false;
	#link34 = false;
	// TODO: High-pass filter bits (0x04, 0x02)
	#slowDivisor: 28 | 114 = 28;

	#poly4 = new LinearFeedbackShiftRegister(0xc);
	#poly5 = new LinearFeedbackShiftRegister(0x14);
	#poly9 = new LinearFeedbackShiftRegister(0x108);
	#poly17 = new LinearFeedbackShiftRegister(0x10800);

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

		this.#audf1 = this.#audf2 = this.#audf3 = this.#audf4 = 0;
		this.#audc1 = this.#audc2 = this.#audc3 = this.#audc4 = 0;
		this.#counter1 = this.#counter2 = this.#counter3 = this.#counter4 = 0;
		this.#out1 = this.#out2 = this.#out3 = this.#out4 = 0;
		this.#usePoly9 = false;
		this.#fastClock1 = false;
		this.#fastClock3 = false;
		this.#link12 = false;
		this.#link34 = false;
		this.#slowDivisor = 28;
		this.#poly4.reset();
		this.#poly5.reset();
		this.#poly9.reset();
		this.#poly17.reset();
	}

	// Channel output update on a timer countdown: volume-only is handled at
	// mix time; otherwise the 5-bit poly can mask the event, and the channel
	// either toggles (square wave) or samples the selected polynomial.
	#flip(current: number, ctl: number, ch: number): number {
		const MASK_5 = 0x80; // 5-bit poly masks countdowns (0) or doesn't (1)
		if (!(ctl & MASK_5) && (this.#poly5.register & ch) === 0) {
			return current;
		}

		const FLIP = 0x20; // noise (0) or square wave (1)
		if (ctl & FLIP) {
			return 1 - current;
		}

		const USE_POLY_4 = 0x40; // 9/17-bit polynomial (0) or 4-bit (1)
		const p =
			ctl & USE_POLY_4
				? this.#poly4.register & ch
				: this.#usePoly9
					? this.#poly9.register & ch
					: this.#poly17.register & ch;

		return p ? 1 : 0;
	}

	// Periods: 1.79MHz 2-byte timer is N+7 cycles; 1.79MHz 1-byte is N+4;
	// 15KHz/64KHz 1-byte is (N+1)*114 / (N+1)*28.
	// TODO: the hardware counts down from a reload and ticks the slow clocks
	// off *global* dividers with a definite phase — this per-channel
	// count-up model is close but not Acid800-exact.
	/**
	 * Advance the chip one machine cycle. Returns the summed audio output of
	 * the four channels, 0-60 (each channel contributes its 0-15 volume).
	 */
	cycle(): number {
		this.#poly4.cycle();
		this.#poly5.cycle();
		this.#poly9.cycle();
		this.#poly17.cycle();

		const slowDivisor = this.#slowDivisor | 0;

		let out1 = this.#out1 | 0;
		let out2 = this.#out2 | 0;
		let out3 = this.#out3 | 0;
		let out4 = this.#out4 | 0;

		const audc1 = this.#audc1 | 0;
		const audc2 = this.#audc2 | 0;
		const audc3 = this.#audc3 | 0;
		const audc4 = this.#audc4 | 0;

		const audf1 = this.#audf1 | 0;
		const audf2 = this.#audf2 | 0;
		const audf3 = this.#audf3 | 0;
		const audf4 = this.#audf4 | 0;

		if (this.#link12) {
			const max = this.#fastClock1
				? audf1 + audf2 * 256 + 7
				: (audf1 + audf2 * 256 + 1) * slowDivisor;

			// Channel 1 only clocks channel 2 in linked mode.
			out1 = 0;
			if (this.#counter2 >= max) {
				this.#counter2 = 0;
				out2 = this.#flip(out2, audc2, 0x80 >> 2);
			}
			this.#counter2++;
		} else {
			const counter1Max = this.#fastClock1
				? audf1 + 4
				: (audf1 + 1) * slowDivisor;

			if (this.#counter1 >= counter1Max) {
				this.#counter1 = 0;
				out1 = this.#flip(out1, audc1, 0x80 >> 1);
			}
			this.#counter1++;

			const counter2Max = (audf2 + 1) * slowDivisor;
			if (this.#counter2 >= counter2Max) {
				this.#counter2 = 0;
				out2 = this.#flip(out2, audc2, 0x80 >> 2);
			}
			this.#counter2++;
		}

		if (this.#link34) {
			const max = this.#fastClock3
				? audf3 + audf4 * 256 + 7
				: (audf3 + audf4 * 256 + 1) * slowDivisor;

			out3 = 0;
			if (this.#counter4 >= max) {
				this.#counter4 = 0;
				out4 = this.#flip(out4, audc4, 0x80 >> 4);
			}
			this.#counter4++;
		} else {
			const counter3Max = this.#fastClock3
				? audf3 + 4
				: (audf3 + 1) * slowDivisor;

			if (this.#counter3 >= counter3Max) {
				this.#counter3 = 0;
				out3 = this.#flip(out3, audc3, 0x80 >> 3);
			}
			this.#counter3++;

			const counter4Max = (audf4 + 1) * slowDivisor;
			if (this.#counter4 >= counter4Max) {
				this.#counter4 = 0;
				out4 = this.#flip(out4, audc4, 0x80 >> 4);
			}
			this.#counter4++;
		}

		this.#out1 = out1;
		this.#out2 = out2;
		this.#out3 = out3;
		this.#out4 = out4;

		// Volume-only channels output their volume constantly, regardless of
		// the timer state.
		let result = 0;
		result += (audc1 & AUDC_VOLUME_ONLY ? 1 : out1) * (audc1 & 15);
		result += (audc2 & AUDC_VOLUME_ONLY ? 1 : out2) * (audc2 & 15);
		result += (audc3 & AUDC_VOLUME_ONLY ? 1 : out3) * (audc3 & 15);
		result += (audc4 & AUDC_VOLUME_ONLY ? 1 : out4) * (audc4 & 15);

		return result;
	}

	read(address: number): number {
		switch (address & 0x0f) {
			// KBCODE ($D209): the last latched key code.
			case 0x09:
				return this.#kbcode;
			// RANDOM ($D20A): the *inverted* high bits of the free-running
			// 17-bit polynomial counter (9-bit with AUDCTL bit 7).
			case 0x0a:
				return (
					~(this.#usePoly9 ? this.#poly9.register : this.#poly17.register) &
					0xff
				);
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
		value &= 0xff;

		switch (address & 0x0f) {
			case 0x00:
				this.#audf1 = value;
				break;
			case 0x01:
				this.#audc1 = value;
				break;
			case 0x02:
				this.#audf2 = value;
				break;
			case 0x03:
				this.#audc2 = value;
				break;
			case 0x04:
				this.#audf3 = value;
				break;
			case 0x05:
				this.#audc3 = value;
				break;
			case 0x06:
				this.#audf4 = value;
				break;
			case 0x07:
				this.#audc4 = value;
				break;
			case 0x08:
				// AUDCTL
				this.#usePoly9 = !!(value & 0x80);
				this.#fastClock1 = !!(value & 0x40);
				this.#fastClock3 = !!(value & 0x20);
				this.#link12 = !!(value & 0x10);
				this.#link34 = !!(value & 0x08);
				this.#slowDivisor = value & 0x01 ? 114 : 28;
				break;
			case 0x0e:
				// IRQEN: writing 0 to a bit both disables the source and
				// clears its IRQST latch.
				this.#irqen = value;
				this.#irqst |= ~value & 0xff;
				break;
		}
	}
}

class LinearFeedbackShiftRegister {
	// The XOR feedback taps: $C for 4-bit, $14 for 5-bit, $108 for 9-bit,
	// $10800 for 17-bit.
	readonly #mask: number;

	// Internal counter state.
	#state = 0x1;

	/**
	 * The output stream's last 8 bits — what the CPU sees through RANDOM and
	 * what the channels sample.
	 */
	register = 0;

	constructor(mask: number) {
		this.#mask = mask;
	}

	reset(): void {
		this.#state = 0x1;
		this.register = 0;
	}

	cycle(): void {
		let state = this.#state | 0;
		const out = state & 1;
		state >>= 1;
		state ^= out * (this.#mask | 0);
		this.register = ((this.register | 0) >> 1) | (out << 7);
		this.#state = state;
	}
}
