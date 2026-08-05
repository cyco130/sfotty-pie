import type { AtrImage } from "./atr.ts";
import type {
	SioCommandFrame,
	SioCommandResponse,
	SioDevice,
} from "./sio-connector.ts";

/**
 * An SIO disk drive holding an {@link AtrImage} - the medium keeps all
 * disk behavior (sector layout, write protection); the drive is the
 * protocol personality around it: read/write/put sector, status, format,
 * the PERCOM geometry block, and the ultra-speed query
 * ({@link highSpeedIndex}), on both SIO fronts (the SIOV trap and the
 * real serial bus).
 *
 * With no disk inserted the drive claims nothing, so requests time out
 * exactly like an absent drive - matching how the trap-only SIO behaved.
 *
 * Unknown commands are NAKed, so DOSes probing for capabilities fall
 * back gracefully.
 */
export class DiskDrive implements SioDevice {
	/** `unit` 1-8 = D1:-D8:, claiming bus ID $30 + unit. */
	constructor(unit: number = 1) {
		this.unit = unit;
	}

	readonly unit: number;

	/** The inserted disk; undefined = empty drive (claims no bus ID). */
	disk: AtrImage | undefined;

	/**
	 * Ultra-speed capability (US Doubler protocol): the POKEY divisor
	 * returned by the Get High Speed Index ($3F) poll; undefined = a
	 * stock drive that NAKs the poll. Nothing else is needed drive-side:
	 * the protocol rule is that a command frame arriving at the high
	 * rate runs the whole command at that rate, and the bus engine
	 * already follows the command frame's clock. Like the TOMS Turbo -
	 * and unlike most real ultra drives, which alternate receive rates
	 * and rely on command retries - this drive hears every speed at
	 * once, so the first frame is never dropped.
	 *
	 * The default of 6 (the 1050 Turbo's rate, ~69k baud, 3.6x standard)
	 * keeps a margin: SpartaDOS X 4.50 measures clean down to divisor 5
	 * (NTSC) / 4 (PAL) with the display on - its receive loop's real
	 * budget is ~240 cycles per byte, the bus's Complete-to-data lead
	 * gap is what makes hot divisors deliverable at all, and
	 * {@link SioBus.interByteGap} can carry slower guests all the way to
	 * divisor 0. Avoid $0A, the
	 * Happy 1050 signature, which invites Happy $48 commands this drive
	 * NAKs; $10, which some software heuristically reads as "this is an
	 * XF551" and switches to XF551 command framing this drive does not
	 * speak (use $0F or $11 for ~38400); and $40 and up, which collide
	 * with the mode-flag encodings HISIO-family patches use for
	 * non-Ultra drives ($40 XF551, $41 Happy warp, $80 1050 Turbo). See
	 * AHRM table 45 for the rates real drives used.
	 */
	highSpeedIndex: number | undefined = 6;

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
				// protected, plus the density bits (AHRM table 44: D7
				// enhanced, D5 double) - how software detects enhanced
				// density on drives without the PERCOM commands; FDC status
				// inverted (no error), format timeout.
				return {
					kind: "complete",
					data: Uint8Array.of(
						(disk.writeProtected ? 0x08 : 0) |
							(disk.sectorSize === 256 ? 0x20 : 0) |
							(disk.sectorSize === 128 && disk.sectorCount === 1040 ? 0x80 : 0),
						0xff,
						0xe0,
						0x00,
					),
				};

			case 0x3f:
				// Get High Speed Index (US Doubler): a one-byte data frame
				// with the POKEY divisor for high-speed transfers.
				return this.highSpeedIndex === undefined
					? { kind: "nak" }
					: { kind: "complete", data: Uint8Array.of(this.highSpeedIndex) };

			case 0x21:
				// Format: writes a fresh disk to the configured geometry (the
				// last-set PERCOM block, else the mounted disk's own), fills
				// every sector with $00, and returns a sector-sized list of
				// 16-bit bad sector numbers terminated by $FFFF - which for
				// an image medium is always empty (AHRM 10.2/10.3).
				return this.#format(disk, this.#configuredGeometry(disk));

			case 0x22:
				// Format medium density: always enhanced density, ignoring
				// the PERCOM configuration - the 1050's pre-PERCOM path.
				return this.#format(disk, { sectorSize: 128, sectorCount: 1040 });

			case 0x4e:
				// Read PERCOM block: the configured geometry (a set block
				// sticks, like a real drive's config registers), else the
				// mounted image's.
				return {
					kind: "complete",
					data: this.#pendingPercom ?? this.#percomBlock(),
				};

			case 0x4f:
				// Write PERCOM block: stored to steer later format commands.
				// Reads keep reporting the mounted image's geometry only
				// until a block is set.
				return {
					kind: "receive",
					length: 12,
					then: (data) => {
						this.#pendingPercom = Uint8Array.from(data);
						return { kind: "complete" };
					},
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

	// The PERCOM block set by $4F, if any; steers $21 format geometry and
	// is echoed by $4E. Kept until overwritten, like a real drive's config.
	#pendingPercom: Uint8Array | undefined;

	// The geometry a $21 format would produce: decoded from the set PERCOM
	// block (tracks x sectors-per-track x sides, MSB-first fields), else the
	// mounted disk's current shape. Null when the block describes something
	// no disk medium can hold.
	#configuredGeometry(
		disk: AtrImage,
	): { sectorSize: 128 | 256; sectorCount: number } | null {
		const percom = this.#pendingPercom;
		if (percom === undefined) {
			return { sectorSize: disk.sectorSize, sectorCount: disk.sectorCount };
		}
		const tracks = percom[0]!;
		const sectorsPerTrack = (percom[2]! << 8) | percom[3]!;
		const sides = percom[4]! + 1;
		const sectorSize = (percom[6]! << 8) | percom[7]!;
		const sectorCount = tracks * sectorsPerTrack * sides;
		if (
			(sectorSize !== 128 && sectorSize !== 256) ||
			sectorCount < 1 ||
			sectorCount > 0xffff
		) {
			return null;
		}
		return { sectorSize, sectorCount };
	}

	// Perform a format: refuse protected media and impossible geometries
	// with an error frame; otherwise reformat in place and return the empty
	// bad-sector list, sized to the new sector length.
	#format(
		disk: AtrImage,
		geometry: { sectorSize: 128 | 256; sectorCount: number } | null,
	): SioCommandResponse {
		if (disk.writeProtected || geometry === null) {
			const frame = new Uint8Array(disk.sectorSize);
			frame[0] = 0xff;
			frame[1] = 0xff;
			return { kind: "error", data: frame };
		}
		disk.format(geometry.sectorSize, geometry.sectorCount);
		const frame = new Uint8Array(geometry.sectorSize);
		frame[0] = 0xff;
		frame[1] = 0xff;
		return { kind: "complete", data: frame };
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

	// The 12-byte PERCOM block (AHRM table 46; two-byte fields MSB first,
	// a 6809 heritage): the classic physical formats map to their real
	// track layouts, anything else reports the customary single-track
	// geometry for sizes with no physical equivalent. Density is FM only
	// for single density; enhanced (26 sectors/track) and 256-byte
	// formats are MFM.
	#percomBlock(): Uint8Array {
		const { sectorSize, sectorCount } = this.disk!;
		let tracks = 1;
		let sides = 1;
		let sectorsPerTrack = Math.min(sectorCount, 0xffff);
		if (sectorSize === 128 && sectorCount === 720) {
			tracks = 40;
			sectorsPerTrack = 18; // single density
		} else if (sectorSize === 128 && sectorCount === 1040) {
			tracks = 40;
			sectorsPerTrack = 26; // enhanced density
		} else if (sectorSize === 256 && sectorCount === 720) {
			tracks = 40;
			sectorsPerTrack = 18; // double density
		} else if (sectorSize === 256 && sectorCount === 1440) {
			tracks = 40;
			sectorsPerTrack = 18; // double-sided double density (XF551)
			sides = 2;
		}
		const mfm = sectorSize === 256 || sectorsPerTrack === 26;
		return Uint8Array.of(
			tracks,
			0, // step rate (widely ignored by software)
			sectorsPerTrack >> 8,
			sectorsPerTrack & 0xff,
			sides - 1,
			mfm ? 4 : 0,
			sectorSize >> 8,
			sectorSize & 0xff,
			0xff, // drive present
			0, // ACIA (unused)
			0,
			0,
		);
	}
}
