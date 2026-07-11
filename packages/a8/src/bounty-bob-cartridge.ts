import { ReadOptions } from "@sfotty-pie/sfotty";
import type { Cartridge } from "./cartridge.ts";
import { Pulse } from "./signal.ts";

/**
 * Bounty Bob Strikes Back (CART type 18) - the one cartridge whose banking
 * doesn't fit the declarative mapping model, because its switch triggers
 * live *inside* the ROM windows:
 *
 * - $8000-$8FFF shows one of four 4K banks (image banks 0-3); an access to
 *   $8FF6-$8FF9 selects the bank by the address's low bits.
 * - $9000-$9FFF shows one of four more (image banks 4-7); $9FF6-$9FF9
 *   select likewise.
 * - $A000-$BFFF is the image's last 8K, fixed.
 *
 * The trigger pages ($8Fxx and $9Fxx) are read-sensitive, so pageView
 * returns undefined for them - the MMU routes every access there through
 * read/write, where the switch happens. A trigger access returns the byte
 * the *outgoing* bank had at that address (the switch is a consequence of
 * the access); PEEKs read without switching.
 */
export class BountyBobCartridge implements Cartridge {
	constructor(rom: Uint8Array) {
		if (rom.length !== 40 * 1024) {
			throw new Error(
				`Bounty Bob cartridge needs a 40K image, got ${rom.length} bytes`,
			);
		}
		this.#rom = rom;
	}

	get has8000To9fff(): boolean {
		return true;
	}

	get hasA000ToBfff(): boolean {
		return true;
	}

	/** See {@link Cartridge.mappingChanged}. */
	readonly mappingChanged = new Pulse();

	reset(cold: boolean): void {
		if (cold && (this.#bankLow !== 0 || this.#bankHigh !== 0)) {
			this.#bankLow = 0;
			this.#bankHigh = 0;
			this.mappingChanged.emit();
		}
	}

	read(address: number, options: ReadOptions): number {
		if (address >= 0xd500 && address <= 0xd5ff) {
			return 0xff; // no control region on this board
		}
		if (address < 0x8000 || address > 0xbfff) {
			throw new Error(`Invalid cartridge memory address ${address}`);
		}
		// The outgoing bank supplies the byte; then the access switches (not
		// on a PEEK - debugger reads must not bank).
		const value = this.#rom[this.#offset(address)]!;
		if (!(options & ReadOptions.PEEK)) {
			this.#trigger(address);
		}
		return value;
	}

	write(address: number, value: number, options: ReadOptions): void {
		void value;
		// Triggers fire on any access, writes included.
		if (
			address >= 0x8000 &&
			address <= 0xbfff &&
			!(options & ReadOptions.PEEK)
		) {
			this.#trigger(address);
		}
	}

	pageView(page: number): Uint8Array | null | undefined {
		// The trigger pages are read-sensitive: no fast path.
		if (page === 0x8f || page === 0x9f) return undefined;
		const offset = this.#offset(page << 8);
		let view = this.#views.get(offset);
		if (!view) {
			view = this.#rom.subarray(offset, offset + 0x100);
			this.#views.set(offset, view);
		}
		return view;
	}

	#rom: Uint8Array;
	#bankLow = 0; // $8000-$8FFF: image bank 0-3
	#bankHigh = 0; // $9000-$9FFF: image bank 4-7, stored as 0-3
	#views = new Map<number, Uint8Array>();

	// The ROM offset the address decodes to under the current banks.
	#offset(address: number): number {
		if (address < 0x9000) {
			return this.#bankLow * 4096 + (address & 0x0fff);
		}
		if (address < 0xa000) {
			return 16384 + this.#bankHigh * 4096 + (address & 0x0fff);
		}
		return 32768 + (address & 0x1fff);
	}

	// Apply a trigger access ($xFF6-$xFF9 in either switching window).
	#trigger(address: number): void {
		const bank = address - 0x0ff6 - (address & 0xf000);
		if (bank < 0 || bank > 3) return;
		if (address < 0x9000) {
			if (this.#bankLow === bank) return;
			this.#bankLow = bank;
		} else if (address < 0xa000) {
			if (this.#bankHigh === bank) return;
			this.#bankHigh = bank;
		} else {
			return;
		}
		this.mappingChanged.emit();
	}
}
