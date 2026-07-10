import { Pulse, Signal } from "./signal.ts";

/**
 * The console controls: not a physical socket but the set of wires between
 * the console shell (power and Reset switches, Start/Select/Option buttons,
 * speaker, LEDs) and the components. The {@link Atari} constructor creates
 * one and wires it; devices and hosts only ever touch the connector.
 *
 * Signals carry wire levels: `In` flows from the console shell into the
 * machine (a pressed button pulls its line low, so false = pressed), `Out`
 * from the machine to the shell. All initial values are the idle power-on
 * state.
 */
export class ConsoleConnector {
	/** The power switch: each emit power-cycles the machine (a cold reset of
	 *  every component, the CPU included). */
	readonly power = new Pulse();

	/**
	 * The Reset key: true = held. On the XL/XE it pulses the system reset
	 * line and holds the CPU's RES until released; on the 400/800 it drives
	 * ANTIC's RNMI instead and nothing is hardware-reset.
	 */
	readonly reset = new Signal(false);

	// The LED lines (PIA PB2/PB3 wire levels; low = lit). Only the 1200XL
	// has the LEDs, but the wires are ordinary PIA port pins on every XL/XE.
	readonly led1In = new Signal(true);
	readonly led2In = new Signal(true);
	readonly led1Out = new Signal(true);
	readonly led2Out = new Signal(true);

	// The console switch lines (GTIA S0-S2) and the speaker line (S3). In =
	// the shell's drive toward GTIA (a pressed button pulls low), Out = the
	// resolved line level. S0-S2 power on pulled low by GTIA's written CONSOL
	// latch; the speaker line powers on high.
	readonly startIn = new Signal(true);
	readonly selectIn = new Signal(true);
	readonly optionIn = new Signal(true);
	readonly speakerIn = new Signal(true);
	readonly startOut = new Signal(false);
	readonly selectOut = new Signal(false);
	readonly optionOut = new Signal(false);
	readonly speakerOut = new Signal(true);
}
