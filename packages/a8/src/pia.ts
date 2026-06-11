import { ReadOptions, type Memory } from "@sfotty-pie/sfotty";
import { Signal } from "./signal.ts";

/**
 * 6520 PIA.
 *
 * Two 8-bit ports (A/B), each with a pair of control lines (CA1/CA2 and
 * CB1/CB2) and an IRQ output. Each port shares one address between its data
 * register and its data-direction register (DDR), selected by bit 2 of the
 * port's control register:
 *
 * ```
 *   $D300  PORTA / DDRA   (PACTL bit 2: 1 = port, 0 = DDR)
 *   $D301  PORTB / DDRB   (PBCTL bit 2: 1 = port, 0 = DDR)
 *   $D302  PACTL
 *   $D303  PBCTL
 * ```
 *
 * Control register bits (PACTL shown; PBCTL mirrors it for CB1/CB2):
 *
 * ```
 *   7  (r/o) IRQ1 status: an active CA1 transition was seen
 *   6  (r/o) IRQ2 status: an active CA2 transition was seen (input mode)
 *   5  CA2 direction: 1 = output
 *   4-3  as output: 00 read handshake, 01 read pulse, 10 low, 11 high
 *        as input: bit 4 = active edge (1 = rising), bit 3 = IRQ2 enable
 *   2  1 = data register, 0 = DDR at the port address
 *   1  CA1 active edge (1 = rising)
 *   0  IRQ1 enable
 * ```
 *
 * The status bits latch on active transitions regardless of the enables —
 * the enables only gate the IRQ outputs. Reading the data port clears both
 * status bits. (Port B's strobes fire on data-port *writes* instead of
 * reads, per the chip.)
 *
 * On the Atari: PORTA carries joysticks 0/1, PORTB joysticks 2/3 (400/800)
 * or memory banking (XL/XE — the {@link AtariBus} watches {@link portbOut});
 * the control lines belong to SIO: CA1 = proceed and CB1 = interrupt
 * (inputs), CA2 = motor control and CB2 = command (outputs).
 */
export class Pia implements Memory {
	/**
	 * The port A external input pins (1 = open/pulled up, 0 = pulled low).
	 * On the Atari these are joysticks 0 (low nibble) and 1 (high).
	 */
	readonly portaIn = new Signal(0xff);

	/**
	 * The port B external input pins. On the Atari these are joysticks 2/3
	 * (400/800 only — nothing external connects to port B on XL/XE).
	 */
	readonly portbIn = new Signal(0xff);

	/** The port A pin levels (DDR-aware, external pulls included). */
	readonly portaOut = new Signal(0xff);

	/**
	 * The port B pin levels (DDR-aware, external pulls included). On the
	 * Atari XL/XE this is what PORTB memory banking watches.
	 */
	readonly portbOut = new Signal(0xff);

	// Control line inputs (pulled up when unconnected).
	readonly ca1In = new Signal(true);
	readonly ca2In = new Signal(true);
	readonly cb1In = new Signal(true);
	readonly cb2In = new Signal(true);

	// Control line outputs.
	readonly ca2Out = new Signal(true);
	readonly cb2Out = new Signal(true);

	/** The IRQA output line (true = asserted). */
	irqA = false;
	/** The IRQB output line (true = asserted). */
	irqB = false;

	#outA = 0;
	#ddrA = 0;
	#ctrlA = 0;

	#outB = 0;
	#ddrB = 0;
	#ctrlB = 0;

	// The CA2/CB2 *pin* level (driven in output modes, external in input
	// mode) and the pending-edge latch: a rising pin edge in any output mode
	// except pulse latches it; a falling edge or pulse mode clears it; and
	// entering input mode converts it into the IRQ2 status bit. Pinned by
	// Acid800 pia_irq's transition tables (ported below as unit tests).
	#ca2Pin = true;
	#ca2Pending = false;
	#cb2Pin = true;
	#cb2Pending = false;

	constructor() {
		this.portaIn.watch(() => this.#updatePortaOut());
		this.portbIn.watch(() => this.#updatePortbOut());

		this.ca1In.watch((old) => {
			if (this.#activeEdge(old, this.ca1In.value, this.#ctrlA & 0x02)) {
				this.#ctrlA |= 0x80;
				// A read handshake ends on the next active CA1 transition.
				if ((this.#ctrlA & 0x38) === 0x20) {
					this.ca2Out.value = true;
					this.#ca2OutputEdge();
				}
				this.#updateIrqA();
			}
		});

		this.ca2In.watch((old) => {
			if (this.#ctrlA & 0x20) return; // output mode: the pin is driven
			this.#ca2Pin = this.ca2In.value;
			if (this.#activeEdge(old, this.ca2In.value, this.#ctrlA & 0x10)) {
				this.#ctrlA |= 0x40;
				this.#updateIrqA();
			}
		});

		this.cb1In.watch((old) => {
			if (this.#activeEdge(old, this.cb1In.value, this.#ctrlB & 0x02)) {
				this.#ctrlB |= 0x80;
				// A write handshake ends on the next active CB1 transition.
				if ((this.#ctrlB & 0x38) === 0x20) {
					this.cb2Out.value = true;
					this.#cb2OutputEdge();
				}
				this.#updateIrqB();
			}
		});

		this.cb2In.watch((old) => {
			if (this.#ctrlB & 0x20) return;
			this.#cb2Pin = this.cb2In.value;
			if (this.#activeEdge(old, this.cb2In.value, this.#ctrlB & 0x10)) {
				this.#ctrlB |= 0x40;
				this.#updateIrqB();
			}
		});
	}

	// An active transition: rising when the edge-select bit is set, falling
	// otherwise. (Signal watchers only fire on real changes.)
	#activeEdge(old: boolean, value: boolean, risingSelect: number): boolean {
		return risingSelect ? !old && value : old && !value;
	}

	/**
	 * Advance the strobe timing one machine cycle: ends a one-cycle CA2/CB2
	 * pulse (output mode 01). The Atari OS doesn't use pulse mode, but the
	 * chip is generic — a host that needs it must call this every cycle.
	 */
	cycle(): void {
		if ((this.#ctrlA & 0x38) === 0x28) this.ca2Out.value = true;
		if ((this.#ctrlB & 0x38) === 0x28) this.cb2Out.value = true;
	}

	read(address: number, options: ReadOptions = ReadOptions.NONE): number {
		switch (address & 0x03) {
			case 0x00:
				if (!(this.#ctrlA & 0x04)) {
					return this.#ddrA;
				}
				if (!(options & ReadOptions.PEEK)) {
					// Reading the data port clears both status bits and fires
					// the CA2 read strobes (handshake and pulse modes).
					this.#ctrlA &= 0x3f;
					this.#updateIrqA();
					if ((this.#ctrlA & 0x30) === 0x20) {
						this.ca2Out.value = false;
						this.#ca2OutputEdge();
					}
				}
				// Port A reads the pins, so an external switch pulls even an
				// output-driven bit low.
				return this.#readPort(this.#outA, this.#ddrA) & this.portaIn.value;
			case 0x01:
				if (!(this.#ctrlB & 0x04)) {
					return this.#ddrB;
				}
				if (!(options & ReadOptions.PEEK)) {
					this.#ctrlB &= 0x3f;
					this.#updateIrqB();
				}
				// Port B reads the output latch for output bits, pins for inputs.
				return (this.#outB & this.#ddrB) | (this.portbIn.value & ~this.#ddrB);
			case 0x02:
				return this.#ctrlA;
			default:
				return this.#ctrlB;
		}
	}

	write(address: number, value: number): void {
		switch (address & 0x03) {
			case 0x00:
				if (this.#ctrlA & 0x04) this.#outA = value;
				else this.#ddrA = value;
				this.#updatePortaOut();
				break;
			case 0x01:
				if (this.#ctrlB & 0x04) {
					this.#outB = value;
					// Writing the data port fires the CB2 write strobes.
					if ((this.#ctrlB & 0x30) === 0x20) {
						this.cb2Out.value = false;
						this.#cb2OutputEdge();
					}
				} else {
					this.#ddrB = value;
				}
				this.#updatePortbOut();
				break;
			case 0x02:
				// The status bits are read-only.
				this.#ctrlA = (this.#ctrlA & 0xc0) | (value & 0x3f);
				if (this.#ctrlA & 0x20) {
					// CA2 turned output: the IRQ2 status clears. The manual
					// modes drive the line directly; handshake and pulse
					// idle it high. A rising pin edge latches the pending
					// flag (except under pulse, which also clears it).
					this.#ctrlA &= 0xbf;
					this.ca2Out.value = (this.#ctrlA & 0x18) !== 0x10;
					this.#ca2OutputEdge();
					if ((this.#ctrlA & 0x38) === 0x28) {
						this.#ca2Pending = false;
					}
				} else {
					// CA2 turned input: a pending edge — or a pin snap from
					// the driven level to the pulled-up external line that
					// matches the edge select — becomes the IRQ2 status.
					this.#ca2InputEntry();
				}
				// Enable-bit changes take effect immediately, both ways.
				this.#updateIrqA();
				break;
			default:
				this.#ctrlB = (this.#ctrlB & 0xc0) | (value & 0x3f);
				if (this.#ctrlB & 0x20) {
					this.#ctrlB &= 0xbf;
					this.cb2Out.value = (this.#ctrlB & 0x18) !== 0x10;
					this.#cb2OutputEdge();
					if ((this.#ctrlB & 0x38) === 0x28) {
						this.#cb2Pending = false;
					}
				} else {
					this.#cb2InputEntry();
				}
				this.#updateIrqB();
				break;
		}
	}

	// The 6520 has a reset pin, so it reinitializes on warm resets too: all
	// six registers clear (on XL/XE this is what banks the OS ROM and BASIC
	// back in: DDRB clears, so PORTB floats to all-inputs and reads $FF).
	// The control outputs float back high and the IRQ lines drop. The input
	// pins reflect physical lines and are left alone.
	reset(cold: boolean): void {
		void cold;
		this.#outA = this.#outB = 0;
		this.#ddrA = this.#ddrB = 0;
		this.#ctrlA = this.#ctrlB = 0;
		this.ca2Out.value = true;
		this.cb2Out.value = true;
		this.#ca2Pending = this.#cb2Pending = false;
		this.#ca2Pin = this.ca2In.value; // input mode: the pin is external
		this.#cb2Pin = this.cb2In.value;
		this.#updateIrqA();
		this.#updateIrqB();
		this.#updatePortaOut();
		this.#updatePortbOut();
	}

	// Output bits read back the latch; input bits read as 1 (pulled up).
	#readPort(out: number, ddr: number): number {
		return (out & ddr) | (~ddr & 0xff);
	}

	// Track a CA2 pin change while it is driven: rising edges latch the
	// pending flag (except in pulse mode), falling edges clear it.
	#ca2OutputEdge(): void {
		const pin = this.ca2Out.value;
		if (pin === this.#ca2Pin) return;
		this.#ca2Pin = pin;
		if (pin) {
			if ((this.#ctrlA & 0x38) !== 0x28) this.#ca2Pending = true;
		} else {
			this.#ca2Pending = false;
		}
	}

	#cb2OutputEdge(): void {
		const pin = this.cb2Out.value;
		if (pin === this.#cb2Pin) return;
		this.#cb2Pin = pin;
		if (pin) {
			if ((this.#ctrlB & 0x38) !== 0x28) this.#cb2Pending = true;
		} else {
			this.#cb2Pending = false;
		}
	}

	// Entering input mode: the pin snaps from the driven level to the
	// external line. A pending edge converts to the IRQ2 status
	// unconditionally; the snap itself counts only if it matches the edge
	// select (bit 4).
	#ca2InputEntry(): void {
		const pin = this.ca2In.value;
		if (
			this.#ca2Pending ||
			this.#activeEdge(this.#ca2Pin, pin, this.#ctrlA & 0x10)
		) {
			this.#ctrlA |= 0x40;
		}
		this.#ca2Pending = false;
		this.#ca2Pin = pin;
	}

	#cb2InputEntry(): void {
		const pin = this.cb2In.value;
		if (
			this.#cb2Pending ||
			this.#activeEdge(this.#cb2Pin, pin, this.#ctrlB & 0x10)
		) {
			this.#ctrlB |= 0x40;
		}
		this.#cb2Pending = false;
		this.#cb2Pin = pin;
	}

	#updatePortaOut(): void {
		this.portaOut.value =
			this.#readPort(this.#outA, this.#ddrA) & this.portaIn.value;
	}

	#updatePortbOut(): void {
		// The banking logic sees the pins, external pulls included.
		this.portbOut.value =
			this.#readPort(this.#outB, this.#ddrB) & this.portbIn.value;
	}

	// The enables gate the IRQ outputs: bit 0 for IRQ1, and bit 3 for IRQ2 —
	// the latter only in input mode (bit 6 set, bit 5 clear, bit 3 set).
	#updateIrqA(): void {
		this.irqA =
			!!(this.#ctrlA & 0x80 && this.#ctrlA & 0x01) ||
			(this.#ctrlA & 0x68) === 0x48;
	}

	#updateIrqB(): void {
		this.irqB =
			!!(this.#ctrlB & 0x80 && this.#ctrlB & 0x01) ||
			(this.#ctrlB & 0x68) === 0x48;
	}
}
