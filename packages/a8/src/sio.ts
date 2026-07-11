import { ReadOptions, type Sfotty } from "@sfotty-pie/sfotty";
import type { Atari } from "./machine.ts";
import type { SioDevice } from "./sio-connector.ts";

/** The OS SIO entry vector ($E459). */
export const SIOV = 0xe459;

export interface SioHandlerOptions {
	machine: Atari;
	cpu: Sfotty;
	/** The devices to dispatch to - normally the SIO connector's list. */
	devices: () => readonly SioDevice[];
}

/**
 * Create a trap-based SIO: an opcode-fetch trap for the {@link SIOV} vector
 * that performs the request in the host and RTSes back to the caller, so no
 * serial traffic happens. Register it with `addExecuteTrap(SIOV, ...)` on
 * the machine the CPU runs.
 *
 * This catches everything OS-conformant (the OS boot, DOS, any program going
 * through SIOV/DSKINV) and serves it instantly. Custom fast loaders that
 * drive POKEY's serial port directly bypass it and land on the real bus
 * engine instead - the same attached devices answer both fronts.
 *
 * The trap is the {@link SioDevice} protocol's DCB front end: it computes
 * the bus ID like the OS does (DDEVIC + DUNIT - 1), dispatches the command
 * to the claiming device, feeds a write's data phase from guest memory, and
 * maps the result onto DSTATS/Y.
 *
 * The handler is idempotent by design - a WSYNC stall can repeat the trapped
 * fetch (re-running a write just replays the same bytes to the same sector).
 */
export function createSioHandler(
	options: SioHandlerOptions,
): (address: number) => number {
	const { machine, cpu, devices } = options;

	const peek = (address: number) => machine.mmu.read(address, ReadOptions.PEEK);

	// Finish like SIO does: status into DSTATS and Y, N mirroring bit 7,
	// then RTS back to the caller.
	const complete = (status: number): number => {
		machine.mmu.write(DSTATS, status, ReadOptions.NONE);
		cpu.Y = status;
		cpu.nFlag = status >= 0x80;
		cpu.zFlag = false;
		return RTS;
	};

	return () => {
		const busId = (peek(DDEVIC) + peek(DUNIT) - 1) & 0xff;
		const device = devices().find((d) => d.respondsTo(busId));
		if (!device) {
			return complete(STATUS_TIMEOUT);
		}

		const buffer = peek(DBUFLO) | (peek(DBUFHI) << 8);
		const byteCount = peek(DBYTLO) | (peek(DBYTHI) << 8);

		let response = device.command({
			device: busId,
			command: peek(DCOMND),
			aux1: peek(DAUX1),
			aux2: peek(DAUX2),
		});

		if (response.kind === "receive") {
			// The data phase of a write: the bytes the OS staged in the SIO
			// buffer, at the device's expected length.
			const data = new Uint8Array(response.length);
			for (let i = 0; i < data.length; i++) {
				data[i] = peek((buffer + i) & 0xffff);
			}
			response = response.then(data);
		}

		switch (response.kind) {
			case "complete": {
				const data = response.data;
				if (data) {
					const length = byteCount
						? Math.min(byteCount, data.length)
						: data.length;
					for (let i = 0; i < length; i++) {
						machine.mmu.write(
							(buffer + i) & 0xffff,
							data[i]!,
							ReadOptions.NONE,
						);
					}
				}
				return complete(STATUS_OK);
			}
			case "error":
				// The buffer is left untouched - the OS ignores it on error.
				return complete(STATUS_DEVICE_ERROR);
			case "nak":
				return complete(STATUS_NAK);
		}
	};
}

// The Device Control Block
const DDEVIC = 0x0300;
const DUNIT = 0x0301;
const DCOMND = 0x0302;
const DSTATS = 0x0303;
const DBUFLO = 0x0304;
const DBUFHI = 0x0305;
const DBYTLO = 0x0308;
const DBYTHI = 0x0309;
const DAUX1 = 0x030a;
const DAUX2 = 0x030b;

// SIO status codes
const STATUS_OK = 0x01;
const STATUS_TIMEOUT = 0x8a; // no device responded
const STATUS_NAK = 0x8b; // device refused the command
const STATUS_DEVICE_ERROR = 0x90; // controller reported an error

const RTS = 0x60;
