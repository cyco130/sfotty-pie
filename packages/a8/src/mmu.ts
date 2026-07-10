import { type Memory, ReadOptions } from "@sfotty-pie/sfotty";
import type { Cartridge } from "./cartridge.ts";
import type { Pia } from "./pia.ts";

// Trap callbacks. Interceptors run *before* the access and may short-circuit it
// (a read interceptor returns a substitute value; a write interceptor returns
// true to suppress the store) - return undefined/void to fall through.
// Observers run *after* and only watch. Both phases are additive and run
// last-registered-first (LIFO), so a newly installed hook takes precedence; for
// interceptors the first non-undefined return wins. `address` is passed for
// future range traps; handlers reach cpu/machine via the closure they were
// registered in. `flags` is the access's ReadOptions.
export type ReadInterceptor = (
	address: number,
	flags: ReadOptions,
) => number | undefined;
export type ReadObserver = (
	address: number,
	value: number,
	flags: ReadOptions,
) => void;
export type WriteInterceptor = (
	address: number,
	value: number,
	flags: ReadOptions,
) => boolean | void;
export type WriteObserver = (
	address: number,
	value: number,
	flags: ReadOptions,
) => void;

// Execute traps are sugar for a read trap masked to a committed opcode fetch
// ({ sync: true, dummy: false }); the fetched byte isn't passed (HLE returns a
// substitute opcode like RTS; observers read CPU state via their closure).
export type ExecuteInterceptor = (address: number) => number | undefined;
export type ExecuteObserver = (address: number) => void;

/**
 * Which accesses a trap fires on, by flag. `true` = the flag must be set,
 * `false` = it must be clear, omitted = don't care. The default when no mask is
 * given is `{ dummy: false }` - fire on committing accesses only. An execute
 * trap is `{ sync: true, dummy: false }` (a committed opcode fetch).
 */
export interface TrapMask {
	sync?: boolean;
	dummy?: boolean;
	dma?: boolean;
}

/** Returned by every trap registration; call `remove()` to unregister it. */
export interface TrapHandle {
	remove(): void;
}

export interface TrapOptions {
	/** Auto-remove the trap after it next fires. */
	once?: boolean;
	/** Which accesses to fire on (default `{ dummy: false }`). */
	mask?: TrapMask;
}

const DEFAULT_MASK: TrapMask = { dummy: false };
const EXECUTE_MASK: TrapMask = { sync: true, dummy: false };

/** Compile a mask into require-set / require-clear bit patterns. */
function compileMask(mask: TrapMask): { set: number; clear: number } {
	let set = 0;
	let clear = 0;
	const apply = (flag: number, want: boolean | undefined) => {
		if (want === true) set |= flag;
		else if (want === false) clear |= flag;
	};
	apply(ReadOptions.SYNC, mask.sync);
	apply(ReadOptions.DUMMY, mask.dummy);
	apply(ReadOptions.DMA, mask.dma);
	return { set, clear };
}

/** A registered trap: its compiled mask, the once flag, and the callback. */
interface TrapEntry<F> {
	set: number;
	clear: number;
	once: boolean;
	fn: F;
}

/**
 * Remove an entry from a registry list, dropping the address key if empty.
 * Returns whether the entry was still registered (guards double removal:
 * a once-trap firing and its handle's remove() may both call this).
 */
function removeEntry<F>(
	map: Map<number, TrapEntry<F>[]>,
	address: number,
	entry: TrapEntry<F>,
): boolean {
	const list = map.get(address);
	if (!list) return false;
	const index = list.indexOf(entry);
	if (index < 0) return false;
	list.splice(index, 1);
	if (list.length === 0) map.delete(address);
	return true;
}

/**
 * A shared read-only 256-byte page of $FF - what an undriven or absent region
 * reads on XL/XE (the bus pull-ups). Wired into the fast page tables for
 * unmapped pages; never written (unmapped pages have no fast write entry).
 * TODO(floating-bus): 400/800 and some XE read the last bus value instead.
 */
const FF_PAGE = new Uint8Array(256).fill(0xff);

export class Ram implements Memory {
	#memory: Uint8Array;
	#base: number;
	#views: Uint8Array[] = [];

	constructor(size: number, base = 0) {
		this.#memory = new Uint8Array(size);
		this.#base = base;
		for (let offset = 0; offset < size; offset += 0x100) {
			this.#views.push(this.#memory.subarray(offset, offset + 0x100));
		}
	}

	/**
	 * 256-byte views of the backing store, one per page; index 0 is the page
	 * at `base`. The MMU wires these into its fast page tables, so the
	 * read/write methods below only serve trapped pages - the tables never
	 * route an out-of-range address here, hence no bounds handling.
	 */
	get pageViews(): readonly Uint8Array[] {
		return this.#views;
	}

	read(address: number): number {
		return this.#memory[address - this.#base]!;
	}

	write(address: number, value: number): void {
		this.#memory[address - this.#base] = value;
	}

	reset(cold: boolean): void {
		if (!cold) return;
		this.#memory.fill(0);
	}

	get size(): number {
		return this.#memory.length;
	}
}

export class Rom implements Memory {
	#memory: Uint8Array;
	#base: number;
	#mask: number;
	#views = new Map<number, Uint8Array>();

	constructor(contents: Uint8Array, base: number, mask: number) {
		this.#memory = contents;
		this.#base = base;
		this.#mask = mask;
	}

	/**
	 * A 256-byte view of the contents as decoded at `page`, mask (mirroring)
	 * applied - or `FF_PAGE` when the decode lands past the end of the image
	 * (a 10K OS's missing self-test and C000 regions read $FF). The MMU maps
	 * FF_PAGE pages to `unconnectedMemory`, so `read` below never sees an
	 * out-of-image address.
	 */
	pageView(page: number): Uint8Array {
		let view = this.#views.get(page);
		if (!view) {
			const offset = ((page << 8) - this.#base) & this.#mask;
			view =
				offset + 0x100 <= this.#memory.length
					? this.#memory.subarray(offset, offset + 0x100)
					: FF_PAGE;
			this.#views.set(page, view);
		}
		return view;
	}

	read(address: number): number {
		return this.#memory[(address - this.#base) & this.#mask]!;
	}

	write(address: number, value: number): void {
		void address;
		void value;
	}
}

export interface MmuOptions {
	/**
	 * Enable PORTB banking.
	 */
	portbBanking: boolean;

	/**
	 * Conventional RAM size in kilobytes.
	 *
	 * Allowed values are:
	 *
	 * - 16: Standard Atari 400/600XL/5200
	 * - 48: Standard Atari 800
	 * - 64: Standard Atari 800XL/65XE/130XE/XEGS
	 *
	 */
	conventionalRamSize: number;

	/**
	 * Number of 16K banks of extended memory that can be mapped
	 * via PORTB. Must be between 0 and 64 if `separateAnticAccess`
	 * is false, or between 0 and 32 if it's true.
	 */
	xeBankCount: number;

	/**
	 * Whether ANTIC can access a separate bank of extended memory
	 * from the CPU. Can't be set when `xeBankCount` is greater than 32.
	 */
	separateAnticAccess: boolean;

	/**
	 * OS ROM contents.
	 *
	 * It must be either 10K or 16K. Sfotty Pie A8 can use
	 * either size on 400/800 and XL/XE. If a 10K OS ROM is
	 * specified for XL/XE, the self-test ROM and C000-CFFF
	 * will read FF. If a 16K OS ROM is specified for 400/800,
	 * the C000-CFFF section will be mapped in but the self-test
	 * ROM will not be accessible.
	 */
	osRom: Uint8Array;

	/**
	 * BASIC ROM contents.
	 *
	 * If present, it must be 8K. Requires PORTB banking.
	 */
	basicRom?: Uint8Array;

	/**
	 * Game ROM (Missile Command) contents.
	 *
	 * If present, it must be 8K. Requires PORTB banking.
	 */
	gameRom?: Uint8Array;

	/**
	 * Cartridge chip.
	 */
	cartridge?: Cartridge;

	gtia: Memory;
	pbi: Memory;
	pokey: Memory;
	pia: Pia;
	antic: Memory;
}

export class Mmu implements Memory {
	constructor(options: MmuOptions) {
		const {
			portbBanking,
			conventionalRamSize,
			xeBankCount,
			separateAnticAccess,
			osRom,
			basicRom,
			gameRom,
			cartridge,
			gtia,
			pbi,
			pokey,
			pia,
			antic,
		} = options;

		if (
			conventionalRamSize !== 16 &&
			conventionalRamSize !== 48 &&
			conventionalRamSize !== 64
		) {
			throw new Error("Conventional RAM size must be 16, 48, or 64");
		}

		if (!portbBanking) {
			if (xeBankCount) {
				throw new Error("XE-compatible extended RAM requires PORTB banking");
			}

			if (basicRom) {
				throw new Error("Built-in BASIC requires PORTB banking");
			}

			if (gameRom) {
				throw new Error("Built-in game ROM requires PORTB banking");
			}
		}

		if (!Number.isInteger(xeBankCount) || xeBankCount < 0) {
			throw new Error(
				"Number of XE-compatible extended RAM banks must be a non-negative integer",
			);
		}

		// TODO: 1088K separate (64 banks) never shipped; capped at 32.
		if (separateAnticAccess && xeBankCount > 32) {
			throw new Error(
				"Separate ANTIC access is only possible with a maximum extended RAM of 512K (32 banks)",
			);
		}

		// TODO: 2112K non-separate (128 banks) never shipped; capped at 64.
		if (xeBankCount > 64) {
			throw new Error(
				"XE-compatible extended RAM cannot exceed 1024K (64 banks)",
			);
		}

		if (osRom.length !== 10 * 1024 && osRom.length !== 16 * 1024) {
			throw new Error("OS ROM size must be either 10K or 16K");
		}

		if (basicRom && basicRom.length !== 8 * 1024) {
			throw new Error("BASIC ROM size must be 8K");
		}

		if (gameRom && gameRom.length !== 8 * 1024) {
			throw new Error("Game ROM size must be 8K");
		}

		this.#ram = new Ram(conventionalRamSize * 1024);

		this.#banks = new Array(xeBankCount);
		for (let i = 0; i < xeBankCount; i++) {
			this.#banks[i] = new Ram(16 * 1024, 0x4000);
		}

		// TODO: non-power-of-two xeBankCount leaves bank indices within #bankMask
		// that aren't backed by a Ram; the page tables fall back to conventional
		// RAM for
		// those. The UI restricts to powers of two until we research the real
		// aliasing schemes.
		if (xeBankCount > 32) {
			this.#bankMask = 63;
		} else if (xeBankCount > 16) {
			this.#bankMask = 31;
		} else if (xeBankCount > 8) {
			this.#bankMask = 15;
		} else if (xeBankCount > 4) {
			this.#bankMask = 7;
		} else if (xeBankCount > 2) {
			this.#bankMask = 3;
		} else if (xeBankCount > 1) {
			this.#bankMask = 1;
		} else {
			this.#bankMask = 0;
		}

		this.#separateAnticAccess = separateAnticAccess;
		this.#portbBanking = portbBanking;

		this.#osRom =
			osRom.length === 10 * 1024
				? new Rom(osRom, 0xd800, 0x3fff)
				: new Rom(osRom, 0xc000, 0x7fff);

		if (basicRom) {
			this.#basicRom = new Rom(basicRom, 0xa000, 0x1fff);
		}

		if (gameRom) {
			this.#gameRom = new Rom(gameRom, 0xa000, 0x1fff);
		}

		this.#cartridge = cartridge;

		this.#gtia = gtia;
		this.#pbi = pbi;
		this.#pokey = pokey;
		this.#pia = pia;
		this.#antic = antic;

		this.portbChanged = this.portbChanged.bind(this);
		this.#unwatchPortbChanged = pia.portbOut.watch(this.portbChanged);

		if (cartridge) {
			this.#unwatchCartMapping = cartridge.mappingChanged.watch(
				this.#cartMappingChanged,
			);
		}

		// Sync derived banking state to the current PORTB instead of relying on
		// the field defaults matching it. portbChanged rebuilds the page tables;
		// rebuild explicitly too for the non-banking case, where it early-outs.
		this.portbChanged();
		this.#rebuildPageTables();
	}

	/**
	 * Drop the PORTB watch. Call before discarding the bus - the host
	 * reconfigures the machine by building a fresh `Mmu`, and without this
	 * the dead bus keeps receiving PORTB changes from the shared PIA.
	 */
	dispose() {
		this.#unwatchPortbChanged?.();
		this.#unwatchPortbChanged = null;
		this.#unwatchCartMapping?.();
		this.#unwatchCartMapping = null;
	}

	/**
	 * Hot-plug or remove the cartridge. This is the one bit of configuration
	 * that changes at runtime - carts are physically inserted/removed - while
	 * everything else is fixed at construction.
	 */
	setCartridge(cartridge: Cartridge | null) {
		this.#unwatchCartMapping?.();
		this.#unwatchCartMapping = null;
		this.#cartridge = cartridge ?? undefined;
		if (this.#cartridge) {
			this.#unwatchCartMapping = this.#cartridge.mappingChanged.watch(
				this.#cartMappingChanged,
			);
		}
		this.#rebuildPageTables();
	}

	reset(cold: boolean) {
		this.#ram.reset(cold);
		for (const bank of this.#banks) {
			bank.reset(cold);
		}

		this.#cartridge?.reset(cold);

		this.#bank = 0;
		this.#cpuSeesExtendedRam = false;
		this.#anticSeesExtendedRam = false;
		this.#isSelfTestEnabled = false;
		this.#isBasicRomEnabled = false;
		this.#isGameRomEnabled = false;
		this.#isOsRomEnabled = true;

		this.#rebuildPageTables();
	}

	#ram: Ram;
	#banks: Ram[];
	#bankMask = 0;

	#osRom: Rom;
	#basicRom?: Rom;
	#gameRom?: Rom;
	#cartridge?: Cartridge;

	#gtia: Memory;
	#pbi: Memory;
	#pokey: Memory;
	#pia: Pia;
	#antic: Memory;

	#portbBanking: boolean;
	#separateAnticAccess: boolean;

	#bank = 0;
	#cpuSeesExtendedRam = false;
	#anticSeesExtendedRam = false;

	#isSelfTestEnabled = false;
	#isBasicRomEnabled = false;
	#isGameRomEnabled = false;
	#isOsRomEnabled = true;

	/**
	 * Whether the OS ROM is currently mapped at $D800-$FFFF (always true
	 * without PORTB banking). OS entry-point traps key on this: with RAM
	 * banked in under the OS, an address like SIOV holds the running
	 * program's own code, not the OS routine the trap stands in for.
	 */
	get isOsRomMapped(): boolean {
		return !this.#portbBanking || this.#isOsRomEnabled;
	}

	#unwatchPortbChanged: (() => void) | null = null;
	#unwatchCartMapping: (() => void) | null = null;
	portbChanged() {
		if (!this.#portbBanking) return;

		const value = this.#pia.portbOut.value;

		this.#cpuSeesExtendedRam = !(value & 0x10);
		if (this.#separateAnticAccess) {
			this.#anticSeesExtendedRam = !(value & 0x20);
		} else {
			this.#anticSeesExtendedRam = this.#cpuSeesExtendedRam;
		}

		const isBankAssignment =
			this.#cpuSeesExtendedRam || this.#anticSeesExtendedRam;

		// Bit 0: pure OS-ROM-enable in supported schemes (never a banking bit).
		this.#isOsRomEnabled = !!(value & 0x01);

		if (
			!isBankAssignment ||
			this.#bankMask < (this.#separateAnticAccess ? 15 : 63)
		) {
			this.#isSelfTestEnabled = !(value & 0x80); // Reused for Compy 4 bits or Rambo 6 bits
		}

		if (!isBankAssignment || this.#bankMask < 31) {
			this.#isBasicRomEnabled = !(value & 0x02); // Reused for 5 bits
		}

		if (!isBankAssignment || this.#bankMask < 7) {
			this.#isGameRomEnabled = !(value & 0x40); // Reused for 3 bits, mask >= 7
		}

		if (isBankAssignment) {
			let bank = 0;
			if (value & 0x04) bank |= 0x01;
			if (value & 0x08) bank |= 0x02;

			// TODO: bit 0 as a banking bit (Rambo 2112K / Compy 1088K) omitted -
			// never shipped.

			if (this.#separateAnticAccess) {
				if (value & 0x40) bank |= 0x04;
				if (value & 0x80) bank |= 0x08;
				if (value & 0x02) bank |= 0x10;
			} else {
				if (value & 0x20) bank |= 0x04;
				if (value & 0x40) bank |= 0x08;
				if (value & 0x02) bank |= 0x10;
				if (value & 0x80) bank |= 0x20;
			}

			this.#bank = bank & this.#bankMask;
		}

		this.#rebuildPageTables();
	}

	// The page-dispatch table: for each of the 256 pages, fast read/write
	// bytes plus a slow-path target, one set per bus master (the CPU, and
	// ANTIC via ReadOptions.DMA - they can see different extended-RAM banks).
	// Stored as parallel arrays (struct of arrays) so the hot path is a
	// single element load. A non-null fast entry means the access is a plain
	// byte load/store on a 256-byte view of the backing store - no virtual
	// call, no bounds check, no trap check. Pages with registered traps and
	// the chip-register pages have null fast entries and take
	// #slowRead/#slowWrite. Splitting reads from writes is what unifies RAM
	// and ROM: a ROM page is simply one with no fast write entry (stray
	// writes fall through to the target's no-op).
	//
	// #rebuildPageTables re-derives everything on any event that can change
	// the map: a PORTB change, cartridge insertion/removal, a cartridge bank
	// switch (the views move even when no area maps or unmaps), reset, and a
	// page's trap count dropping to zero. It allocates nothing: the page
	// views are built once per backing store and cached.
	#cpuReadFast = new Array<Uint8Array | null>(256).fill(null);
	#dmaReadFast = new Array<Uint8Array | null>(256).fill(null);
	#cpuWriteFast = new Array<Uint8Array | null>(256).fill(null);
	#dmaWriteFast = new Array<Uint8Array | null>(256).fill(null);
	#cpuTarget = new Array<Memory>(256).fill(unconnectedMemory);
	#dmaTarget = new Array<Memory>(256).fill(unconnectedMemory);

	// Registered traps per page; a page with any takes the slow path.
	#trapCounts = new Uint16Array(256);

	#cartMappingChanged = () => {
		this.#rebuildPageTables();
	};

	/** Point `page` at `target` for both masters, with the given fast views. */
	#setPage(
		page: number,
		target: Memory,
		read: Uint8Array | null,
		write: Uint8Array | null,
	): void {
		this.#cpuTarget[page] = target;
		this.#dmaTarget[page] = target;
		this.#cpuReadFast[page] = read;
		this.#dmaReadFast[page] = read;
		this.#cpuWriteFast[page] = write;
		this.#dmaWriteFast[page] = write;
	}

	/** A conventional-RAM page: RAM where it exists, the $FF pull-up beyond. */
	#setRamPage(page: number): void {
		const view = this.#ram.pageViews[page];
		if (view) this.#setPage(page, this.#ram, view, view);
		else this.#setPage(page, unconnectedMemory, FF_PAGE, null);
	}

	/** A ROM page ($FF where the image doesn't cover the decode - 10K OS). */
	#setRomPage(page: number, rom: Rom): void {
		const view = rom.pageView(page);
		if (view === FF_PAGE) this.#setPage(page, unconnectedMemory, FF_PAGE, null);
		else this.#setPage(page, rom, view, null);
	}

	/**
	 * A cartridge ROM page, per the AtariMemory pageView contract: a view is
	 * fast bytes, null is the unconnected $FF page, and undefined (an absent
	 * hook, or a read-sensitive page) routes every access through the
	 * cartridge's read/write.
	 */
	#setCartPage(page: number, cartridge: Cartridge): void {
		const view = cartridge.pageView?.(page);
		if (view === undefined) {
			this.#setPage(page, cartridge, null, null);
		} else {
			this.#setPage(page, cartridge, view ?? FF_PAGE, null);
		}
	}

	#rebuildPageTables(): void {
		// 0000-3FFF: conventional RAM.
		for (let page = 0x00; page < 0x40; page++) {
			this.#setRamPage(page);
		}

		// 4000-7FFF: the extended-RAM window, selected per bus master.
		// Conventional RAM is the default; a missing bank (non-power-of-two
		// configurations) also falls back to it, like the old decision tree.
		const bank = this.#banks[this.#bank];
		for (let page = 0x40; page < 0x80; page++) {
			this.#setRamPage(page);
			if (bank) {
				const view = bank.pageViews[page - 0x40]!;
				if (this.#cpuSeesExtendedRam) {
					this.#cpuTarget[page] = bank;
					this.#cpuReadFast[page] = view;
					this.#cpuWriteFast[page] = view;
				}
				if (this.#anticSeesExtendedRam) {
					this.#dmaTarget[page] = bank;
					this.#dmaReadFast[page] = view;
					this.#dmaWriteFast[page] = view;
				}
			}
		}

		// 5000-57FF: the self-test window overlays it, but only while the OS ROM
		// is also enabled - the self-test lives on the OS ROM chip (Acid800's
		// mmu_xlbanking checks this).
		if (this.#isSelfTestEnabled && this.#isOsRomEnabled) {
			for (let page = 0x50; page < 0x58; page++) {
				this.#setRomPage(page, this.#osRom);
			}
		}

		// 8000-9FFF: cartridge or RAM.
		const cartridge = this.#cartridge;
		const has8000 = cartridge?.has8000To9fff ?? false;
		for (let page = 0x80; page < 0xa0; page++) {
			if (has8000) this.#setCartPage(page, cartridge!);
			else this.#setRamPage(page);
		}

		// A000-BFFF: cartridge, else built-in BASIC / game ROM, else RAM.
		const hasA000 = cartridge?.hasA000ToBfff ?? false;
		const builtinA000 =
			this.#basicRom && this.#isBasicRomEnabled
				? this.#basicRom
				: this.#gameRom && this.#isGameRomEnabled
					? this.#gameRom
					: null;
		for (let page = 0xa0; page < 0xc0; page++) {
			if (hasA000) this.#setCartPage(page, cartridge!);
			else if (builtinA000) this.#setRomPage(page, builtinA000);
			else this.#setRamPage(page);
		}

		// C000-CFFF: OS ROM on XL/XE when enabled, RAM otherwise. TODO: Axlon.
		const c000Os = this.#portbBanking && this.#isOsRomEnabled;
		for (let page = 0xc0; page < 0xd0; page++) {
			if (c000Os) this.#setRomPage(page, this.#osRom);
			else this.#setRamPage(page);
		}

		// D000-D7FF: the hardware register pages - always the slow path, since
		// registers have side effects. D5 is the cartridge control region ($FF
		// when no cartridge is inserted).
		this.#setPage(0xd0, this.#gtia, null, null);
		this.#setPage(0xd1, this.#pbi, null, null);
		this.#setPage(0xd2, this.#pokey, null, null);
		this.#setPage(0xd3, this.#pia, null, null);
		this.#setPage(0xd4, this.#antic, null, null);
		if (cartridge) this.#setPage(0xd5, cartridge, null, null);
		else this.#setPage(0xd5, unconnectedMemory, FF_PAGE, null);
		this.#setPage(0xd6, this.#pbi, null, null);
		this.#setPage(0xd7, this.#pbi, null, null);

		// D800-FFFF: OS ROM, or RAM when banked out. TODO: PBI firmware.
		const osHigh = !this.#portbBanking || this.#isOsRomEnabled;
		for (let page = 0xd8; page < 0x100; page++) {
			if (osHigh) this.#setRomPage(page, this.#osRom);
			else this.#setRamPage(page);
		}

		// Trapped pages take the slow path in both directions.
		for (let page = 0; page < 256; page++) {
			if (this.#trapCounts[page]) {
				this.#cpuReadFast[page] = null;
				this.#dmaReadFast[page] = null;
				this.#cpuWriteFast[page] = null;
				this.#dmaWriteFast[page] = null;
			}
		}
	}

	// Last value driven on the data bus. Public so a chip that reads the bus
	// without driving the address can see it - e.g. GTIA samples the bus on
	// cycles where it expects ANTIC to drive the address via DMA; with that DMA
	// disabled ANTIC doesn't drive, and GTIA reads whatever was last here.
	//
	// TODO(floating-bus): related but NOT the same thing. On 400/800 / some XE,
	// *undriven* reads return the last bus value instead of $FF (see the
	// floating-bus TODO markers), and the 800 splits a separate I/O bus. We
	// might reuse busData for that, but it needs thought (two bus values; PEEK
	// is already excluded in read() below).
	busData = 0xff;

	read(address: number, options: ReadOptions) {
		// The fast path: a plain byte load off the page view. Trap handling
		// lives entirely on the slow path - a page with any registered trap
		// has a null fast entry, so the hot path never consults the
		// registries. A PEEK on a fast page is naturally side-effect-free; it
		// just must not disturb the bus value.
		const fast =
			options & ReadOptions.DMA
				? this.#dmaReadFast[address >>> 8]
				: this.#cpuReadFast[address >>> 8];
		if (fast) {
			const value = fast[address & 0xff]!;
			if (!(options & ReadOptions.PEEK)) this.busData = value;
			return value;
		}
		return this.#slowRead(address, options);
	}

	// Chip registers and trapped pages: the full pre-table access protocol.
	#slowRead(address: number, options: ReadOptions): number {
		// A PEEK (debugger/disassembler inspection) must not fire traps or
		// disturb the bus - it has no side effects.
		if (!(options & ReadOptions.PEEK) && this.#readInterceptors.size) {
			const substitute = this.#runRead(
				this.#readInterceptors,
				address,
				options,
			);
			if (substitute !== undefined) {
				this.busData = substitute;
				if (this.#readObservers.size) {
					this.#runReadObservers(address, substitute, options);
				}
				return substitute;
			}
		}

		const target =
			options & ReadOptions.DMA
				? this.#dmaTarget[address >>> 8]!
				: this.#cpuTarget[address >>> 8]!;
		const value = target.read(address, options);
		if (!(options & ReadOptions.PEEK)) {
			this.busData = value;
			if (this.#readObservers.size) {
				this.#runReadObservers(address, value, options);
			}
		}
		return value;
	}

	write(address: number, value: number, options: ReadOptions) {
		this.busData = value;
		const fast =
			options & ReadOptions.DMA
				? this.#dmaWriteFast[address >>> 8]
				: this.#cpuWriteFast[address >>> 8];
		if (fast) {
			fast[address & 0xff] = value;
			return;
		}
		this.#slowWrite(address, value, options);
	}

	#slowWrite(address: number, value: number, options: ReadOptions): void {
		// `options` carries DUMMY for a read-modify-write write-back, so a trap's
		// mask can exclude it (the default { dummy: false } does - observers fire
		// on the committed store only).
		if (
			this.#writeInterceptors.size &&
			this.#runWriteInterceptors(address, value, options)
		) {
			return; // suppressed - the store didn't commit, so no observers fire
		}
		const target =
			options & ReadOptions.DMA
				? this.#dmaTarget[address >>> 8]!
				: this.#cpuTarget[address >>> 8]!;
		target.write(address, value, options);
		if (this.#writeObservers.size) {
			this.#runWriteObservers(address, value, options);
		}
	}

	// Trap registries. Each phase is an additive list per address, run
	// last-registered-first (LIFO). Interceptors (before) may short-circuit;
	// observers (after) only watch. `set`/`clear` are the compiled mask.
	#readInterceptors = new Map<number, TrapEntry<ReadInterceptor>[]>();
	#readObservers = new Map<number, TrapEntry<ReadObserver>[]>();
	#writeInterceptors = new Map<number, TrapEntry<WriteInterceptor>[]>();
	#writeObservers = new Map<number, TrapEntry<WriteObserver>[]>();

	#add<F>(
		map: Map<number, TrapEntry<F>[]>,
		address: number,
		fn: F,
		opts: TrapOptions | undefined,
	): TrapHandle {
		const { set, clear } = compileMask(opts?.mask ?? DEFAULT_MASK);
		const entry: TrapEntry<F> = { set, clear, once: opts?.once ?? false, fn };
		const list = map.get(address);
		if (list) list.push(entry);
		else map.set(address, [entry]);

		// De-fasten the page so every access to it takes the slow path, where
		// the registries are consulted. (Conservatively for both directions
		// and masters - trap registration is rare, page rebuilds are cheap.)
		const page = address >>> 8;
		this.#trapCounts[page] = this.#trapCounts[page]! + 1;
		this.#cpuReadFast[page] = null;
		this.#dmaReadFast[page] = null;
		this.#cpuWriteFast[page] = null;
		this.#dmaWriteFast[page] = null;

		return {
			remove: () => this.#removeTrap(map, address, entry),
		};
	}

	// Unregister a trap; when its page's count drops to zero, a rebuild
	// restores the fast entries.
	#removeTrap<F>(
		map: Map<number, TrapEntry<F>[]>,
		address: number,
		entry: TrapEntry<F>,
	): void {
		if (!removeEntry(map, address, entry)) return;
		const page = address >>> 8;
		if (--this.#trapCounts[page]! === 0) {
			this.#rebuildPageTables();
		}
	}

	// LIFO over the matching interceptors; first non-undefined return wins.
	#runRead(
		map: Map<number, TrapEntry<ReadInterceptor>[]>,
		address: number,
		flags: ReadOptions,
	): number | undefined {
		const list = map.get(address);
		if (!list) return undefined;
		for (let i = list.length - 1; i >= 0; i--) {
			const entry = list[i]!;
			if ((flags & entry.set) !== entry.set || (flags & entry.clear) !== 0) {
				continue;
			}
			const result = entry.fn(address, flags);
			if (entry.once) this.#removeTrap(map, address, entry);
			if (result !== undefined) return result;
		}
		return undefined;
	}

	#runReadObservers(address: number, value: number, flags: ReadOptions): void {
		const list = this.#readObservers.get(address);
		if (!list) return;
		for (let i = list.length - 1; i >= 0; i--) {
			const entry = list[i]!;
			if ((flags & entry.set) !== entry.set || (flags & entry.clear) !== 0) {
				continue;
			}
			entry.fn(address, value, flags);
			if (entry.once) this.#removeTrap(this.#readObservers, address, entry);
		}
	}

	#runWriteInterceptors(
		address: number,
		value: number,
		flags: ReadOptions,
	): boolean {
		const list = this.#writeInterceptors.get(address);
		if (!list) return false;
		for (let i = list.length - 1; i >= 0; i--) {
			const entry = list[i]!;
			if ((flags & entry.set) !== entry.set || (flags & entry.clear) !== 0) {
				continue;
			}
			const suppress = entry.fn(address, value, flags);
			if (entry.once) this.#removeTrap(this.#writeInterceptors, address, entry);
			if (suppress) return true; // first to suppress wins
		}
		return false;
	}

	#runWriteObservers(address: number, value: number, flags: ReadOptions): void {
		const list = this.#writeObservers.get(address);
		if (!list) return;
		for (let i = list.length - 1; i >= 0; i--) {
			const entry = list[i]!;
			if ((flags & entry.set) !== entry.set || (flags & entry.clear) !== 0) {
				continue;
			}
			entry.fn(address, value, flags);
			if (entry.once) this.#removeTrap(this.#writeObservers, address, entry);
		}
	}

	/** Trap a data read, before the access; may return a substitute value. */
	interceptRead(
		address: number,
		fn: ReadInterceptor,
		opts?: TrapOptions,
	): TrapHandle {
		return this.#add(this.#readInterceptors, address, fn, opts);
	}

	/** Watch a read after it resolves (its committed value). */
	observeRead(
		address: number,
		fn: ReadObserver,
		opts?: TrapOptions,
	): TrapHandle {
		return this.#add(this.#readObservers, address, fn, opts);
	}

	/** Trap a write, before the store; return true to suppress it. */
	interceptWrite(
		address: number,
		fn: WriteInterceptor,
		opts?: TrapOptions,
	): TrapHandle {
		return this.#add(this.#writeInterceptors, address, fn, opts);
	}

	/** Watch a write after it commits. */
	observeWrite(
		address: number,
		fn: WriteObserver,
		opts?: TrapOptions,
	): TrapHandle {
		return this.#add(this.#writeObservers, address, fn, opts);
	}

	/** Sugar: trap a committed opcode fetch (read masked to SYNC & !DUMMY). */
	interceptExecute(
		address: number,
		fn: ExecuteInterceptor,
		opts?: { once?: boolean },
	): TrapHandle {
		return this.interceptRead(address, (a) => fn(a), {
			mask: EXECUTE_MASK,
			once: opts?.once,
		});
	}

	/** Sugar: watch a committed opcode fetch. */
	observeExecute(
		address: number,
		fn: ExecuteObserver,
		opts?: { once?: boolean },
	): TrapHandle {
		return this.observeRead(address, (a) => fn(a), {
			mask: EXECUTE_MASK,
			once: opts?.once,
		});
	}
}

export const unconnectedMemory: Memory = {
	read() {
		// TODO(floating-bus): undriven; $FF is the XL/XE pull-up.
		return 0xff;
	},

	write() {},
};
