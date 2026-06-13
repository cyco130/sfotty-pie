import type { Memory } from "@sfotty-pie/sfotty";
import { DelayLine } from "./delay-line.ts";

// IRQEN/IRQST bits (only the ones modeled so far).
const IRQ_BREAK = 0x80;
const IRQ_KEYBOARD = 0x40;
const IRQ_SEROR = 0x10;
const IRQ_SEROC = 0x08;
const IRQ_TIMER4 = 0x04;
const IRQ_TIMER2 = 0x02;
const IRQ_TIMER1 = 0x01;

// SKSTAT bits (active low: 0 = condition present).
const SKSTAT_SHIFT_HELD = 0x08;
const SKSTAT_KEY_HELD = 0x04;

// AUDC bits
const AUDC_VOLUME_ONLY = 0x10;

// Delay-line ops: the timer fire pipelines (see the comments in `cycle`),
// and the serial transmit-clock edge, which trails its timer's fire by
// two cycles (Acid800 sertiming pins the load two cycles after the fire).
const OP_COMMIT1 = 0x01;
const OP_FIRE1 = 0x02;
const OP_COMMIT3 = 0x04;
const OP_FIRE3 = 0x08;
const OP_FIRE2 = 0x10;
const OP_FIRE4 = 0x20;
const OP_SERIAL_TICK = 0x40;
const OP_TWOTONE_RESYNC = 0x80;

/**
 * POKEY. 16 registers mirrored every $10 across $D200-$D2FF.
 *
 * Modeled: the four audio channels (AUDF/AUDC/AUDCTL with 16-bit linking and
 * 1.79MHz clocking) with cycle-exact timers, STIMER, and timer IRQs; the
 * polynomial counters and RANDOM; SKCTL initialization mode with the two
 * free-running slow clocks; the serial transmitter (SEROUT, the 10-bit
 * shifter clocked by the SKCTL-selected timer, the SEROR latch and SEROC
 * level IRQs, byte delivery via {@link serialOutByte}); and the
 * keyboard-facing registers — KBCODE, the keyboard/Break bits of
 * IRQEN/IRQST, and the key/Shift sense bits of SKSTAT.
 *
 * The host clocks the chip by calling {@link cycle} once per machine cycle;
 * the return value is the summed audio output (0-60), for the host to sample
 * and filter as it sees fit.
 *
 * There is no keyboard scan timing yet: key events latch the registers and
 * raise the IRQ line immediately.
 *
 * TODO: serial input, high-pass filters, SKCTL's keyboard scan/debounce
 * gating, POT scanning, and real keyboard scan timing.
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

	// Timer down-counters, in ticks of each channel's clock domain. AUDF
	// writes only matter at the next reload, like the hardware.
	#counter1 = 0;
	#counter2 = 0;
	#counter3 = 0;
	#counter4 = 0;

	// The two free-running slow clocks; AUDCTL bit 0 picks which one the
	// slow channels listen to. Each counts down to its next tick. SKCTL
	// init mode holds both in reset; leaving init restarts them at fixed
	// offsets (calibrated against Acid800's inittiming).
	#clock64 = 0;
	#clock15 = 0;

	// SKCTL ($D20F write). Bits 0-1 clear = initialization mode. Power-on
	// biases to init (the chip has no reset line; this is the benign
	// corner of its indeterminate power-up space, and it's what makes
	// RANDOM deterministic from boot).
	#skctl = 0;
	#initMode = true;
	// The cycle carrying the init-entry write still shifts the 9/17-bit
	// poly normally; the ones-fill starts the cycle after (pokey_noise's
	// hot-stop samples sit exactly on this boundary).
	#initFillDelay = false;

	// The timer fire pipelines, as delay-line events. Fast (1.79MHz)
	// unlinked channels: underflow, then 3 cycles later the counter reloads
	// (from the live AUDF — that's the write deadline), and the flip/IRQ
	// lands one cycle after that — deriving the N+4 period, the fire-2 AUDF
	// deadline, and the STIMER preemption boundary, all per Acid800. In
	// 16-bit linked mode the high half fires (and reloads, late) 3 cycles
	// after the underflow.
	#delay = new DelayLine(8);

	// A channel's counter holds still while its fire is in flight; the
	// this-cycle underflow flags resolve the STIMER write race.
	#inFlight1 = false;
	#inFlight2 = false;
	#inFlight3 = false;
	#inFlight4 = false;
	#underflowed1 = false;
	#underflowed3 = false;

	// Reloads sample AUDF one cycle behind the CPU's view: a write landing
	// two cycles before a fire still affects its reload, one cycle before
	// doesn't (Acid800's 22c/23c change tests).
	#shadowAudf1 = 0;
	#shadowAudf2 = 0;
	#shadowAudf3 = 0;
	#shadowAudf4 = 0;

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
	#poly9 = new PolyCounter(5, 9);
	#poly17 = new PolyCounter(5, 17);

	// Serial output. A byte written to SEROUT waits in the holding register
	// until the 10-bit shifter (start + 8 data + stop, LSB first) is empty,
	// then transfers on a transmit-clock edge — raising the SEROR IRQ. The
	// transmit clock is the selected timer's fire, two fires per bit (the
	// output square wave's two edges). Init mode halts the shifter but
	// does not clear it (Acid800 timertiming relies on pushing a byte
	// through to reset the output state).
	#serout: number | null = null; // holding register
	#shiftData = 0; // remaining bits, next-out in bit 0
	#shiftBitsLeft = 0; // 0 = shifter empty (SEROC's level)
	#serialOutBit = 1; // the output data bit; idles at mark
	#serialHalfBit = false; // divide-by-two phase within a bit cell

	/**
	 * Host hook: called with each fully shifted-out byte. Bytes are
	 * delivered at the end of their stop bit. (A callback rather than a
	 * Signal: bytes are events, and repeated values must still notify.)
	 */
	serialOutByte: ((byte: number) => void) | null = null;

	// Two-tone mode (SKCTL bit 3): the serial output line carries an FSK
	// square wave instead of data levels — timer 1's tone for a 1 bit,
	// timer 2's for a 0. A "used" timer fire (timer 2 always; timer 1
	// only while the output data bit is 1 and force break is off) toggles
	// the output flip-flop and resyncs both timers two cycles after the
	// triggering timer's reload. The flip-flop itself isn't modeled until
	// something can observe the line level; the resync is the part the
	// timers (and Acid800) see.
	#twoTone = false;
	#forceBreak = false;

	/** The IRQ output line (true = asserted). */
	get irq(): boolean {
		return (this.#irqen & ~this.#serocLevel(this.#irqst)) !== 0;
	}

	// SEROC (IRQST bit 3) is a level, not a latch: it directly reflects
	// "not shifting" regardless of IRQEN (the enable only gates the IRQ
	// line), and can't be acknowledged while the condition holds (Acid800
	// pokey_seroc pins both the enabled and disabled reads). A byte
	// waiting in the holding register doesn't count — complete stays
	// active until shifting actually starts — and a shifter frozen by a
	// stopped transmit clock or init mode also reads complete (Acid800
	// serclock's external-clock check).
	#serocLevel(irqst: number): number {
		const shifting =
			this.#shiftBitsLeft > 0 && this.#transmitClock !== 0 && !this.#initMode;
		return shifting ? irqst | IRQ_SEROC : irqst & ~IRQ_SEROC;
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
		this.#shadowAudf1 = this.#shadowAudf2 = 0;
		this.#shadowAudf3 = this.#shadowAudf4 = 0;
		this.#clock64 = this.#clock15 = 0;
		this.#skctl = 0;
		this.#initMode = true;
		this.#initFillDelay = false;
		this.#serout = null;
		this.#shiftData = 0;
		this.#shiftBitsLeft = 0;
		this.#serialOutBit = 1;
		this.#serialHalfBit = false;
		this.#twoTone = false;
		this.#forceBreak = false;
		this.#delay.reset();
		this.#inFlight1 = this.#inFlight2 = false;
		this.#inFlight3 = this.#inFlight4 = false;
		this.#underflowed1 = this.#underflowed3 = false;
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

	// An interrupt source fired: the IRQST latch only takes it while the
	// source is enabled.
	#raiseIrq(bit: number): void {
		if (this.#irqen & bit) {
			this.#irqst &= ~bit;
		}
	}

	// The transmit clock source per SKCTL bits 4-6: %11x = timer 2,
	// %01x/%10x = timer 4, %00x = external (no clock — the shifter never
	// advances; Acid800 serclock pins all three).
	get #transmitClock(): 0 | 2 | 4 {
		const mode = (this.#skctl >> 4) & 0x07;
		if (mode >= 6) return 2;
		if (mode >= 2) return 4;
		return 0;
	}

	// A "used" two-tone timer fired: toggle the FSK flip-flop and schedule
	// the timer 1+2 resync — two cycles after the triggering timer's
	// reload, which is fire+1 for the 1.79MHz pipeline and fire+2 for the
	// slow clocks (where the delay is absorbed into the next tick anyway).
	#twoToneFire(fast: boolean): void {
		this.#delay.schedule(fast ? 1 : 2, OP_TWOTONE_RESYNC);
	}

	// Whether timer 1's fires drive the two-tone output: only for a 1
	// data bit, and force break pins the data bit to 0.
	get #twoToneUsesTimer1(): boolean {
		return this.#serialOutBit === 1 && !this.#forceBreak;
	}

	// One transmit-clock edge (the selected timer fired). Two edges per
	// bit cell — the output square wave's halves; the bit-cell phase
	// restarts at each load, which happens on the first edge with the
	// shifter empty and a byte waiting (Acid800 sertiming pins the load
	// to the first clock edge after the SEROUT write).
	#serialClockTick(): void {
		if (this.#shiftBitsLeft > 0) {
			this.#serialHalfBit = !this.#serialHalfBit;
			if (!this.#serialHalfBit) {
				// A full bit boundary: the current bit completes.
				this.#shiftBitsLeft--;
				if (this.#shiftBitsLeft === 0) {
					// The stop bit shipped; the line idles at mark and the
					// byte is done (SEROC's level goes complete).
					this.#serialOutBit = 1;
					this.serialOutByte?.(this.#lastShiftedByte);
				} else {
					this.#serialOutBit = this.#shiftData & 1;
					this.#shiftData >>= 1;
				}
			}
		}

		if (this.#shiftBitsLeft === 0 && this.#serout !== null) {
			// Load: holding register → shifter. The start bit (0) goes out
			// now; SEROR reports the holding register free.
			this.#lastShiftedByte = this.#serout;
			this.#shiftData = this.#serout | 0x100; // data LSB first, stop high
			this.#shiftBitsLeft = 10;
			this.#serialOutBit = 0;
			this.#serialHalfBit = false;
			this.#serout = null;
			this.#raiseIrq(IRQ_SEROR);
		}
	}

	#lastShiftedByte = 0;

	// Reload values, in each channel's clock-domain ticks. The 1.79MHz
	// periods carry the hardware's reload pipeline: N+4 for one byte, N+7
	// linked; the slow clocks tick whole periods of N+1.
	// Slow-clock reloads (the fast paths reload inside their pipelines).
	#reload1(): number {
		return this.#shadowAudf1 + 1;
	}

	#reload2(): number {
		return this.#shadowAudf2 + 1;
	}

	#reload12(): number {
		const n = this.#shadowAudf1 + this.#shadowAudf2 * 256;
		return this.#fastClock1 ? n + 7 : n + 1;
	}

	#reload3(): number {
		return this.#shadowAudf3 + 1;
	}

	#reload4(): number {
		return this.#shadowAudf4 + 1;
	}

	#reload34(): number {
		const n = this.#shadowAudf3 + this.#shadowAudf4 * 256;
		return this.#fastClock3 ? n + 7 : n + 1;
	}

	/**
	 * Advance the chip one machine cycle. Returns the summed audio output of
	 * the four channels, 0-60 (each channel contributes its 0-15 volume).
	 */
	cycle(): number {
		// Init mode holds the polynomial counters and both slow clocks in
		// reset. The 1.79MHz channels run on — that's the machine clock.
		let slowTick = false;
		if (this.#initMode) {
			if (this.#initFillDelay) {
				this.#initFillDelay = false;
				this.#poly9.cycle();
				this.#poly17.cycle();
			} else {
				this.#poly9.fillCycle();
				this.#poly17.fillCycle();
			}
		} else {
			this.#poly4.cycle();
			this.#poly5.cycle();
			this.#poly9.cycle();
			this.#poly17.cycle();

			if (--this.#clock64 <= 0) {
				this.#clock64 = 28;
				if (this.#slowDivisor === 28) slowTick = true;
			}
			if (--this.#clock15 <= 0) {
				this.#clock15 = 114;
				if (this.#slowDivisor === 114) slowTick = true;
			}
		}

		this.#underflowed1 = false;
		this.#underflowed3 = false;

		let due = this.#delay.tick();
		if (due) {
			// The two-tone resync goes first: it preempts a timer 1 fire
			// landing on the resync cycle itself (a fire one cycle earlier
			// survives — Acid800's cancellation tests and the AHRM's
			// "up to one cycle later" rule agree).
			if (due & OP_TWOTONE_RESYNC) {
				due &= ~(OP_COMMIT1 | OP_FIRE1);
				this.#delay.cancel(OP_COMMIT1 | OP_FIRE1);
				this.#inFlight1 = false;
				if (this.#link12) {
					// -1: the channel logic below decrements the fresh
					// counter this same cycle.
					this.#delay.cancel(OP_FIRE2);
					this.#inFlight2 = false;
					this.#counter2 = this.#reload12() - 1;
				} else {
					// Like a timer commit, the resync reads the live AUDF —
					// timertiming pins the same write deadline for both. +1
					// on the fast path because the channel logic below
					// decrements the fresh counter this same cycle.
					this.#counter1 = this.#audf1 + (this.#fastClock1 ? 2 : 1);
					this.#counter2 = this.#audf2 + 1;
				}
			}
			// Commits read the *live* AUDF — that's the write deadline.
			if (due & OP_COMMIT1) {
				this.#counter1 = this.#audf1 + 1;
			}
			if (due & OP_FIRE1) {
				this.#inFlight1 = false;
				this.#out1 = this.#flip(this.#out1, this.#audc1, 0x80 >> 1);
				this.#raiseIrq(IRQ_TIMER1);
				if (this.#twoTone && this.#twoToneUsesTimer1) {
					this.#twoToneFire(true);
				}
			}
			if (due & OP_COMMIT3) {
				this.#counter3 = this.#audf3 + 1;
			}
			if (due & OP_FIRE3) {
				this.#inFlight3 = false;
				this.#out3 = this.#flip(this.#out3, this.#audc3, 0x80 >> 3);
			}
			// The linked high halves fire and reload together — the late
			// reload is why an AUDF write landing just after the underflow
			// still affects the next period ("the late reset from channel
			// 2"). -3 for the late commit, +1 because the channel logic
			// below already decrements the fresh counter this same cycle.
			if (due & OP_SERIAL_TICK && !this.#initMode) {
				this.#serialClockTick();
			}
			if (due & OP_FIRE2) {
				this.#inFlight2 = false;
				this.#out2 = this.#flip(this.#out2, this.#audc2, 0x80 >> 2);
				this.#raiseIrq(IRQ_TIMER2);
				this.#counter2 = this.#reload12() - (this.#fastClock1 ? 2 : 0);
				if (!this.#initMode && this.#transmitClock === 2) {
					this.#delay.schedule(2, OP_SERIAL_TICK);
				}
				if (this.#twoTone) this.#twoToneFire(this.#fastClock1);
			}
			if (due & OP_FIRE4) {
				this.#inFlight4 = false;
				this.#out4 = this.#flip(this.#out4, this.#audc4, 0x80 >> 4);
				this.#raiseIrq(IRQ_TIMER4);
				this.#counter4 = this.#reload34() - (this.#fastClock3 ? 2 : 0);
				if (!this.#initMode && this.#transmitClock === 4) {
					this.#delay.schedule(2, OP_SERIAL_TICK);
				}
			}
		}

		if (this.#link12) {
			// 16-bit: one counter with period N+7 (1.79MHz). The timer 1 IRQ
			// fires on the 16-bit underflow; timer 2 (and the channel 2
			// output) trails it by 3 cycles. Channel 1's own audio output is
			// forced low. Pinned by Acid800's timer-timing asserts — its
			// comment table disagrees with its own asserts here.
			this.#out1 = 0;
			if (!this.#inFlight2 && (this.#fastClock1 || slowTick)) {
				if (--this.#counter2 <= 0) {
					this.#raiseIrq(IRQ_TIMER1);
					this.#inFlight2 = true;
					this.#delay.schedule(3, OP_FIRE2); // reload happens there
				}
			}
		} else {
			if (this.#fastClock1) {
				if (!this.#inFlight1 && --this.#counter1 <= 0) {
					this.#inFlight1 = true;
					this.#underflowed1 = true;
					this.#delay.schedule(3, OP_COMMIT1);
					this.#delay.schedule(4, OP_FIRE1);
				}
			} else if (slowTick && --this.#counter1 <= 0) {
				this.#counter1 = this.#reload1();
				this.#out1 = this.#flip(this.#out1, this.#audc1, 0x80 >> 1);
				this.#raiseIrq(IRQ_TIMER1);
				if (this.#twoTone && this.#twoToneUsesTimer1) {
					this.#twoToneFire(false);
				}
			}
			if (slowTick && --this.#counter2 <= 0) {
				this.#counter2 = this.#reload2();
				this.#out2 = this.#flip(this.#out2, this.#audc2, 0x80 >> 2);
				this.#raiseIrq(IRQ_TIMER2);
				if (this.#transmitClock === 2) {
					this.#delay.schedule(2, OP_SERIAL_TICK);
				}
				if (this.#twoTone) this.#twoToneFire(false);
			}
		}

		if (this.#link34) {
			this.#out3 = 0;
			if (!this.#inFlight4 && (this.#fastClock3 || slowTick)) {
				if (--this.#counter4 <= 0) {
					this.#inFlight4 = true;
					this.#delay.schedule(3, OP_FIRE4); // reload happens there
				}
			}
		} else {
			if (this.#fastClock3) {
				if (!this.#inFlight3 && --this.#counter3 <= 0) {
					this.#inFlight3 = true;
					this.#underflowed3 = true;
					this.#delay.schedule(3, OP_COMMIT3);
					this.#delay.schedule(4, OP_FIRE3);
				}
			} else if (slowTick && --this.#counter3 <= 0) {
				this.#counter3 = this.#reload3();
				this.#out3 = this.#flip(this.#out3, this.#audc3, 0x80 >> 3);
			}
			if (slowTick && --this.#counter4 <= 0) {
				this.#counter4 = this.#reload4();
				this.#out4 = this.#flip(this.#out4, this.#audc4, 0x80 >> 4);
				this.#raiseIrq(IRQ_TIMER4);
				if (this.#transmitClock === 4) {
					this.#delay.schedule(2, OP_SERIAL_TICK);
				}
			}
		}

		this.#shadowAudf1 = this.#audf1;
		this.#shadowAudf2 = this.#audf2;
		this.#shadowAudf3 = this.#audf3;
		this.#shadowAudf4 = this.#audf4;

		const out1 = this.#out1;
		const out2 = this.#out2;
		const out3 = this.#out3;
		const out4 = this.#out4;
		const audc1 = this.#audc1;
		const audc2 = this.#audc2;
		const audc3 = this.#audc3;
		const audc4 = this.#audc4;

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
			// RANDOM ($D20A): the top eight bits of the free-running
			// 17-bit polynomial counter (9-bit with AUDCTL bit 7). Reads
			// $FF while init mode holds the counter in reset.
			case 0x0a:
				return this.#usePoly9 ? this.#poly9.random() : this.#poly17.random();
			// IRQST ($D20E). Bit 3 (SEROC) is composed in as a level.
			case 0x0e:
				return this.#serocLevel(this.#irqst);
			// SKSTAT ($D20F): unmodeled bits (serial state etc.) read 1.
			case 0x0f:
				return (
					0xff &
					~(this.#keyHeld ? SKSTAT_KEY_HELD : 0) &
					~(this.#shiftHeld ? SKSTAT_SHIFT_HELD : 0)
				);
			// Unmapped/unmodeled registers read $FF (Acid800 checks $D20C).
			default:
				return 0xff;
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
			case 0x09: {
				// STIMER: reload all timers from AUDF. On 1.79MHz channels
				// the first fire lands 4 cycles later than the steady N+4
				// period — Acid800's timing table puts it at N+8 after the
				// STIMER write. The output flip-flops reset too: channels
				// 1/2 low, 3/4 high.
				// First fires land at N+8 (8-bit) / N+8 (16-bit) on 1.79MHz
				// channels — one reload-pipeline beat past the steady
				// N+4/N+7 periods.
				this.#counter1 = this.#fastClock1 ? this.#audf1 + 4 : this.#reload1();
				this.#counter2 = this.#link12
					? this.#reload12() + (this.#fastClock1 ? 1 : 0)
					: this.#reload2();
				this.#counter3 = this.#fastClock3 ? this.#audf3 + 4 : this.#reload3();
				this.#counter4 = this.#link34
					? this.#reload34() + (this.#fastClock3 ? 1 : 0)
					: this.#reload4();
				// A STIMER landing on the underflow cycle itself still
				// cancels that fire; one cycle later it's in flight to stay.
				if (this.#underflowed1) {
					this.#delay.cancel(OP_COMMIT1 | OP_FIRE1);
					this.#inFlight1 = false;
				}
				if (this.#underflowed3) {
					this.#delay.cancel(OP_COMMIT3 | OP_FIRE3);
					this.#inFlight3 = false;
				}
				this.#out1 = this.#out2 = 0;
				this.#out3 = this.#out4 = 1;
				break;
			}
			case 0x0d:
				// SEROUT: the holding register. Overwrites any byte still
				// waiting; the transfer to the shifter happens on a
				// transmit-clock edge.
				this.#serout = value;
				break;
			case 0x0e:
				// IRQEN: writing 0 to a bit both disables the source and
				// clears its IRQST latch.
				this.#irqen = value;
				this.#irqst |= ~value & 0xff;
				break;
			case 0x0f: {
				// SKCTL. Clearing bits 0-1 enters initialization mode: the
				// slow clocks and polynomial counters are held in reset
				// (RANDOM locks at $FF). Timers, IRQ state, KBCODE, the
				// audio registers, and the outputs are NOT reset. Leaving
				// init restarts the clocks at fixed offsets — the hardware
				// fires a period-0 timer IRQ 24 (64KHz) / 83 (15KHz)
				// cycles after this write; our offsets carry one extra
				// cycle for the write-to-tick ordering (Acid800
				// inittiming pins all four phase cases).
				// TODO: keyboard scan/debounce gating (bits 0-1).
				const wasInit = this.#initMode;
				this.#skctl = value;
				this.#initMode = (value & 0x03) === 0;
				this.#twoTone = (value & 0x08) !== 0;
				this.#forceBreak = (value & 0x80) !== 0;
				if (this.#initMode) {
					// The 9/17-bit counter is not reset here — it fills
					// gradually, one fillCycle() per machine cycle,
					// starting the cycle after this write. The serial
					// shifter is halted but keeps its contents; only the
					// bit-cell phase resets.
					if (!wasInit) this.#initFillDelay = true;
					this.#poly4.reset();
					this.#poly5.reset();
					this.#serialHalfBit = false;
				} else if (wasInit) {
					this.#initFillDelay = false;
					this.#clock64 = 25;
					this.#clock15 = 84;
				}
				break;
			}
		}
	}
}

/**
 * The 9/17-bit polynomial counter: a right-shifting Fibonacci LFSR with XOR
 * feedback from bit 0 and one tap (bit 5 in both widths — the 17-bit poly
 * is x^17+x^12+1, the 9-bit x^9+x^4+1; both maximal). RANDOM reads the top
 * eight bits uninverted, matching the Altirra Hardware Reference's
 * published 9-bit progression. SKCTL init fills the register with ones
 * from the top (see fillCycle), saturating at all-ones except bit 0 — the
 * all-ones state's predecessor — which both locks RANDOM at $FF and lands
 * Acid800 pokey_noise's post-init samples ($95 and $08) on our
 * exit-write-to-read cycle count.
 */
class PolyCounter {
	#tap: number;
	#top: number;
	#windowShift: number;
	#resetState: number;

	state: number;

	constructor(tap: number, width: number) {
		this.#tap = tap;
		this.#top = width - 1;
		this.#windowShift = width - 8;
		this.#resetState = ((1 << width) - 1) & ~1;
		this.state = this.#resetState;
	}

	cycle(): void {
		const feedback = (this.state ^ (this.state >> this.#tap)) & 1;
		this.state = (this.state >> 1) | (feedback << this.#top);
	}

	/**
	 * One init-mode cycle: ones shift in from the top with bit 0 held low,
	 * saturating at the reset state after `width` cycles. Acid800
	 * pokey_noise's hot-stop samples ($E9/$F0 three cycles into init) pin
	 * this gradual fill — re-entering init does not snap RANDOM to $FF.
	 */
	fillCycle(): void {
		this.state = ((this.state >> 1) | (1 << this.#top)) & ~1;
	}

	/** RANDOM: the register's top eight bits. */
	random(): number {
		return (this.state >> this.#windowShift) & 0xff;
	}

	/** Low bits for the audio channels' noise sampling. */
	get register(): number {
		return this.state & 0xff;
	}

	reset(): void {
		this.state = this.#resetState;
	}
}

class LinearFeedbackShiftRegister {
	// The XOR feedback taps: $C for 4-bit, $14 for 5-bit.
	readonly #mask: number;

	// Internal counter state.
	#state = 0x1;

	/** The output stream's last 8 bits — what the channels sample. */
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
