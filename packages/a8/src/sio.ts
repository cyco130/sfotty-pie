import { ReadOptions, type Sfotty } from "@sfotty-pie/sfotty";
import type { AtrImage } from "./atr.ts";
import type { Atari } from "./machine.ts";

/** The OS SIO entry vector ($E459). */
export const SIOV = 0xe459;

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

export interface SioHandlerOptions {
	machine: Atari;
	cpu: Sfotty;
	/** The disk in SIO drive `unit` (1-based, D1:-D8:); undefined = empty. */
	getDisk: (unit: number) => AtrImage | undefined;
}

/**
 * Create a trap-based SIO: an opcode-fetch trap for the {@link SIOV} vector
 * that performs the request in the host and RTSes back to the caller, so no
 * serial hardware is needed. Register it with `addExecuteTrap(SIOV, ...)` on
 * the machine the CPU runs.
 *
 * This catches everything OS-conformant (the OS boot, DOS, any program going
 * through SIOV/DSKINV). Custom fast loaders that drive POKEY's serial port
 * directly will need real serial emulation instead.
 *
 * Read-only for now: write commands report a device error, and the status
 * command flags the disk as write-protected. The handler is idempotent by
 * design — a WSYNC stall can repeat the trapped fetch.
 */
export function createSioHandler(
	options: SioHandlerOptions,
): (address: number) => number {
	const { machine, cpu, getDisk } = options;

	const peek = (address: number) => machine.read(address, ReadOptions.PEEK);

	// Finish like SIO does: status into DSTATS and Y, N mirroring bit 7,
	// then RTS back to the caller.
	const complete = (status: number): number => {
		machine.write(DSTATS, status, ReadOptions.NONE);
		cpu.Y = status;
		cpu.nFlag = status >= 0x80;
		cpu.zFlag = false;
		return RTS;
	};

	return () => {
		const device = peek(DDEVIC);
		if (device !== 0x31) {
			// Not a disk drive: nothing else lives on the serial bus yet.
			return complete(STATUS_TIMEOUT);
		}

		const disk = getDisk(peek(DUNIT));
		if (!disk) {
			return complete(STATUS_TIMEOUT);
		}

		const buffer = peek(DBUFLO) | (peek(DBUFHI) << 8);
		const byteCount = peek(DBYTLO) | (peek(DBYTHI) << 8);

		const transfer = (data: ArrayLike<number>): number => {
			const length = byteCount ? Math.min(byteCount, data.length) : data.length;
			for (let i = 0; i < length; i++) {
				machine.write((buffer + i) & 0xffff, data[i]!, ReadOptions.NONE);
			}
			return complete(STATUS_OK);
		};

		switch (peek(DCOMND)) {
			case 0x52: {
				// Read sector
				const sector = peek(DAUX1) | (peek(DAUX2) << 8);
				const data = disk.readSector(sector);
				return data ? transfer(data) : complete(STATUS_DEVICE_ERROR);
			}

			case 0x53:
				// Drive status: write-protected (read-only for now), plus the
				// density bit; FDC status inverted (no error), format timeout.
				return transfer([
					0x08 | (disk.sectorSize === 256 ? 0x20 : 0),
					0xff,
					0xe0,
					0x00,
				]);

			case 0x50:
			case 0x57:
				// Write/put sector: read-only for now.
				return complete(STATUS_DEVICE_ERROR);

			default:
				return complete(STATUS_NAK);
		}
	};
}
