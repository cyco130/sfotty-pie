import { ReadOptions } from "@sfotty-pie/sfotty";
import type { AtariMemory } from "./atari-memory.ts";
import { detectFileFormat } from "./detect-file-format.ts";

export type BankMapping = null | number;
export type AreaMapping =
	| "ram" // Not mapped by the cartridge, accesses RAM
	| BankMapping // 8k banks
	| [BankMapping, BankMapping] // 4K banks
	| [BankMapping, BankMapping, BankMapping, BankMapping]; // 2K banks

export type CartridgeMapping = {
	area8000: AreaMapping; // default: "ram"
	areaA000: AreaMapping; // no default
	/**
	 * Opaque per-type state riding along with the mapping: a readable control
	 * register's exact value (SIC!, Flash MegaCart), a register that survives
	 * disabling the ROM window (The!Cart's bank, DCart's, AST's window
	 * counter). Types that don't need it omit it.
	 */
	state?: number;
};

export interface CartType {
	name: string;
	machine: "800/XL/XE" | "800" | "5200";
	/** ROM size in KB. */
	size: number;

	/** The mapping at power-on. Absent = the type isn't supported yet. */
	initialMapping?: CartridgeMapping;

	/**
	 * Load-time image transform, applied once at construction after the size
	 * check: descrambling protection dumps (Atrax), reordering interleaved
	 * dumps (JRC64), or appending synthesized banks (the OSS "AND" states,
	 * AST's mirror block) that mappings can then reference by bank number.
	 */
	prepare?(rom: Uint8Array): Uint8Array;

	/**
	 * The $D500-$D5FF control decode: given the accessed address, the
	 * written value (null for a read), and the current mapping (for
	 * sequence-switched carts like Ultracart/Blizzard 32K, whose next bank
	 * depends on the present one), return the new mapping, or undefined for
	 * no change. Pure - the cartridge applies the result - which is what
	 * keeps PEEK reads side-effect-free: the caller just discards it.
	 */
	control?(
		address: number,
		value: number | null,
		current: CartridgeMapping,
	): CartridgeMapping | undefined;

	/**
	 * The data-bus value of a $D500-$D5FF read; $FF when absent. For types
	 * with readable control registers (SIC!, The!Cart) or ROM windows in the
	 * control region (AST, DCart) - `rom` is provided for the latter. Pure,
	 * so PEEK reads can use it too. The value reflects the mapping *before*
	 * `control`'s switch applies: the decode happens during the read.
	 */
	controlRead?(
		address: number,
		current: CartridgeMapping,
		rom: Uint8Array,
	): number;
}

// ---------------------------------------------------------------------------
// Shared control schemes. Every factory below implements a scheme from
// cart.txt (external.local has a copy) and returns a complete CartType;
// mapping numbers are 8K bank indices unless a tuple selects 4K/2K
// granularity.
// ---------------------------------------------------------------------------

const A8 = "800/XL/XE" as const;

/** The whole-cartridge-off mapping (computer RAM shows through). */
const OFF: CartridgeMapping = { area8000: "ram", areaA000: "ram" };

/** An 8K bank at $A000-$BFFF only. */
function bankA(bank: number): CartridgeMapping {
	return { area8000: "ram", areaA000: bank };
}

/** A 16K bank filling $8000-$BFFF (two consecutive 8K banks). */
function bank16(bank: number): CartridgeMapping {
	return { area8000: bank * 2, areaA000: bank * 2 + 1 };
}

/**
 * XEGS scheme: 8K banks at $8000-$9FFF selected by the written value's low
 * bits, the last bank fixed at $A000-$BFFF; the switchable variants add
 * bit 7 as a full-cartridge disable. The real power-up bank is random -
 * bank 0 is chosen, like atari800.
 */
function xegs(name: string, size: number, switchable: boolean): CartType {
	const last = size / 8 - 1;
	return {
		name,
		machine: A8,
		size,
		initialMapping: { area8000: 0, areaA000: last },
		control(_address, value) {
			if (value === null) return undefined;
			if (switchable && value & 0x80) return OFF;
			return { area8000: value & last, areaA000: last };
		},
	};
}

/**
 * Williams scheme: 8K banks at $A000 selected by the accessed address's low
 * bits; address bit 3 disables. Only A0-A3 are decoded, so the register
 * mirrors across the page.
 */
function williams(name: string, size: number): CartType {
	const mask = size / 8 - 1;
	return {
		name,
		machine: A8,
		size,
		initialMapping: bankA(0),
		control(address) {
			if (address & 0x08) return OFF;
			return bankA(address & mask);
		},
	};
}

/**
 * Express/Diamond/SDX scheme: eight descending 8K banks at $A000 - an
 * access to `base + 7` selects bank 0, down to `base` selecting bank 7 -
 * with the next eight addresses disabling the cartridge. Accesses outside
 * the 16-address window are ignored. (For the SDX types the disable region
 * really enables the passthrough slot's second cartridge, which isn't
 * modeled yet - both halves of it act as plain disable.)
 */
function descendingBanks(name: string, size: number, base: number): CartType {
	return {
		name,
		machine: A8,
		size,
		initialMapping: bankA(0),
		control(address) {
			if (address < base || address > base + 0x0f) return undefined;
			if (address & 0x08) return OFF;
			return bankA(base + 7 - address);
		},
	};
}

// SDX 128's variant spans two windows: $D5F7-$D5F0 select banks 0-7,
// $D5E7-$D5E0 banks 8-15, and bit 3 in either window disables.
function sdx128Control(address: number): CartridgeMapping | undefined {
	if (address < 0xd5e0) return undefined;
	if (address & 0x08) return OFF;
	return bankA(7 - (address & 0x07) + (address & 0x10 ? 0 : 8));
}

/**
 * MegaCart scheme: 16K banks across $8000-$BFFF selected by the written
 * value's low bits; bit 7 disables.
 */
function megacart(name: string, size: number): CartType {
	const mask = size / 16 - 1;
	return {
		name,
		machine: A8,
		size,
		initialMapping: bank16(0),
		control(_address, value) {
			if (value === null) return undefined;
			if (value & 0x80) return OFF;
			return bank16(value & mask);
		},
	};
}

/**
 * Phoenix/Blizzard scheme: a fixed mapping that any control access disables;
 * re-enabling takes a power cycle (cold reset restores the initial mapping).
 */
function accessDisables(
	name: string,
	size: number,
	initialMapping: CartridgeMapping,
): CartType {
	return {
		name,
		machine: A8,
		size,
		initialMapping,
		control: () => OFF,
	};
}

/**
 * Turbosoft scheme: 8K banks at $A000 selected by the accessed address's
 * low bits; address bit 4 disables, the other bits are ignored.
 */
function turbosoft(name: string, size: number): CartType {
	const mask = size / 8 - 1;
	return {
		name,
		machine: A8,
		size,
		initialMapping: bankA(0),
		control(address) {
			if (address & 0x10) return OFF;
			return bankA(address & mask);
		},
	};
}

/**
 * Sequence scheme: every control access advances the 8K bank at $A000
 * through 0..banks-1, then (when `disables`) an off position, then - when
 * `wraps` - back to bank 0 (otherwise off is final until a power cycle).
 * The current position is recovered from the mapping itself.
 */
function sequential(
	name: string,
	size: number,
	opts: { disables: boolean; wraps: boolean },
): CartType {
	const banks = size / 8;
	return {
		name,
		machine: A8,
		size,
		initialMapping: bankA(0),
		control(_address, _value, current) {
			const bank = typeof current.areaA000 === "number" ? current.areaA000 : -1;
			if (bank < 0) {
				return opts.wraps ? bankA(0) : undefined;
			}
			if (bank + 1 < banks) return bankA(bank + 1);
			return opts.disables ? OFF : bankA(0);
		},
	};
}

/**
 * J(atari)Cart scheme: 8K banks at $A000 selected by the low bits of the
 * *address* written; address bit 7 disables.
 */
function jcart(name: string, size: number): CartType {
	const mask = size / 8 - 1;
	return {
		name,
		machine: A8,
		size,
		initialMapping: bankA(0),
		control(address, value) {
			if (value === null) return undefined;
			if (address & 0x80) return OFF;
			return bankA(address & mask);
		},
	};
}

/**
 * SIC! scheme: 16K banks with independently switchable 8K halves and a
 * readable control register (its exact written value rides in
 * `mapping.state`). Bit 5 enables $8000 (the lower subbank), bit 6
 * *disables* $A000 (the upper subbank), `bankOf` extracts the bank number;
 * bit 7 is the flash write-protect (not emulated, but it reads back).
 */
function sic(
	name: string,
	size: number,
	regEnd: number,
	bankOf: (value: number) => number,
): CartType {
	return {
		name,
		machine: A8,
		size,
		initialMapping: { area8000: "ram", areaA000: 1, state: 0 },
		control(address, value) {
			if (value === null || address > regEnd) return undefined;
			const bank = bankOf(value);
			return {
				area8000: value & 0x20 ? bank * 2 : "ram",
				areaA000: value & 0x40 ? "ram" : bank * 2 + 1,
				state: value,
			};
		},
		controlRead(address, current) {
			return address <= regEnd ? (current.state ?? 0) : 0xff;
		},
	};
}

/**
 * The!Cart scheme, register subset (matching atari800's coverage): $D5A0
 * and $D5A1 hold the bank number's low/high bytes and writing either also
 * enables the cartridge; $D5A2 bit 0 enables/disables. All three registers
 * read back. `state` = 14-bit bank | enabled << 14; `bankMask` limits the
 * bank to the banks the image actually has.
 */
function theCart(name: string, size: number, bankMask: number): CartType {
	return {
		name,
		machine: A8,
		size,
		initialMapping: { area8000: "ram", areaA000: 0, state: 1 << 14 },
		control(address, value, current) {
			if (value === null || address < 0xd5a0 || address > 0xd5a2) {
				return undefined;
			}
			const state = current.state ?? 0;
			let bank = state & 0x3fff;
			let enabled: boolean;
			if (address === 0xd5a0) {
				bank = (bank & 0x3f00) | value;
				enabled = true;
			} else if (address === 0xd5a1) {
				bank = (bank & 0x00ff) | ((value & 0x3f) << 8);
				enabled = true;
			} else {
				enabled = (value & 0x01) !== 0;
			}
			return {
				area8000: "ram",
				areaA000: enabled ? bank & bankMask : "ram",
				state: bank | (enabled ? 1 << 14 : 0),
			};
		},
		controlRead(address, current) {
			const state = current.state ?? 0;
			if (address === 0xd5a0) return state & 0xff;
			if (address === 0xd5a1) return (state >> 8) & 0x3f;
			if (address === 0xd5a2) return state >> 14;
			return 0xff;
		},
	};
}

/**
 * Undo an Atrax-style protection scramble. The dump is EPROM-addressed:
 * the byte for decoded address L sits at the dump address formed by routing
 * each cartridge-port/bank line i to EPROM pin `addrMap[i]`, and decoded
 * data bit i is EPROM output bit `dataMap[i]` (both straight from the
 * cart.txt pin tables).
 */
function descramble(
	dump: Uint8Array,
	addrMap: readonly number[],
	dataMap: readonly number[],
): Uint8Array {
	const out = new Uint8Array(dump.length);
	for (let address = 0; address < dump.length; address++) {
		let scrambled = 0;
		for (let bit = 0; bit < addrMap.length; bit++) {
			if (address & (1 << bit)) scrambled |= 1 << addrMap[bit]!;
		}
		const byte = dump[scrambled]!;
		let value = 0;
		for (let bit = 0; bit < 8; bit++) {
			if (byte & (1 << dataMap[bit]!)) value |= 1 << bit;
		}
		out[address] = value;
	}
	return out;
}

// Atrax 128K (type 68): 17 address lines (13 in-window + 4 bank), permuted
// within the chip; banks land on straight lines.
const ATRAX_ADDR = [5, 6, 7, 12, 0, 1, 2, 3, 4, 8, 10, 11, 9, 13, 14, 15, 16];
const ATRAX_DATA = [5, 6, 2, 4, 0, 1, 7, 3];

// Atrax SDX (types 48/49): the bank-select lines are permuted into *low*
// EPROM lines, so the permutation spans the whole address space. Type 49
// adds a straight A16.
const ATRAX_SDX_ADDR = [6, 7, 12, 15, 14, 13, 8, 5, 4, 3, 0, 1, 2, 9, 11, 10];
const ATRAX_SDX_DATA = [4, 0, 5, 1, 7, 6, 3, 2];

// Decoded-Atrax control (types 17 and 68 after descrambling): written value
// bit 7 disables, low four bits select the 8K bank at $A000.
function atraxControl(
	_address: number,
	value: number | null,
): CartridgeMapping | undefined {
	if (value === null) return undefined;
	return value & 0x80 ? OFF : bankA(value & 0x0f);
}

// Atarimax 1MB control (types 42/75): the *address* written selects -
// $D500-$D57F pick the bank by A0-A6, $D580-$D5FF (A7 set) disable.
function atarimax1mbControl(
	address: number,
	value: number | null,
): CartridgeMapping | undefined {
	if (value === null) return undefined;
	return address & 0x80 ? OFF : bankA(address & 0x7f);
}

/**
 * The OSS "not useful" control states drive two ROM chips at once and the
 * bus sees the binary AND of their bytes; synthesize those two combinations
 * as extra 4K banks (indices 4 and 5) that the mappings reference.
 */
function ossPrepare(a: number, b: number, c: number, d: number) {
	return (rom: Uint8Array): Uint8Array => {
		const out = new Uint8Array(24 * 1024);
		out.set(rom);
		for (let i = 0; i < 4096; i++) {
			out[16384 + i] = rom[a * 4096 + i]! & rom[b * 4096 + i]!;
			out[20480 + i] = rom[c * 4096 + i]! & rom[d * 4096 + i]!;
		}
		return out;
	};
}

/**
 * XE Multicart scheme (the cart.txt entry is thin; see also the blog it
 * references): boots with the image's last 8K at $A000. A written value
 * selects the bank by its low bits; bit 7 selects 16K mode, mapping the
 * even-aligned bank pair across $8000-$BFFF.
 */
function xeMulticart(size: number): CartType {
	const banks = size / 8;
	return {
		name: `XE Multicart (${size}KB)`,
		machine: A8,
		size,
		initialMapping: bankA(banks - 1),
		control(_address, value) {
			if (value === null) return undefined;
			const bank = value & (banks - 1);
			if (value & 0x80) {
				return { area8000: bank & ~1, areaA000: (bank & ~1) + 1 };
			}
			return bankA(bank);
		},
	};
}

/**
 * JRC64 scheme: 8K banks at $A000, selected by bits 4-6 of a value written
 * to $D500-$D57F; value bit 7 disables. Writes to $D580-$D5FF address the
 * optional RAM-disk, which is not emulated. The interleaved dump variant
 * reorders its banks to linear at load.
 */
function jrc64(name: string, prepare?: CartType["prepare"]): CartType {
	return {
		name,
		machine: A8,
		size: 64,
		prepare,
		initialMapping: bankA(0),
		control(address, value) {
			if (value === null || address > 0xd57f) return undefined;
			if (value & 0x80) return OFF;
			return bankA((value >> 4) & 0x07);
		},
	};
}

// Info taken from https://github.com/atari800/atari800/blob/master/DOC/cart.txt
// (a copy is kept in external.local). Last modified on Oct 18, 2024 (commit
// e87b0ca553bb2731f1fa9b6d54a4a45b6f8df166). 5200 types and types needing
// writable cartridge memory (RAM/EEPROM/flash programming) are not
// implemented; neither are Bounty Bob (18: in-window bank triggers), MDDOS
// (81: bank order unverified upstream), and COS32 (82: a time-limited
// mapping needs a cycle clock).
export const CART_TYPES: Record<number, CartType> = {
	1: {
		name: "Standard 8 KB cartridge",
		machine: A8,
		size: 8,

		initialMapping: {
			area8000: "ram",
			areaA000: 0,
		},
	},
	2: {
		name: "Standard 16 KB cartridge",
		machine: A8,
		size: 16,

		initialMapping: {
			area8000: 0,
			areaA000: 1,
		},
	},
	3: {
		name: "OSS two chip 16 KB cartridge (034M)",
		machine: A8,
		size: 16,

		// Bank 3 is fixed at $B000; the $A000 window switches by an access
		// (read or write) to $D5xx, decoded by A0-A3. Banks 4/5 are the
		// synthesized AND combinations (see ossPrepare).
		prepare: ossPrepare(0, 1, 1, 2),
		initialMapping: { area8000: "ram", areaA000: [0, 3] },
		control(address) {
			switch (address & 0x0f) {
				case 0x0:
					return { area8000: "ram", areaA000: [0, 3] };
				case 0x1:
					return { area8000: "ram", areaA000: [4, 3] }; // banks 0 AND 1
				case 0x3:
				case 0x7:
					return { area8000: "ram", areaA000: [1, 3] };
				case 0x4:
					return { area8000: "ram", areaA000: [2, 3] };
				case 0x5:
					return { area8000: "ram", areaA000: [5, 3] }; // banks 1 AND 2
				case 0x2:
				case 0x6:
					return { area8000: "ram", areaA000: [null, 3] }; // ROM off, $FF
				default:
					return OFF; // $D5x8-$D5xF
			}
		},
	},
	4: {
		name: "Standard 32 KB 5200 cartridge",
		machine: "5200",
		size: 32,
	},
	5: {
		name: "DB 32 KB cartridge",
		machine: A8,
		size: 32,

		// Bank 3 fixed at $A000; an access picks the $8000 bank by A0-A1.
		initialMapping: { area8000: 0, areaA000: 3 },
		control(address) {
			return { area8000: address & 0x03, areaA000: 3 };
		},
	},
	6: {
		name: "Two chip 16 KB 5200 cartridge",
		machine: "5200",
		size: 16,
	},
	7: {
		name: "Bounty Bob Strikes Back 40 KB 5200 cartridge",
		machine: "5200",
		size: 40,
	},
	8: williams("64 KB Williams cartridge", 64),
	9: descendingBanks("Express 64 KB cartridge", 64, 0xd570),
	10: descendingBanks("Diamond 64 KB cartridge", 64, 0xd5d0),
	11: descendingBanks("SpartaDOS X 64 KB cartridge", 64, 0xd5e0),
	12: xegs("XEGS 32 KB cartridge", 32, false),
	13: xegs("XEGS 64 KB cartridge (banks 0-7)", 64, false),
	14: xegs("XEGS 128 KB cartridge", 128, false),
	15: {
		name: "OSS one chip 16 KB cartridge",
		machine: A8,
		size: 16,

		initialMapping: {
			area8000: "ram",
			areaA000: [1, 0],
		},

		// Per cart.txt the bank is selected by an "access" to $D500-$D5FF, i.e.
		// a read OR a write - so `value` is ignored (this fires on reads too).
		control(address) {
			switch (address & 0x9) {
				case 0x0:
					// - A3=0, A0=0 - selects bank 1
					return { area8000: "ram", areaA000: [1, 0] };
				case 0x1:
					// - A3=0, A0=1 - selects bank 3
					return { area8000: "ram", areaA000: [3, 0] };
				case 0x8:
					// - A3=1, A0=0 - disables cartridge (enables computer's memory
					//   in address space between $A000 and $BFFF)
					return { area8000: "ram", areaA000: "ram" };
				default:
					// - A3=1, A0=1 - selects bank 2
					return { area8000: "ram", areaA000: [2, 0] };
			}
		},
	},
	16: {
		name: "One chip 16 KB 5200 cartridge",
		machine: "5200",
		size: 16,
	},
	17: {
		name: "Decoded Atrax 128 KB cartridge",
		machine: A8,
		size: 128,

		initialMapping: bankA(0),
		control: atraxControl,
	},
	18: {
		name: "Bounty Bob Strikes Back 40 KB cartridge",
		machine: A8,
		size: 40,
		// Not implemented: banks switch on accesses to $8FF6-9/$9FF6-9,
		// *inside* the ROM windows - needs read-sensitive pages (pageView
		// returning undefined) and a window-access hook.
	},
	19: {
		name: "Standard 8 KB 5200 cartridge",
		machine: "5200",
		size: 8,
	},
	20: {
		name: "Standard 4 KB 5200 cartridge",
		machine: "5200",
		size: 4,
	},
	21: {
		name: "Right slot 8 KB cartridge",
		machine: "800",
		size: 8,

		initialMapping: {
			area8000: 0,
			areaA000: "ram",
		},
	},
	22: williams("32 KB Williams cartridge", 32),
	23: xegs("XEGS 256 KB cartridge", 256, false),
	24: xegs("XEGS 512 KB cartridge", 512, false),
	25: xegs("XEGS 1 MB cartridge", 1024, false),
	26: megacart("MegaCart 16 KB cartridge", 16),
	27: megacart("MegaCart 32 KB cartridge", 32),
	28: megacart("MegaCart 64 KB cartridge", 64),
	29: megacart("MegaCart 128 KB cartridge", 128),
	30: megacart("MegaCart 256 KB cartridge", 256),
	31: megacart("MegaCart 512 KB cartridge", 512),
	32: megacart("MegaCart 1 MB cartridge", 1024),
	33: xegs("Switchable XEGS 32 KB cartridge", 32, true),
	34: xegs("Switchable XEGS 64 KB cartridge", 64, true),
	35: xegs("Switchable XEGS 128 KB cartridge", 128, true),
	36: xegs("Switchable XEGS 256 KB cartridge", 256, true),
	37: xegs("Switchable XEGS 512 KB cartridge", 512, true),
	38: xegs("Switchable XEGS 1 MB cartridge", 1024, true),
	39: accessDisables("Phoenix 8 KB cartridge", 8, bankA(0)),
	40: accessDisables("Blizzard 16 KB cartridge", 16, {
		area8000: 0,
		areaA000: 1,
	}),
	41: {
		name: "Atarimax 128 KB Flash cartridge",
		machine: A8,
		size: 128,

		// The address written selects: $D500-$D50F pick the bank by A0-A3,
		// $D510-$D51F disable, $D520+ is ignored. Flash programming is not
		// emulated.
		initialMapping: bankA(0),
		control(address, value) {
			if (value === null) return undefined;
			if (address <= 0xd50f) return bankA(address & 0x0f);
			if (address <= 0xd51f) return OFF;
			return undefined;
		},
	},
	42: {
		name: "Atarimax 1 MB Flash cartridge (old)",
		machine: A8,
		size: 1024,

		// The address written selects the bank (A0-A6); A7 set disables.
		// Powers up with the last bank. Flash programming is not emulated.
		initialMapping: bankA(127),
		control: atarimax1mbControl,
	},
	43: {
		name: "SpartaDOS X 128 KB cartridge",
		machine: A8,
		size: 128,

		initialMapping: bankA(0),
		control: sdx128Control,
	},
	44: {
		name: "OSS 8 KB cartridge",
		machine: A8,
		size: 8,

		// The one-chip OSS board with a half-size ROM: bank 0 fixed at $B000,
		// the $A000 window switched by an access, decoded by A0 and A3.
		initialMapping: { area8000: "ram", areaA000: [1, 0] },
		control(address) {
			switch (address & 0x9) {
				case 0x0:
				case 0x1:
					return { area8000: "ram", areaA000: [1, 0] };
				case 0x8:
					return OFF;
				default:
					return { area8000: "ram", areaA000: [0, 0] };
			}
		},
	},
	45: {
		name: "OSS two chip 16 KB cartridge (043M)",
		machine: A8,
		size: 16,

		// Like type 3 with the physical chip pairing: banks 4/5 are the
		// synthesized AND combinations 0&2 and 1&2.
		prepare: ossPrepare(0, 2, 1, 2),
		initialMapping: { area8000: "ram", areaA000: [0, 3] },
		control(address) {
			switch (address & 0x0f) {
				case 0x0:
					return { area8000: "ram", areaA000: [0, 3] };
				case 0x1:
					return { area8000: "ram", areaA000: [4, 3] }; // banks 0 AND 2
				case 0x3:
				case 0x7:
					return { area8000: "ram", areaA000: [2, 3] };
				case 0x4:
					return { area8000: "ram", areaA000: [1, 3] };
				case 0x5:
					return { area8000: "ram", areaA000: [5, 3] }; // banks 1 AND 2
				case 0x2:
				case 0x6:
					return { area8000: "ram", areaA000: [null, 3] }; // ROM off, $FF
				default:
					return OFF; // $D5x8-$D5xF
			}
		},
	},
	46: accessDisables("Blizzard 4 KB cartridge", 4, {
		// A12 is unconnected: the 4K image mirrors across both halves.
		area8000: "ram",
		areaA000: [0, 0],
	}),
	47: {
		name: "AST 32 KB cartridge",
		machine: A8,
		size: 32,

		// 128 x 256B banks. Power-on: bank 0 mirrored across $A000-$BFFF (the
		// mirror is synthesized as an 8K block at bank index 4) and visible at
		// $D500-$D5FF. Each write disables the $A000 window and advances the
		// window counter (wrapping after bank 31, per cart.txt); the counter
		// rides in state and controlRead serves the window from it.
		prepare(rom) {
			const out = new Uint8Array(40 * 1024);
			out.set(rom);
			for (let i = 0; i < 8192; i += 256) {
				out.set(rom.subarray(0, 256), 32768 + i);
			}
			return out;
		},
		initialMapping: { area8000: "ram", areaA000: 4, state: 0 },
		control(_address, value, current) {
			if (value === null) return undefined;
			return {
				area8000: "ram",
				areaA000: "ram",
				state: ((current.state ?? 0) + 1) & 31,
			};
		},
		controlRead(address, current, rom) {
			return rom[(current.state ?? 0) * 256 + (address & 0xff)]!;
		},
	},
	48: {
		...descendingBanks("Atrax SDX 64 KB cartridge", 64, 0xd5e0),
		prepare: (rom) => descramble(rom, ATRAX_SDX_ADDR, ATRAX_SDX_DATA),
	},
	49: {
		name: "Atrax SDX 128 KB cartridge",
		machine: A8,
		size: 128,

		prepare: (rom) => descramble(rom, [...ATRAX_SDX_ADDR, 16], ATRAX_SDX_DATA),
		initialMapping: bankA(0),
		control: sdx128Control,
	},
	50: turbosoft("Turbosoft 64 KB cartridge", 64),
	51: turbosoft("Turbosoft 128 KB cartridge", 128),
	52: sequential("Ultracart 32 KB cartridge", 32, {
		disables: true,
		wraps: true,
	}),
	53: {
		name: "Low bank 8 KB cartridge",
		machine: A8,
		size: 8,

		initialMapping: { area8000: 0, areaA000: "ram" },
	},
	54: sic("SIC! 128 KB cartridge", 128, 0xd51f, (v) => v & 0x07),
	55: sic("SIC! 256 KB cartridge", 256, 0xd51f, (v) => v & 0x0f),
	56: sic("SIC! 512 KB cartridge", 512, 0xd51f, (v) => v & 0x1f),
	57: {
		name: "Standard 2 KB cartridge",
		machine: A8,
		size: 2,

		// The chip only decodes with A11 and A12 high: $B800-$BFFF.
		initialMapping: { area8000: "ram", areaA000: [null, null, null, 0] },
	},
	58: {
		name: "Standard 4 KB cartridge",
		machine: A8,
		size: 4,

		// The chip only decodes with A12 high: $B000-$BFFF.
		initialMapping: { area8000: "ram", areaA000: [null, 0] },
	},
	59: {
		name: "Right slot 4 KB cartridge",
		machine: "800",
		size: 4,

		// The chip only decodes with A12 high: $9000-$9FFF.
		initialMapping: { area8000: [null, 0], areaA000: "ram" },
	},
	60: sequential("Blizzard 32 KB cartridge", 32, {
		disables: true,
		wraps: false,
	}),
	61: {
		name: "MegaMax 2 MB cartridge",
		machine: A8,
		size: 2048,

		// 16K banks selected by the accessed address's A0-A6; A7 disables.
		initialMapping: bank16(0),
		control(address) {
			if (address & 0x80) return OFF;
			return bank16(address & 0x7f);
		},
	},
	62: theCart("The!Cart 128 MB cartridge", 131072, 0x3fff),
	63: {
		name: "Flash MegaCart 4 MB cartridge",
		machine: A8,
		size: 4096,

		// 16K banks by written value at $D500-$D51F; 255 disables (bank 255
		// doesn't exist). The register reads back (initially 254). Flash
		// programming is not emulated.
		initialMapping: { ...bank16(254), state: 254 },
		control(address, value) {
			if (value === null || address > 0xd51f) return undefined;
			if (value === 0xff) {
				return { area8000: "ram", areaA000: "ram", state: 0xff };
			}
			return { ...bank16(value), state: value };
		},
		controlRead(address, current) {
			return address <= 0xd51f ? (current.state ?? 254) : 0xff;
		},
	},
	64: megacart("MegaCart 2 MB cartridge", 2048),
	65: theCart("The!Cart 32 MB cartridge", 32768, 0x0fff),
	66: theCart("The!Cart 64 MB cartridge", 65536, 0x1fff),
	67: {
		name: "XEGS 64 KB cartridge (banks 8-15)",
		machine: A8,
		size: 64,

		// The board variant where value bit 3 gates the $8000 window: clear
		// leaves it unconnected ($FF), set maps the bank picked by bits 0-2.
		// Power-up is random; 0 (window unmapped) is chosen, like atari800.
		initialMapping: { area8000: null, areaA000: 7 },
		control(_address, value) {
			if (value === null) return undefined;
			return {
				area8000: value & 0x08 ? value & 0x07 : null,
				areaA000: 7,
			};
		},
	},
	68: {
		name: "Atrax 128 KB cartridge",
		machine: A8,
		size: 128,

		// The scrambled (protection) dump of type 17; descrambled at load.
		prepare: (rom) => descramble(rom, ATRAX_ADDR, ATRAX_DATA),
		initialMapping: bankA(0),
		control: atraxControl,
	},
	69: sequential("aDawliah 32 KB cartridge", 32, {
		disables: false,
		wraps: true,
	}),
	70: sequential("aDawliah 64 KB cartridge", 64, {
		disables: false,
		wraps: true,
	}),
	71: {
		name: "Super Cart 64 KB 5200 cartridge (32K banks)",
		machine: "5200",
		size: 64,
	},
	72: {
		name: "Super Cart 128 KB 5200 cartridge (32K banks)",
		machine: "5200",
		size: 128,
	},
	73: {
		name: "Super Cart 256 KB 5200 cartridge (32K banks)",
		machine: "5200",
		size: 256,
	},
	74: {
		name: "Super Cart 512 KB 5200 cartridge (32K banks)",
		machine: "5200",
		size: 512,
	},
	75: {
		name: "Atarimax 1 MB Flash cartridge (new)",
		machine: A8,
		size: 1024,

		// Type 42's scheme, but powers up with bank 0.
		initialMapping: bankA(0),
		control: atarimax1mbControl,
	},
	76: williams("16 KB Williams cartridge", 16),
	77: {
		name: "MIO diagnostics 8KB cartridge",
		machine: A8,
		size: 8,

		// An SDX board with a single bank: $D5E0 enables it, the SDX disable
		// region turns it off.
		initialMapping: bankA(0),
		control(address) {
			if (address === 0xd5e0) return bankA(0);
			if (address >= 0xd5e8 && address <= 0xd5ef) return OFF;
			return undefined;
		},
	},
	78: {
		name: "Telelink II cartridge",
		machine: A8,
		size: 8,
		// Not implemented: battery-backed NVRAM at $9000 (writable memory).
	},
	79: {
		name: "Pronto cartridge",
		machine: A8,
		size: 16,
		// Not implemented: battery-backed NVRAM at $8F00 (writable memory).
	},
	80: jrc64("JRC64 cartridge (linear)"),
	81: {
		name: "MDDOS cartridge",
		machine: A8,
		size: 64,
		// Not implemented: cart.txt marks the only known dump's bank order as
		// unverified.
	},
	82: {
		name: "COS32 cartridge",
		machine: A8,
		size: 32,
		// Not implemented: control accesses map the temporary bank for ~23
		// cycles - a time-limited mapping needs a machine cycle clock.
	},
	83: sic(
		"SIC+ 1024 KB cartridge",
		1024,
		0xd53f,
		// Bits 0-4 plus bit 7 as bank bit 5.
		(v) => (v & 0x1f) | ((v & 0x80) >> 2),
	),
	84: {
		name: "Corina 1M+8K EEPROM",
		machine: A8,
		size: 1032,
		// Not implemented: banked EEPROM (writable memory).
	},
	85: {
		name: "Corina 512K + 512K SRAM + 8K EEPROM",
		machine: A8,
		size: 520,
		// Not implemented: banked SRAM and EEPROM (writable memory).
	},
	86: xeMulticart(8),
	87: xeMulticart(16),
	88: xeMulticart(32),
	89: xeMulticart(64),
	90: xeMulticart(128),
	91: xeMulticart(256),
	92: xeMulticart(512),
	93: xeMulticart(1024),
	94: {
		name: "Ram-Cart 64 KB cartridge",
		machine: A8,
		size: 64,
		// Not implemented (the whole Ram-Cart family): battery-backed SRAM.
	},
	95: {
		name: "Ram-Cart 128 KB cartridge",
		machine: A8,
		size: 128,
	},
	96: {
		name: "Double Ram-Cart 2x128/256 KB cartridge",
		machine: A8,
		size: 256,
	},
	97: {
		name: "Ram-Cart 1 MB cartridge",
		machine: A8,
		size: 1024,
	},
	98: {
		name: "Ram-Cart 2 MB cartridge",
		machine: A8,
		size: 2048,
	},
	99: {
		name: "Ram-Cart 4 MB cartridge",
		machine: A8,
		size: 4096,
	},
	100: {
		name: "Ram-Cart 8 MB cartridge",
		machine: A8,
		size: 8192,
	},
	101: {
		name: "Ram-Cart 16 MB cartridge",
		machine: A8,
		size: 16384,
	},
	102: {
		name: "Ram-Cart 32 MB cartridge",
		machine: A8,
		size: 32768,
	},
	103: {
		name: "SiDiCar 32 KB cartridge",
		machine: A8,
		size: 32,
		// Not implemented: battery-backed SRAM.
	},
	104: jcart("J(atari)Cart8(kB)", 8),
	105: jcart("J(atari)Cart16(kB)", 16),
	106: jcart("J(atari)Cart32(kB)", 32),
	107: jcart("J(atari)Cart64(kB)", 64),
	108: jcart("J(atari)Cart128(kB)", 128),
	109: jcart("J(atari)Cart256(kB)", 256),
	110: jcart("J(atari)Cart512(kB)", 512),
	111: jcart("J(atari)Cart1024(kB)", 1024),
	112: {
		name: "DCart 512 KB",
		machine: A8,
		size: 512,

		// 8K banks by the written address's A0-A5 ($D500-$D53F); A7 set
		// ($D580+) disables. $D5xx reads mirror the current bank's $B5xx page
		// even while disabled - the bank number rides in state.
		initialMapping: { area8000: "ram", areaA000: 0, state: 0 },
		control(address, value, current) {
			if (value === null) return undefined;
			if (address & 0x80) {
				return {
					area8000: "ram",
					areaA000: "ram",
					state: current.state ?? 0,
				};
			}
			if (address > 0xd53f) return undefined;
			const bank = address & 0x3f;
			return { area8000: "ram", areaA000: bank, state: bank };
		},
		controlRead(address, current, rom) {
			return rom[(current.state ?? 0) * 8192 + 0x1500 + (address & 0xff)]!;
		},
	},
	159: {
		name: "Bounty Bob Strikes Back 40 KB 5200 alt.",
		machine: "5200",
		size: 40,
	},
	160: jrc64("JRC64 cartridge (interleaved)", (rom) => {
		// The dump stores banks in the order below; reorder to linear.
		const order = [7, 3, 5, 1, 6, 2, 4, 0];
		const out = new Uint8Array(rom.length);
		for (let slot = 0; slot < 8; slot++) {
			out.set(
				rom.subarray(slot * 8192, slot * 8192 + 8192),
				order[slot]! * 8192,
			);
		}
		return out;
	}),
};

/**
 * What the machine needs from whatever is plugged into the cartridge slot.
 * {@link RomCartridge} - a plain `.car`/raw ROM image - is the shipped
 * implementation; special hardware (an RTime-8, a passthrough cart with its
 * own slot) can implement this directly.
 *
 * `read`/`write` (from {@link Memory}) receive the cartridge address ranges:
 * $8000-$BFFF for whatever areas the cartridge claims, and $D500-$D5FF for
 * the control region.
 */
export interface Cartridge extends AtariMemory {
	/** Whether the cartridge currently decodes $8000-$9FFF. */
	readonly has8000To9fff: boolean;
	/** Whether the cartridge currently decodes $A000-$BFFF. */
	readonly hasA000ToBfff: boolean;
	reset(cold: boolean): void;
	/**
	 * Fired after anything changes which addresses the cartridge decodes or
	 * what bytes they map. Set by the MMU so it can rebuild its page tables;
	 * implementations must call it on every mapping change (bank switches
	 * included) and on a mapping-restoring reset. Results of the inherited
	 * {@link AtariMemory.pageView} must stay valid until it fires; the MMU
	 * only consults pageView for pages inside a claimed area.
	 */
	onMappingChanged: (() => void) | undefined;
}

const CART_HEADER_SIZE = 16;

/**
 * The raw ROM bytes for a built-in (PORTB-banked) 8K slot - XL/XE BASIC or the
 * XEGS game. Raw ROM passes through unchanged; a standard-8K `.car` (CART
 * type 1, the canonical form for an $A000 8K image) is unwrapped to its ROM.
 * Any other `.car` (a banked or wrong-size cartridge) is rejected: it can't
 * stand in for an internal 8K ROM. This lets a host hand the machine canonical
 * `.car` bytes for these slots without unwrapping them itself.
 */
export function builtinSlotRom(bytes: Uint8Array): Uint8Array {
	const isCar =
		bytes[0] === 0x43 && // 'C'
		bytes[1] === 0x41 && // 'A'
		bytes[2] === 0x52 && // 'R'
		bytes[3] === 0x54; // 'T'
	if (!isCar) return bytes;

	const type =
		(((bytes[4] ?? 0) << 24) |
			((bytes[5] ?? 0) << 16) |
			((bytes[6] ?? 0) << 8) |
			(bytes[7] ?? 0)) >>>
		0;
	const rom = bytes.subarray(CART_HEADER_SIZE);
	if (type !== 1 || rom.length !== 8192) {
		throw new Error(
			`built-in 8K slot needs a standard-8K cartridge (CART type 1); ` +
				`got type ${type} of ${rom.length} bytes`,
		);
	}
	return rom;
}

/**
 * Create a cartridge from an image file (raw ROM or `.car`). The chokepoint
 * for cartridge construction: today every supported image is a
 * {@link RomCartridge}, but types that need their own implementation
 * (passthrough SDX, RAM and flash carts) will be dispatched from here
 * without callers changing.
 */
export function createCartridge(
	fileContents: Uint8Array,
	fileName?: string,
): Cartridge {
	return new RomCartridge(fileContents, fileName);
}

/**
 * A ROM-image cartridge: raw 8K/16K dumps or the `.car` container, with the
 * bank-switching schemes from `CART_TYPES`. The declarative
 * {@link CartridgeMapping} is normalized into `#slots` - one ROM byte offset
 * (or -1 for "reads $FF") per 2K slot of $8000-$BFFF - so every access is a
 * single indexed lookup regardless of the type's bank granularity.
 */
export class RomCartridge implements Cartridge {
	#rom: Uint8Array;
	#type: CartType;
	#mapping!: CartridgeMapping; // set via #applyMapping in the constructor

	// The normalized mapping: for each 2K slot of $8000-$BFFF, the ROM byte
	// offset it maps, or -1 for unmapped (reads $FF, and covers "ram" slots,
	// which the MMU never routes here anyway).
	#slots = new Int32Array(8).fill(-1);

	/** See {@link Cartridge.onMappingChanged}. */
	onMappingChanged: (() => void) | undefined;

	constructor(fileContents: Uint8Array, fileName?: string) {
		const format = detectFileFormat(fileContents, fileName);

		switch (format) {
			case "raw-cart-8k-8000-9fff":
				this.#type = CART_TYPES[21]!;
				this.#rom = fileContents;
				break;

			case "raw-cart-8k-a000-bfff":
				this.#type = CART_TYPES[1]!;
				this.#rom = fileContents;
				break;

			case "raw-cart-16k":
				this.#type = CART_TYPES[2]!;
				this.#rom = fileContents;
				break;

			case "cart":
				{
					const b4 = fileContents[4];
					const b5 = fileContents[5];
					const b6 = fileContents[6];
					const b7 = fileContents[7];

					if (
						b4 === undefined ||
						b5 === undefined ||
						b6 === undefined ||
						b7 === undefined
					) {
						throw new Error("Cartridge image is corrupt");
					}

					const typeNo = (b4 << 24) | (b5 << 16) | (b6 << 8) | b7;
					const type = CART_TYPES[typeNo];
					if (!type) {
						throw new Error(`Unsupported cartridge type #${typeNo}`);
					}

					if (!type.initialMapping) {
						throw new Error(
							`Cartridge type #${typeNo} (${type.name}) is not supported yet`,
						);
					}

					if (type.size * 1024 !== fileContents.length - 16) {
						throw new Error(
							`Wrong cartridge size (expected ${type.size * 1024 + 16} found ${fileContents.length})`,
						);
					}

					// TODO: Check checksum

					this.#type = type;
					this.#rom = fileContents.subarray(16);
				}
				break;

			default:
				throw new Error("Unsupported cartridge image format");
		}

		if (this.#type.prepare) {
			this.#rom = this.#type.prepare(this.#rom);
		}
		this.#applyMapping(this.#type.initialMapping!);
	}

	// Install a mapping: keep the declarative form (for the area getters) and
	// normalize it into #slots. This is the only place the AreaMapping shapes
	// (one 8K bank, two 4K, four 2K, "ram") are interpreted.
	#applyMapping(mapping: CartridgeMapping): void {
		this.#mapping = mapping;
		this.#normalizeArea(mapping.area8000, 0);
		this.#normalizeArea(mapping.areaA000, 4);
	}

	#normalizeArea(area: AreaMapping, firstSlot: number): void {
		if (area === "ram") {
			this.#slots.fill(-1, firstSlot, firstSlot + 4);
		} else if (!Array.isArray(area)) {
			// One 8K bank.
			for (let i = 0; i < 4; i++) {
				this.#slots[firstSlot + i] =
					area === null ? -1 : area * 8192 + i * 2048;
			}
		} else if (area.length === 2) {
			// Two 4K banks.
			for (let i = 0; i < 2; i++) {
				const bank = area[i]!;
				this.#slots[firstSlot + i * 2] = bank === null ? -1 : bank * 4096;
				this.#slots[firstSlot + i * 2 + 1] =
					bank === null ? -1 : bank * 4096 + 2048;
			}
		} else {
			// Four 2K banks.
			for (let i = 0; i < 4; i++) {
				const bank = area[i]!;
				this.#slots[firstSlot + i] = bank === null ? -1 : bank * 2048;
			}
		}
	}

	get has8000To9fff(): boolean {
		return this.#mapping.area8000 !== "ram";
	}

	get hasA000ToBfff(): boolean {
		return this.#mapping.areaA000 !== "ram";
	}

	#views = new Map<number, Uint8Array>();

	/**
	 * A 256-byte view of the ROM as currently banked at `page` (addresses
	 * `page << 8` up), for the MMU's fast page tables - or `null` when the
	 * bank at that position is unmapped or points past the image (reads
	 * $FF). Only meaningful for pages inside an area the mapping covers
	 * (check {@link has8000To9fff} / {@link hasA000ToBfff} first). Banks are
	 * 2K/4K/8K, so a page never straddles two banks.
	 */
	pageView(page: number): Uint8Array | null {
		const offset = this.#slots[(page - 0x80) >> 3]!;
		if (offset < 0) return null;
		const pageOffset = offset + ((page & 0x07) << 8);
		if (pageOffset + 0x100 > this.#rom.length) return null;
		let view = this.#views.get(pageOffset);
		if (!view) {
			view = this.#rom.subarray(pageOffset, pageOffset + 0x100);
			this.#views.set(pageOffset, view);
		}
		return view;
	}

	read(address: number, options: ReadOptions): number {
		if (address >= 0xd500 && address <= 0xd5ff) {
			// Both hooks are pure, so a PEEK (debugger inspection) can take the
			// controlRead value and simply discard the mapping change - matters
			// for access-triggered carts like OSS, which switch on reads too.
			// The value is decoded before the switch applies.
			const value =
				this.#type.controlRead?.(address, this.#mapping, this.#rom) ?? 0xff;
			const mapping = this.#type.control?.(address, null, this.#mapping);
			if (mapping && !(options & ReadOptions.PEEK)) {
				this.#applyMapping(mapping);
				this.onMappingChanged?.();
			}
			return value;
		}

		const slot = (address - 0x8000) >> 11;
		if (slot < 0 || slot > 7) {
			throw new Error(`Invalid cartridge memory address ${address}`);
		}
		const offset = this.#slots[slot]!;
		// TODO(floating-bus): an unmapped or out-of-range cart read is undriven;
		// $FF is the XL/XE pull-up.
		if (offset < 0) {
			return 0xff;
		}
		return this.#rom[offset + (address & 0x7ff)] ?? 0xff;
	}

	write(address: number, value: number): void {
		if (address >= 0xd500 && address <= 0xd5ff) {
			const mapping = this.#type.control?.(address, value, this.#mapping);
			if (mapping) {
				this.#applyMapping(mapping);
				this.onMappingChanged?.();
			}
			return;
		}

		// Writes into the ROM areas do nothing (for now).
	}

	reset(cold: boolean) {
		if (cold) {
			this.#applyMapping(this.#type.initialMapping!);
			this.onMappingChanged?.();
		}
	}
}
