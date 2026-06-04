import { ReadOptions, type Memory } from "@sfotty-pie/sfotty";

export interface Roms {
	/** OS-B ROM, 10K, mapped at $D800. */
	os: Uint8Array;
	/** BASIC ROM, 8K, mapped at $A000. */
	basic: Uint8Array;
}

/**
 * Atari 800 (NTSC, OS-B) with the BASIC cartridge inserted.
 *
 * Memory map:
 * ```
 *   $0000-$9FFF  RAM
 *   $A000-$BFFF  BASIC ROM        (writes ignored)
 *   $C000-$CFFF  not connected    (reads $FF, writes ignored)
 *   $D000-$D7FF  hardware I/O      (GTIA/POKEY/PIA/ANTIC)
 *   $D800-$FFFF  OS ROM           (writes ignored)
 * ```
 */
export class Atari800 implements Memory {
	// One flat image: RAM in low memory, ROMs loaded at their addresses.
	readonly #mem = new Uint8Array(0x10000);

	/** Master clock in CPU cycles; drives time-based registers like VCOUNT. */
	cycle = 0;

	constructor(roms: Roms) {
		this.#mem.set(roms.basic, 0xa000);
		this.#mem.set(roms.os, 0xd800);
	}

	read(address: number, options: ReadOptions): number {
		if (address >= 0xd000 && address < 0xd800) {
			return this.#readRegister(address, options);
		}
		if (address >= 0xc000 && address < 0xd000) {
			return 0xff; // not connected
		}
		return this.#mem[address]!;
	}

	write(address: number, value: number): void {
		if (address < 0xa000) {
			this.#mem[address] = value; // RAM
		}
		// $A000-$BFFF, $C000-$CFFF, $D800-$FFFF: ROM / unconnected — ignored.
		// $D000-$D7FF: hardware writes — TODO: shim as the boot needs them.
	}

	// Hardware register reads. Only what the boot has needed so far is shimmed;
	// everything else reads back 0 until a stuck loop tells us otherwise.
	#readRegister(address: number, options: ReadOptions): number {
		if ((options & ReadOptions.PEEK) !== 0) return 0; // no side effects

		// GTIA $D000-$D0FF (32 registers, mirrored every $20).
		if (address >= 0xd000 && address < 0xd100 && (address & 0x1f) === 0x1f) {
			// CONSOL: bits 0-2 are START/SELECT/OPTION, 0 = pressed. Report all
			// released, else the OS reads "START held" and boots the cassette.
			return 0x07;
		}

		// POKEY $D200-$D2FF (16 registers, mirrored every $10).
		if (address >= 0xd200 && address < 0xd300 && (address & 0x0f) === 0x0a) {
			return (Math.random() * 256) | 0; // RANDOM
		}

		// ANTIC $D400-$D4FF (16 registers, mirrored every $10).
		if (address >= 0xd400 && address < 0xd500 && (address & 0x0f) === 0x0b) {
			// VCOUNT: scan line / 2 — increments every 2 lines (228 cycles), 0..130.
			return Math.floor(this.cycle / 228) % 131;
		}

		return 0;
	}
}
