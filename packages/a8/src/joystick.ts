import type { JoystickConnector } from "./joystick-connector.ts";

/**
 * A digital joystick (CX40-style) plugged into a {@link JoystickConnector}.
 * The device speaks "pressed"; the connector speaks wire levels (active low,
 * pulled up when released) - the translation lives here and nowhere else.
 *
 * The hardware can't stop opposite directions being pressed at once;
 * avoiding them is the caller's business.
 */
export class Joystick {
	readonly #connector: JoystickConnector;

	constructor(connector: JoystickConnector) {
		this.#connector = connector;
	}

	/**
	 * The pressed-direction mask: 1 = up, 2 = down, 4 = left, 8 = right;
	 * 0 = centred. Assigning replaces the whole stick position atomically -
	 * for absolute sources (an analog stick reporting a position). Digital
	 * per-direction sources use {@link press}/{@link release}.
	 */
	get direction(): number {
		return ~this.#connector.directionIn.value & 0x0f;
	}

	set direction(mask: number) {
		this.#connector.directionIn.value = ~mask & 0x0f;
	}

	/** Press directions (adds `mask` bits to {@link direction}). */
	press(mask: number): void {
		this.direction = this.direction | (mask & 0x0f);
	}

	/** Release directions (clears `mask` bits from {@link direction}). */
	release(mask: number): void {
		this.direction = this.direction & ~mask;
	}

	/** The trigger button: true = pressed (the wire pulled low). */
	get trigger(): boolean {
		return !this.#connector.triggerIn.value;
	}

	set trigger(pressed: boolean) {
		this.#connector.triggerIn.value = !pressed;
	}
}
