import type { ConsoleConnector } from "./console-connector.ts";

/**
 * The console's human-facing controls - the power and Reset switches, the
 * Start/Select/Option buttons, and the LEDs - as a device plugged into the
 * {@link ConsoleConnector}. The device speaks "pressed"/"lit"; the connector
 * speaks wire levels (active low) - the translation lives here and nowhere
 * else. ("Panel" because a bare `Console` would clash with the global
 * console's type.)
 */
export class ConsolePanel {
	readonly #connector: ConsoleConnector;

	constructor(connector: ConsoleConnector) {
		this.#connector = connector;
	}

	/** Power-cycle the machine (a cold reset of every component). */
	powerCycle(): void {
		this.#connector.power.emit();
	}

	/** The Reset key: true = held. */
	get reset(): boolean {
		return this.#connector.reset.value;
	}

	set reset(pressed: boolean) {
		this.#connector.reset.value = pressed;
	}

	/** The Start button: true = pressed. */
	get start(): boolean {
		return !this.#connector.startIn.value;
	}

	set start(pressed: boolean) {
		this.#connector.startIn.value = !pressed;
	}

	/** The Select button: true = pressed. */
	get select(): boolean {
		return !this.#connector.selectIn.value;
	}

	set select(pressed: boolean) {
		this.#connector.selectIn.value = !pressed;
	}

	/** The Option button: true = pressed. */
	get option(): boolean {
		return !this.#connector.optionIn.value;
	}

	set option(pressed: boolean) {
		this.#connector.optionIn.value = !pressed;
	}

	/** LED 1 (1200XL): true = lit (the line pulled low). */
	get led1(): boolean {
		return !this.#connector.led1Out.value;
	}

	/** LED 2 (1200XL): true = lit. */
	get led2(): boolean {
		return !this.#connector.led2Out.value;
	}

	/**
	 * Watch the LEDs; the callback gets the lit states whenever either
	 * changes. Returns the unsubscriber. The signals only fire on real level
	 * changes, so bank-switch noise on the underlying PIA port never reaches
	 * the callback.
	 */
	watchLeds(callback: (led1: boolean, led2: boolean) => void): () => void {
		const notify = (): void => callback(this.led1, this.led2);
		const unwatch1 = this.#connector.led1Out.watch(notify);
		const unwatch2 = this.#connector.led2Out.watch(notify);
		return () => {
			unwatch1();
			unwatch2();
		};
	}
}
