import { Signal } from "./signal.ts";

/**
 * One joystick port. The signals carry wire levels from the connector's
 * perspective: `In` flows from the plugged device into the machine, `Out`
 * from the machine to the device. The {@link Atari} constructor creates the
 * connectors (two jacks on the XL/XE, four on the 400/800) and wires them to
 * the PIA and GTIA; devices and hosts only ever touch the connector.
 *
 * All initial values are the unplugged state: direction and trigger lines
 * are pulled up, pot lines never charge.
 */
export class JoystickConnector {
	/**
	 * The direction lines as driven by the device. Bits 1/2/4/8 = up, down,
	 * left, right; wire level, so a bit is 0 when the switch pulls the line
	 * low (pressed) and 1 when released. Idle/unplugged = 0x0f.
	 */
	readonly directionIn = new Signal(0x0f);

	/**
	 * The resolved direction pin levels (the PIA's DDR-aware drive combined
	 * with the device's pull) - what a device that listens on the port sees.
	 */
	readonly directionOut = new Signal(0x0f);

	/** The trigger line level: true = released (pulled up), false = pressed
	 *  (pulled low). */
	readonly triggerIn = new Signal(true);

	/**
	 * Pot (paddle) lines, normalized: 0.0 charges instantly (POT reads 0),
	 * 1.0 never charges within the frame (POT reads its maximum, 228) - the
	 * unplugged state. Not wired yet: POKEY does not scan pots.
	 */
	readonly potAIn = new Signal(1.0);

	/** The second pot line; see {@link potAIn}. */
	readonly potBIn = new Signal(1.0);
}
