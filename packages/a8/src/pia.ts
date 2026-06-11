import type { Memory } from "@sfotty-pie/sfotty";
import { Signal } from "./signal.ts";

/**
 * 6520 PIA stub.
 *
 * Two 8-bit ports (A/B). Each port shares one address between its data register
 * and its data-direction register (DDR), selected by bit 2 of the port's
 * control register:
 *
 * ```
 *   $D300  PORTA / DDRA   (PACTL bit 2: 1 = port, 0 = DDR)
 *   $D301  PORTB / DDRB   (PBCTL bit 2: 1 = port, 0 = DDR)
 *   $D302  PACTL
 *   $D303  PBCTL
 * ```
 *
 * On XL/XE, PORTB output controls memory banking — the {@link AtariBus} watches
 * {@link portbOut} for that. On the 800 PORTB is just the second joystick port,
 * so banking is off and `portbOut` is harmless.
 *
 * Modeled: ports, DDRs, input pins (joysticks pull them low), and the PORTB
 * output signal. TODO: interrupts (CA1/CA2/CB1/CB2).
 */
export class Pia implements Memory {
	/** The PORTB output value, as seen by PORTB memory banking on XL/XE. */
	readonly portbOut = new Signal(0xff);

	#outA = 0xff;
	#ddrA = 0x00;
	#ctrlA = 0x00;

	#outB = 0xff;
	#ddrB = 0x00;
	#ctrlB = 0x00;

	// External pin levels (1 = open/pulled up, 0 = pulled low by a switch).
	#inA = 0xff;
	#inB = 0xff;

	/** Drive the port A input pins: joysticks 0 (low nibble) and 1 (high). */
	setInputA(value: number): void {
		this.#inA = value & 0xff;
	}

	/**
	 * Drive the port B input pins: joysticks 2/3 on the 400/800. On XL/XE
	 * nothing external connects to port B; leave it at $FF there.
	 */
	setInputB(value: number): void {
		this.#inB = value & 0xff;
		this.#updatePortbOut();
	}

	read(address: number): number {
		switch (address & 0x03) {
			case 0x00:
				// Port A reads the pins, so an external switch pulls even an
				// output-driven bit low.
				return this.#ctrlA & 0x04
					? this.#readPort(this.#outA, this.#ddrA) & this.#inA
					: this.#ddrA;
			case 0x01:
				// Port B reads the output latch for output bits, pins for inputs.
				return this.#ctrlB & 0x04
					? (this.#outB & this.#ddrB) | (this.#inB & ~this.#ddrB)
					: this.#ddrB;
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
				break;
			case 0x01:
				if (this.#ctrlB & 0x04) this.#outB = value;
				else this.#ddrB = value;
				this.#updatePortbOut();
				break;
			case 0x02:
				this.#ctrlA = value;
				break;
			default:
				this.#ctrlB = value;
				break;
		}
	}

	// The 6520 has a reset pin, so it reinitializes on warm resets too (on
	// XL/XE this is what banks the OS ROM and BASIC back in: DDRB clears, so
	// PORTB floats to all-inputs and reads $FF). The input pins reflect
	// physical switches and are left alone.
	reset(cold: boolean): void {
		void cold;
		this.#outA = this.#outB = 0xff;
		this.#ddrA = this.#ddrB = 0x00;
		this.#ctrlA = this.#ctrlB = 0x00;
		this.#updatePortbOut();
	}

	// Output bits read back the latch; input bits read as 1 (pulled up).
	#readPort(out: number, ddr: number): number {
		return (out & ddr) | (~ddr & 0xff);
	}

	#updatePortbOut(): void {
		// The banking logic sees the pins, external pulls included.
		this.portbOut.value = this.#readPort(this.#outB, this.#ddrB) & this.#inB;
	}
}
