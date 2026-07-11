import type { AtrImage } from "./atr.ts";
import type {
	SioCommandFrame,
	SioCommandResponse,
	SioDevice,
} from "./sio-connector.ts";

/**
 * An SIO disk drive holding an {@link AtrImage} - the medium keeps all
 * disk behavior (sector layout, write protection); the drive is the
 * protocol personality around it: read/write/put sector and status, on
 * both SIO fronts (the SIOV trap and the real serial bus).
 *
 * With no disk inserted the drive claims nothing, so requests time out
 * exactly like an absent drive - matching how the trap-only SIO behaved.
 *
 * A stock-speed personality: unknown commands (including the $3F
 * high-speed index poll) are NAKed, so high-speed-capable DOSes fall back
 * to the standard rate.
 */
export class DiskDrive implements SioDevice {
	/** `unit` 1-8 = D1:-D8:, claiming bus ID $30 + unit. */
	constructor(unit: number = 1) {
		this.unit = unit;
	}

	readonly unit: number;

	/** The inserted disk; undefined = empty drive (claims no bus ID). */
	disk: AtrImage | undefined;

	respondsTo(deviceId: number): boolean {
		return this.disk !== undefined && deviceId === 0x30 + this.unit;
	}

	command(frame: SioCommandFrame): SioCommandResponse {
		const disk = this.disk;
		if (!disk) return { kind: "nak" };
		const sector = frame.aux1 | (frame.aux2 << 8);

		switch (frame.command) {
			case 0x52: {
				// Read sector.
				const data = disk.readSector(sector);
				return data
					? { kind: "complete", data }
					: { kind: "error", data: new Uint8Array(this.#sectorLength(sector)) };
			}

			case 0x53:
				// Drive status: write-protect bit when the medium is
				// protected, plus the density bit; FDC status inverted (no
				// error), format timeout.
				return {
					kind: "complete",
					data: Uint8Array.of(
						(disk.writeProtected ? 0x08 : 0) |
							(disk.sectorSize === 256 ? 0x20 : 0),
						0xff,
						0xe0,
						0x00,
					),
				};

			case 0x50:
			case 0x57:
				// Put (no verify) / write (with verify) a sector. With no
				// physical media there's nothing to verify, so both store
				// the data frame's bytes.
				return {
					kind: "receive",
					length: this.#sectorLength(sector),
					then: (data) =>
						!disk.writeProtected && disk.writeSector(sector, data)
							? { kind: "complete" }
							: { kind: "error" },
				};

			default:
				return { kind: "nak" };
		}
	}

	// A sector's data-frame length. The stored sector is authoritative
	// (boot sectors are 128 bytes even on double density); out-of-range
	// sectors still need a length so a doomed write's data frame is
	// consumed in step with the sender.
	#sectorLength(sector: number): number {
		const stored = this.disk!.readSector(sector);
		if (stored) return stored.length;
		return sector >= 1 && sector <= 3 ? 128 : this.disk!.sectorSize;
	}
}
