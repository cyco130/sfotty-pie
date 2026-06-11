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

	// External pin levels (1 = open/pulled up, 0 = pulled low by a switch).
	#inA = 0xff;
	#inB = 0xff;

	constructor() {
		this.ca1In.watch((old) => {
			if (this.#activeEdge(old, this.ca1In.value, this.#ctrlA & 0x02)) {
				this.#ctrlA |= 0x80;
				// A read handshake ends on the next active CA1 transition.
				if ((this.#ctrlA & 0x38) === 0x20) {
					this.ca2Out.value = true;
				}
				this.#updateIrqA();
			}
		});

		this.ca2In.watch((old) => {
			if (this.#ctrlA & 0x20) return; // output mode: transitions ignored
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
				}
				this.#updateIrqB();
			}
		});

		this.cb2In.watch((old) => {
			if (this.#ctrlB & 0x20) return;
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

	/** Drive the port A input pins: joysticks 0 (low nibble) and 1 (high). */
	setInputA(value: number): void {
		this.#inA = value & 0xff;
		this.#updatePortaOut();
	}

	/**
	 * Drive the port B input pins: joysticks 2/3 on the 400/800. On XL/XE
	 * nothing external connects to port B; leave it at $FF there.
	 */
	setInputB(value: number): void {
		this.#inB = value & 0xff;
		this.#updatePortbOut();
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
					}
				}
				// Port A reads the pins, so an external switch pulls even an
				// output-driven bit low.
				return this.#readPort(this.#outA, this.#ddrA) & this.#inA;
			case 0x01:
				if (!(this.#ctrlB & 0x04)) {
					return this.#ddrB;
				}
				if (!(options & ReadOptions.PEEK)) {
					this.#ctrlB &= 0x3f;
					this.#updateIrqB();
				}
				// Port B reads the output latch for output bits, pins for inputs.
				return (this.#outB & this.#ddrB) | (this.#inB & ~this.#ddrB);
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
					// CA2 turned output: the IRQ2 status clears, and the
					// manual modes drive the line directly.
					this.#ctrlA &= 0xbf;
					if ((this.#ctrlA & 0x18) === 0x10) this.ca2Out.value = false;
					if ((this.#ctrlA & 0x18) === 0x18) this.ca2Out.value = true;
				}
				// Enable-bit changes take effect immediately, both ways.
				this.#updateIrqA();
				break;
			default:
				this.#ctrlB = (this.#ctrlB & 0xc0) | (value & 0x3f);
				if (this.#ctrlB & 0x20) {
					this.#ctrlB &= 0xbf;
					if ((this.#ctrlB & 0x18) === 0x10) this.cb2Out.value = false;
					if ((this.#ctrlB & 0x18) === 0x18) this.cb2Out.value = true;
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
		this.#updateIrqA();
		this.#updateIrqB();
		this.#updatePortaOut();
		this.#updatePortbOut();
	}

	// Output bits read back the latch; input bits read as 1 (pulled up).
	#readPort(out: number, ddr: number): number {
		return (out & ddr) | (~ddr & 0xff);
	}

	#updatePortaOut(): void {
		this.portaOut.value = this.#readPort(this.#outA, this.#ddrA) & this.#inA;
	}

	#updatePortbOut(): void {
		// The banking logic sees the pins, external pulls included.
		this.portbOut.value = this.#readPort(this.#outB, this.#ddrB) & this.#inB;
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
