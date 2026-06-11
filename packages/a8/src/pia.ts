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
 * Only enough is modeled to boot: ports, DDRs, and the PORTB output signal.
 * Inputs read back as 1 (pulled up — nothing connected). TODO: interrupts
 * (CA1/CA2/CB1/CB2), joystick/keyboard inputs on PORTA.
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

	read(address: number): number {
		switch (address & 0x03) {
			case 0x00:
				return this.#ctrlA & 0x04
					? this.#readPort(this.#outA, this.#ddrA)
					: this.#ddrA;
			case 0x01:
				return this.#ctrlB & 0x04
					? this.#readPort(this.#outB, this.#ddrB)
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
	// PORTB floats to all-inputs and reads $FF).
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
		this.portbOut.value = this.#readPort(this.#outB, this.#ddrB);
	}
}
