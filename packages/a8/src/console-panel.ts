import type { AnticGtia } from "./antic-gtia.ts";
import type { Pia } from "./pia.ts";

/**
 * How the machine wires the panel to itself; supplied by the {@link Atari}
 * constructor. The panel is part of the machine - unlike a joystick port,
 * nothing else ever connected to these wires, so there is no connector layer
 * or pluggable device, just the machine handing its panel the chip ends.
 */
export interface ConsolePanelWiring {
	/** GTIA, whose S0-S2 switch lines the buttons pull low. */
	gtia: AnticGtia;
	/** The PIA carrying the LED lines on PB2/PB3 (low = lit). Physically a
	 *  1200XL feature but wired on every XL/XE - the lines are ordinary port
	 *  pins there. Omitted on the 400/800, where port B belongs to
	 *  joysticks 2/3 and the panel has no LEDs. */
	pia?: Pia;
	/** Drive the Reset key line. Model-specific: the XL/XE system reset line
	 *  soft-resets the components and holds the CPU's RES while pressed; the
	 *  400/800 key is ANTIC's RNMI instead - a software warmstart, nothing
	 *  hardware-reset. */
	setReset: (pressed: boolean) => void;
	/** The power switch: cold-reset every component, the CPU included. */
	powerCycle: () => void;
}

/**
 * The console's human-facing controls - the power and Reset switches, the
 * Start/Select/Option buttons, and the LEDs. Part of the machine (created by
 * the {@link Atari} constructor as `atari.console`); the panel speaks
 * "pressed"/"lit" and translates to wire levels internally. ("Panel" because
 * a bare `Console` would clash with the global console's type.)
 */
export class ConsolePanel {
	constructor(wiring: ConsolePanelWiring) {
		this.#gtia = wiring.gtia;
		this.#pia = wiring.pia;
		this.#setReset = wiring.setReset;
		this.#powerCycle = wiring.powerCycle;
	}

	/** Power-cycle the machine (a cold reset of every component). */
	powerCycle(): void {
		this.#powerCycle();
	}

	/** The Reset key: true = held. */
	get reset(): boolean {
		return this.#resetPressed;
	}

	set reset(pressed: boolean) {
		if (this.#resetPressed === pressed) return;
		this.#resetPressed = pressed;
		this.#setReset(pressed);
	}

	/** The Start button: true = pressed. */
	get start(): boolean {
		return !(this.#gtia.switchesIn.value & 0x01);
	}

	set start(pressed: boolean) {
		this.#setSwitch(0x01, pressed);
	}

	/** The Select button: true = pressed. */
	get select(): boolean {
		return !(this.#gtia.switchesIn.value & 0x02);
	}

	set select(pressed: boolean) {
		this.#setSwitch(0x02, pressed);
	}

	/** The Option button: true = pressed. */
	get option(): boolean {
		return !(this.#gtia.switchesIn.value & 0x04);
	}

	set option(pressed: boolean) {
		this.#setSwitch(0x04, pressed);
	}

	/** LED 1 (1200XL): true = lit (PB2 pulled low). Never lit on machines
	 *  without the LED wires. */
	get led1(): boolean {
		return this.#pia ? !(this.#pia.portbOut.value & 0x04) : false;
	}

	/** LED 2 (1200XL): true = lit (PB3). */
	get led2(): boolean {
		return this.#pia ? !(this.#pia.portbOut.value & 0x08) : false;
	}

	/**
	 * Watch the LEDs; the callback gets the lit states whenever either
	 * changes. Returns the unsubscriber. PORTB changes on every bank switch;
	 * the panel only forwards real LED-level changes.
	 */
	watchLeds(callback: (led1: boolean, led2: boolean) => void): () => void {
		const pia = this.#pia;
		if (!pia) return () => {};
		let last1 = this.led1;
		let last2 = this.led2;
		return pia.portbOut.watch(() => {
			const led1 = this.led1;
			const led2 = this.led2;
			if (led1 === last1 && led2 === last2) return;
			last1 = led1;
			last2 = led2;
			callback(led1, led2);
		});
	}

	// A pressed button pulls its (open-collector) GTIA switch line low.
	#setSwitch(bit: number, pressed: boolean): void {
		const switches = this.#gtia.switchesIn;
		switches.value = pressed ? switches.value & ~bit : switches.value | bit;
	}

	readonly #gtia: AnticGtia;
	readonly #pia: Pia | undefined;
	readonly #setReset: (pressed: boolean) => void;
	readonly #powerCycle: () => void;
	#resetPressed = false;
}
