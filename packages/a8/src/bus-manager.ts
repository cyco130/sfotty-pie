import { type Memory, ReadOptions } from "@sfotty-pie/sfotty";
import type { Cartridge } from "./cartridge.ts";
import type { Pia } from "./pia.ts";

// Trap callbacks. Interceptors run *before* the access and may short-circuit it
// (a read interceptor returns a substitute value; a write interceptor returns
// true to suppress the store) — return undefined/void to fall through.
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
 * given is `{ dummy: false }` — fire on committing accesses only. An execute
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

/** Remove an entry from a registry list, dropping the address key if empty. */
function removeEntry<F>(
	map: Map<number, TrapEntry<F>[]>,
	address: number,
	entry: TrapEntry<F>,
): void {
	const list = map.get(address);
	if (!list) return;
	const index = list.indexOf(entry);
	if (index >= 0) list.splice(index, 1);
	if (list.length === 0) map.delete(address);
}

export class Ram implements Memory {
	#memory: Uint8Array;
	#base: number;

	constructor(size: number, base = 0) {
		this.#memory = new Uint8Array(size);
		this.#base = base;
	}

	read(address: number): number {
		// TODO(floating-bus): out-of-range = undriven; $FF is the XL/XE pull-up.
		return this.#memory[address - this.#base] ?? 0xff;
	}

	write(address: number, value: number): void {
		if (address >= this.#base && address - this.#base < this.#memory.length) {
			this.#memory[address - this.#base] = value;
		}
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

	constructor(contents: Uint8Array, base: number, mask: number) {
		this.#memory = contents;
		this.#base = base;
		this.#mask = mask;
	}

	read(address: number): number {
		// TODO(floating-bus): out-of-range = undriven; $FF is the XL/XE pull-up.
		return this.#memory[(address - this.#base) & this.#mask] ?? 0xff;
	}

	write(address: number, value: number): void {
		void address;
		void value;
	}
}

export interface AtariBusOptions {
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

export class AtariBus implements Memory {
	constructor(options: AtariBusOptions) {
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
		// that aren't backed by a Ram; #map falls back to conventional RAM for
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

		// Sync derived banking state to the current PORTB instead of relying on
		// the field defaults matching it.
		this.portbChanged();
	}

	/**
	 * Drop the PORTB watch. Call before discarding the bus — the host
	 * reconfigures the machine by building a fresh `AtariBus`, and without this
	 * the dead bus keeps receiving PORTB changes from the shared PIA.
	 */
	dispose() {
		this.#unwatchPortbChanged?.();
		this.#unwatchPortbChanged = null;
	}

	/**
	 * Hot-plug or remove the cartridge. This is the one bit of configuration
	 * that changes at runtime — carts are physically inserted/removed — while
	 * everything else is fixed at construction.
	 */
	setCartridge(cartridge: Cartridge | null) {
		this.#cartridge = cartridge ?? undefined;
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
	}

	#ram: Ram;
	#banks: Ram[];
	#bankMask = 0;

	#osRom: Memory;
	#basicRom?: Memory;
	#gameRom?: Memory;
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

	#unwatchPortbChanged: (() => void) | null = null;
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

			// TODO: bit 0 as a banking bit (Rambo 2112K / Compy 1088K) omitted —
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
	}

	#map(address: number, options: ReadOptions): Memory {
		if (address < 0xd100) {
			// 0000..D0FF
			if (address < 0x8000) {
				// 0000..7FFF
				if (address < 0x5000) {
					// 0000..4FFF
					if (address < 0x4000) {
						// 0000..3FFF
						return this.#ram;
					} else {
						// 4000..4FFF
						const extended =
							options & ReadOptions.DMA
								? this.#anticSeesExtendedRam
								: this.#cpuSeesExtendedRam;

						if (extended) {
							return this.#banks[this.#bank] ?? this.#ram;
						} else {
							return this.#ram;
						}
					}
				} else {
					// 5000..7FFF
					if (address < 0x5800) {
						// 5000..57FF
						// The self-test window only appears while the OS ROM
						// is also enabled — the self-test lives on the OS ROM
						// chip (Acid800's mmu_xlbanking checks this).
						if (this.#isSelfTestEnabled && this.#isOsRomEnabled) {
							return this.#osRom;
						}

						const extended =
							options & ReadOptions.DMA
								? this.#anticSeesExtendedRam
								: this.#cpuSeesExtendedRam;

						if (extended) {
							return this.#banks[this.#bank] ?? this.#ram;
						}

						return this.#ram;
					} else {
						// 5800..7FFF
						const extended =
							options & ReadOptions.DMA
								? this.#anticSeesExtendedRam
								: this.#cpuSeesExtendedRam;

						if (extended) {
							return this.#banks[this.#bank] ?? this.#ram;
						} else {
							return this.#ram;
						}
					}
				}
			} else {
				// 8000..D0FF
				if (address < 0xc000) {
					// 8000..BFFF
					if (address < 0xa000) {
						// 8000..9FFF
						if (this.#cartridge?.has8000To9fff) {
							return this.#cartridge;
						}

						return this.#ram;
					} else {
						// A000..BFFF
						if (this.#cartridge?.hasA000ToBfff) {
							return this.#cartridge;
						}

						if (this.#basicRom && this.#isBasicRomEnabled) {
							return this.#basicRom;
						}

						if (this.#gameRom && this.#isGameRomEnabled) {
							return this.#gameRom;
						}

						return this.#ram;
					}
				} else {
					// C000..D0FF
					if (address < 0xd000) {
						// C000..CFFF
						if (this.#portbBanking) {
							if (this.#isOsRomEnabled) {
								return this.#osRom;
							}

							return this.#ram;
						}

						// TODO: Axlon
						return this.#ram;
					} else {
						// D000..D0FF
						return this.#gtia;
					}
				}
			}
		} else {
			// D100..FFFF
			if (address < 0xd500) {
				// D100..D4FF
				if (address < 0xd300) {
					// D100..D3FF
					if (address < 0xd200) {
						// D100..D1FF
						return this.#pbi;
					} else {
						// D200..D2FF
						return this.#pokey;
					}
				} else {
					// D300..D4FF
					if (address < 0xd400) {
						// D300..D3FF
						return this.#pia;
					} else {
						// D400..D4FF
						return this.#antic;
					}
				}
			} else {
				// D500..FFFF
				if (address < 0xd800) {
					// D500..D7FF
					if (address < 0xd600) {
						// D500..D5FF
						return this.#cartridge ?? unconnectedMemory;
					} else {
						// D600..D6FF
						return this.#pbi;
					}
				} else {
					// D800..FFFF
					if (address < 0xe000) {
						// D800..DFFF
						// TODO: PBI firmware
						if (!this.#portbBanking || this.#isOsRomEnabled) {
							return this.#osRom;
						}

						return this.#ram;
					} else {
						// E000..FFFF
						if (!this.#portbBanking || this.#isOsRomEnabled) {
							return this.#osRom;
						}

						return this.#ram;
					}
				}
			}
		}
	}

	// Last value driven on the data bus. Public so a chip that reads the bus
	// without driving the address can see it — e.g. GTIA samples the bus on
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
		// A PEEK (debugger/disassembler inspection) must not fire traps or
		// disturb the bus — it has no side effects. The `.size` guards keep the
		// common no-traps path off the lookup hot path: these run on every
		// access, so an empty registry must cost a field read, not a Map.get.
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

		const value = this.#map(address, options).read(address, options);
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
		// `options` carries DUMMY for a read-modify-write write-back, so a trap's
		// mask can exclude it (the default { dummy: false } does — observers fire
		// on the committed store only).
		if (
			this.#writeInterceptors.size &&
			this.#runWriteInterceptors(address, value, options)
		) {
			return; // suppressed — the store didn't commit, so no observers fire
		}
		this.#map(address, options).write(address, value, options);
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
		return {
			remove: () => removeEntry(map, address, entry),
		};
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
			if (entry.once) removeEntry(map, address, entry);
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
			if (entry.once) removeEntry(this.#readObservers, address, entry);
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
			if (entry.once) removeEntry(this.#writeInterceptors, address, entry);
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
			if (entry.once) removeEntry(this.#writeObservers, address, entry);
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
