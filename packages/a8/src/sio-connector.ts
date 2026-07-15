import { Signal } from "./signal.ts";

/**
 * One four-byte SIO command frame, checksum already verified: the bus
 * device ID (D1: is $31 - the OS computes it as DDEVIC + DUNIT - 1), the
 * command byte, and the two auxiliary parameter bytes.
 */
export interface SioCommandFrame {
	device: number;
	command: number;
	aux1: number;
	aux2: number;
}

/** A command's final outcome, after any data frame has been exchanged. */
export type SioCommandResult =
	| { kind: "nak" }
	| {
			/** The Complete byte ($43), then `data` as a data frame if present. */
			kind: "complete";
			data?: Uint8Array;
	  }
	| {
			/**
			 * The Error byte ($45). A command that returns data sends its
			 * data frame even on error, so `data` still goes out if present.
			 */
			kind: "error";
			data?: Uint8Array;
	  };

/**
 * A device's answer to a command frame: a final result right away, or -
 * for commands that take a data frame from the computer (writes) - a
 * `receive` continuation: the command is ACKed, `length` data bytes are
 * collected (the bus checks the trailing checksum), and `then` resolves
 * the final result.
 */
export type SioCommandResponse =
	| SioCommandResult
	| {
			kind: "receive";
			length: number;
			then: (data: Uint8Array) => SioCommandResult;
	  };

/**
 * A peripheral on the SIO bus, speaking the byte-level command protocol
 * (AHRM chapter 9). One implementation answers both fronts: the SIOV trap
 * calls {@link command} directly from the DCB, and the serial bus engine
 * calls it with frames deserialized off the real wire - so a device works
 * with OS-conformant software and custom POKEY-banging loaders alike.
 */
export interface SioDevice {
	/**
	 * Does this device answer this bus ID? Command frames are broadcast;
	 * a device that claims nothing stays silent (the computer times out).
	 */
	respondsTo(deviceId: number): boolean;

	/**
	 * Execute a command frame (already checksum-valid and addressed to
	 * this device). Runs at command-dispatch time on both fronts; the
	 * protocol delays around it belong to the bus, not the device.
	 */
	command(frame: SioCommandFrame): SioCommandResponse;
}

/**
 * The SIO jack: devices attach here, and the bus control lines the PIA
 * drives are readable as wire levels (both active low). The {@link Atari}
 * constructor creates the connector, wires the lines, and attaches the
 * built-in D1: drive; hosts attach further devices.
 */
export class SioConnector {
	/** The command line (PIA CB2): low while a command frame is sent. */
	readonly command = new Signal(true);

	/** The cassette motor control line (PIA CA2): low = motor on. */
	readonly motor = new Signal(true);

	get devices(): readonly SioDevice[] {
		return this.#devices;
	}

	attach(device: SioDevice): void {
		if (!this.#devices.includes(device)) this.#devices.push(device);
	}

	detach(device: SioDevice): void {
		const index = this.#devices.indexOf(device);
		if (index >= 0) this.#devices.splice(index, 1);
	}

	#devices: SioDevice[] = [];
}

/**
 * The SIO carry wrap-around checksum: 8-bit sum with the carry folded
 * back in, over command frames and data frames alike.
 */
export function sioChecksum(bytes: ArrayLike<number>): number {
	let sum = 0;
	for (let i = 0; i < bytes.length; i++) {
		sum += bytes[i]!;
		sum = (sum & 0xff) + (sum >> 8);
	}
	return sum;
}
