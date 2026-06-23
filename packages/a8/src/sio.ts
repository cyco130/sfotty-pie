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
 * The trap is a thin translator: each SIO command maps to a method on the
 * {@link AtrImage} medium (read/write a sector, report write-protect and
 * density). Disk behavior lives on the image, not here — so a future real
 * drive (a 1050/Happy with its own 6507 running the protocol on the wire)
 * could slot in behind `getDisk` without rewriting this trap; it'd be a
 * separate subsystem, not a refactor of it.
 *
 * The handler is idempotent by design — a WSYNC stall can repeat the trapped
 * fetch (re-running a write just replays the same bytes to the same sector).
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
				// Drive status: write-protect bit when the medium is protected,
				// plus the density bit; FDC status inverted (no error), format
				// timeout.
				return transfer([
					(disk.writeProtected ? 0x08 : 0) |
						(disk.sectorSize === 256 ? 0x20 : 0),
					0xff,
					0xe0,
					0x00,
				]);

			case 0x50:
			case 0x57: {
				// Put (no verify) / write (with verify) a sector. With no
				// physical media there's nothing to verify, so both just store
				// the bytes the OS staged in the SIO buffer.
				if (disk.writeProtected) return complete(STATUS_DEVICE_ERROR);
				const sector = peek(DAUX1) | (peek(DAUX2) << 8);
				const data = new Uint8Array(byteCount);
				for (let i = 0; i < byteCount; i++) {
					data[i] = peek((buffer + i) & 0xffff);
				}
				return disk.writeSector(sector, data)
					? complete(STATUS_OK)
					: complete(STATUS_DEVICE_ERROR);
			}

			default:
				return complete(STATUS_NAK);
		}
	};
}
