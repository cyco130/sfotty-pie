import { ReadOptions } from "@sfotty-pie/sfotty";
import type { Cartridge } from "./cartridge.ts";
import { Pulse } from "./signal.ts";

/** Options for {@link Rtime8Cartridge}. */
export interface Rtime8Options {
	/** The wall-clock source; injectable for deterministic tests.
	 *  Default: `() => new Date()`. */
	now?: () => Date;
	/** Initial {@link Rtime8Cartridge.offsetMs}. Default 0. */
	offsetMs?: number;
	/** Initial {@link Rtime8Cartridge.portShield}. Default false - the
	 *  hardware-faithful behavior. */
	portShield?: boolean;
}

/**
 * The ICD R-Time 8 (AHRM 8.8): a real-time-clock cartridge with a
 * passthrough slot for another cartridge, its M3002-16PI RTC chip's 16
 * byte-wide locations reachable through one 4-bit-wide read/write port
 * mirrored across $D5B8-$D5BF. Accesses walk the chip's sequence: a write
 * latches a location number, the next two accesses carry that location's
 * data, high nibble first; a read outside a sequence reports status. The
 * board has no ROM and no other decode - everything else forwards to the
 * slot.
 *
 * Read-only for now: locations $0-$6 serve the host's clock (shifted by
 * {@link offsetMs}) in BCD, and writes to them are dropped. The non-time
 * locations $7-$F (week, alarm/timer/control) are battery-backed RAM as far
 * as software can tell, so they store and read back - SpartaDOS's clock
 * driver detects the chip by a write-readback on location $7, so a clock
 * that drops those writes reads as absent.
 *
 * A cartridge that itself decodes $D5B8-$D5BF ({@link
 * Cartridge.hasD5b8ToD5bf}) would fight the clock for the bus on the real
 * pairing; with one in the slot the passthrough goes transparent ({@link
 * rtcActive} false) until it's removed - unless {@link portShield} takes
 * the port for the clock instead.
 */
export class Rtime8Cartridge implements Cartridge {
	constructor(inner?: Cartridge, options?: Rtime8Options) {
		this.inner = inner;
		this.#now = options?.now ?? (() => new Date());
		this.offsetMs = options?.offsetMs ?? 0;
		this.portShield = options?.portShield ?? false;
		this.mappingChanged = inner?.mappingChanged ?? new Pulse();
	}

	/** The cartridge in the passthrough slot, if any. */
	readonly inner: Cartridge | undefined;

	/**
	 * Milliseconds added to the host clock before serving time - the knob a
	 * future write path or save-state restore turns (setting the guest's
	 * clock really means adjusting this; a frozen saved time restores as a
	 * fixed offset). Read-only support leaves it 0.
	 */
	offsetMs: number;

	/**
	 * When true, the clock claims $D5B8-$D5BF exclusively: accesses there
	 * never reach the slotted cartridge, so the clock stays active over a
	 * port-conflicting cartridge instead of suspending itself. No real
	 * passthrough can do this - it's an emulator convenience that lets,
	 * e.g., SpartaDOS X on an Atarimax flash board keep both its ROM and
	 * its clock (the clock driver's A7-set port writes would otherwise
	 * disable the cartridge). The cost: software genuinely addressing the
	 * cartridge through $D5B8-$D5BF misses it - a mirror-decoded banking
	 * alias, or the last 8 bytes of the AST/DCart CCTL ROM windows.
	 */
	portShield: boolean;

	/**
	 * Whether the clock answers its port: false while the slotted cartridge
	 * itself decodes $D5B8-$D5BF, which makes the whole passthrough
	 * transparent - unless {@link portShield} keeps the port for the clock.
	 */
	get rtcActive(): boolean {
		return this.portShield || !this.inner?.hasD5b8ToD5bf;
	}

	get has8000To9fff(): boolean {
		return this.inner?.has8000To9fff ?? false;
	}

	get hasA000ToBfff(): boolean {
		return this.inner?.hasA000ToBfff ?? false;
	}

	/** The clock claims the range - or the slotted cartridge it yields to
	 *  does; true either way. */
	readonly hasD5b8ToD5bf = true;

	/** The slotted cartridge's pulse (the clock itself never remaps). */
	readonly mappingChanged: Pulse;

	reset(cold: boolean): void {
		// Slot only: the clock chip is battery-backed and sees neither the
		// system's reset nor even its power.
		this.inner?.reset(cold);
	}

	pageView(page: number): Uint8Array | null | undefined {
		// Only called for pages inside a claimed ROM area - all the slotted
		// cartridge's ($D5xx never gets a fast page).
		return this.inner?.pageView?.(page);
	}

	read(address: number, options: ReadOptions): number {
		if (this.rtcActive && address >= 0xd5b8 && address <= 0xd5bf) {
			return this.#portRead(!!(options & ReadOptions.PEEK));
		}
		if (this.inner) return this.inner.read(address, options);
		// TODO(floating-bus): an undriven CCTL read; $FF is the XL/XE pull-up.
		return 0xff;
	}

	write(address: number, value: number, options: ReadOptions): void {
		if (this.rtcActive && address >= 0xd5b8 && address <= 0xd5bf) {
			this.#portWrite(value);
			// Shielded, the slot never sees the access. Unshielded, fall
			// through: the write is on the bus for the slotted cartridge too
			// (a compatible one ignores this range by definition).
			if (this.portShield) return;
		}
		this.inner?.write(address, value, options);
	}

	// Where the access sequence stands: 0 = idle, 1 = a location number is
	// latched and the high data nibble is next, 2 = the low nibble is next.
	// A read in idle reports status - 0, never busy - and stays put, which
	// is what makes the AHRM's "two dummy reads" land back in idle from any
	// unknown state.
	#step: 0 | 1 | 2 = 0;
	#reg = 0;
	// The in-flight data byte: on a read sequence, latched whole at the
	// first data read so the two nibbles can't tear across a clock tick
	// (second 9 -> 10 must never read as 00); on a write sequence, the high
	// nibble waiting for the low one.
	#latch = 0;
	// The chip's non-time locations ($7-$F: week, alarm/timer/control).
	// Plain battery-backed RAM as far as software can tell, so written
	// values must persist and read back - SpartaDOS's clock driver detects
	// the R-Time 8 exactly that way, by writing location $7 and comparing
	// the readback. $7 serves the live ISO week until something writes it.
	readonly #ram = new Uint8Array(16);
	#weekWritten = false;

	readonly #now: () => Date;

	// Reads drive bits 0-3 only; 1s fill the top - the XL/XE pull-up value
	// (TODO(floating-bus): on other machines those bits float). The AHRM
	// warns drivers to mask them off either way.
	#portRead(peek: boolean): number {
		let nibble: number;
		if (this.#step === 0) {
			nibble = 0; // status: free
		} else if (this.#step === 1) {
			const byte = this.#locationByte(this.#reg);
			nibble = byte >> 4;
			if (!peek) {
				this.#latch = byte;
				this.#step = 2;
			}
		} else {
			nibble = this.#latch & 0x0f;
			if (!peek) this.#step = 0;
		}
		return 0xf0 | nibble;
	}

	#portWrite(value: number): void {
		if (this.#step === 0) {
			this.#reg = value & 0x0f;
			this.#step = 1;
		} else if (this.#step === 1) {
			this.#latch = (value & 0x0f) << 4;
			this.#step = 2;
		} else {
			this.#storeByte(this.#reg, this.#latch | (value & 0x0f));
			this.#step = 0;
		}
	}

	// Locations $0-$6 hold the time proper and stay host-driven - dropping
	// their writes is what "read-only" means here. $7-$F land in the RAM
	// block (see #ram).
	#storeByte(location: number, byte: number): void {
		if (location < 0x7) return;
		this.#ram[location] = byte;
		if (location === 0x7) this.#weekWritten = true;
	}

	// Locations $0-$7 (the AHRM's table), BCD, from the host clock; the
	// rest from the RAM block.
	#locationByte(location: number): number {
		const t = new Date(this.#now().getTime() + this.offsetMs);
		switch (location) {
			case 0x0:
				return bcd(t.getSeconds());
			case 0x1:
				return bcd(t.getMinutes());
			case 0x2:
				return bcd(t.getHours());
			case 0x3:
				return bcd(t.getDate());
			case 0x4:
				return bcd(t.getMonth() + 1);
			case 0x5:
				return bcd(t.getFullYear() % 100);
			case 0x6:
				return bcd(isoWeekday(t));
			case 0x7:
				return this.#weekWritten ? this.#ram[7]! : bcd(isoWeek(t));
			default:
				return this.#ram[location]!;
		}
	}
}

// The M3002 stores everything as BCD.
function bcd(n: number): number {
	return (Math.floor(n / 10) << 4) | (n % 10);
}

// The chip counts weekdays 1-7 and leaves the assignment to the software;
// ISO's Monday = 1 .. Sunday = 7 is served (no known driver depends on it).
function isoWeekday(t: Date): number {
	return t.getDay() === 0 ? 7 : t.getDay();
}

// ISO 8601 week number (1-53) - the chip's week register's range. A week
// belongs to the year holding its Thursday; UTC arithmetic so DST hops
// can't skew the day counts.
function isoWeek(t: Date): number {
	const thursdayMs =
		Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) +
		(4 - isoWeekday(t)) * 86400000;
	const yearStartMs = Date.UTC(new Date(thursdayMs).getUTCFullYear(), 0, 1);
	return Math.floor((thursdayMs - yearStartMs) / 604800000) + 1;
}
