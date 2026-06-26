import { type Memory, ReadOptions } from "@sfotty-pie/sfotty";
import { detectFileFormat } from "./detect-file-format.ts";

export interface CartType {
	name: string;
	machine: "800/XL/XE" | "800" | "5200";
	size: number;

	initialMapping?: CartridgeMapping;
	control?(
		address: number,
		value: number | null,
		setMapping: (mapping: CartridgeMapping) => void,
	): number; // 0xff
	read?(
		address: number,
		contents: Uint8Array,
		mapping: CartridgeMapping,
	): number; // 0xff
	write?(
		address: number,
		value: number,
		contents: Uint8Array,
		mapping: CartridgeMapping,
	): void; // ignore
}

// Info taken from https://github.com/atari800/atari800/blob/master/DOC/cart.txt
// Last modified on Oct 18, 2024 (commit e87b0ca553bb2731f1fa9b6d54a4a45b6f8df166)
export const CART_TYPES: Record<number, CartType> = {
	1: {
		name: "Standard 8 KB cartridge",
		machine: "800/XL/XE",
		size: 8,

		initialMapping: {
			area8000: "ram",
			areaA000: 0,
		},
	},
	2: {
		name: "Standard 16 KB cartridge",
		machine: "800/XL/XE",
		size: 16,

		initialMapping: {
			area8000: 0,
			areaA000: 1,
		},
	},
	3: {
		name: "OSS two chip 16 KB cartridge (034M)",
		machine: "800/XL/XE",
		size: 16,
	},
	4: {
		name: "Standard 32 KB 5200 cartridge",
		machine: "5200",
		size: 32,
	},
	5: {
		name: "DB 32 KB cartridge",
		machine: "800/XL/XE",
		size: 32,
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
	8: {
		name: "64 KB Williams cartridge",
		machine: "800/XL/XE",
		size: 64,
	},
	9: {
		name: "Express 64 KB cartridge",
		machine: "800/XL/XE",
		size: 64,
	},
	10: {
		name: "Diamond 64 KB cartridge",
		machine: "800/XL/XE",
		size: 64,
	},
	11: {
		name: "SpartaDOS X 64 KB cartridge",
		machine: "800/XL/XE",
		size: 64,
	},
	12: {
		name: "XEGS 32 KB cartridge",
		machine: "800/XL/XE",
		size: 32,
	},
	13: {
		name: "XEGS 64 KB cartridge (banks 0-7)",
		machine: "800/XL/XE",
		size: 64,
	},
	14: {
		name: "XEGS 128 KB cartridge",
		machine: "800/XL/XE",
		size: 128,
	},
	15: {
		name: "OSS one chip 16 KB cartridge",
		machine: "800/XL/XE",
		size: 16,

		initialMapping: {
			area8000: "ram",
			areaA000: [1, 0],
		},

		// Per cart.txt the bank is selected by an "access" to $D500-$D5FF, i.e.
		// a read OR a write — so `value` is ignored (this fires on reads too).
		control(address, _value, setMapping) {
			switch (address & 0x9) {
				case 0x0:
					// - A3=0, A0=0 - selects bank 1
					setMapping({ area8000: "ram", areaA000: [1, 0] });
					break;
				case 0x1:
					// - A3=0, A0=1 - selects bank 3
					setMapping({ area8000: "ram", areaA000: [3, 0] });
					break;
				case 0x8:
					// - A3=1, A0=0 - disables cartridge (enables computer's memory in address space
					//   between $A000 and $BFFF)
					setMapping({ area8000: "ram", areaA000: "ram" });
					break;
				case 0x9:
					// - A3=1, A0=1 - selects bank 2
					setMapping({ area8000: "ram", areaA000: [2, 0] });
					break;
			}

			return 0xff;
		},
	},
	16: {
		name: "One chip 16 KB 5200 cartridge",
		machine: "5200",
		size: 16,
	},
	17: {
		name: "Decoded Atrax 128 KB cartridge",
		machine: "800/XL/XE",
		size: 128,
	},
	18: {
		name: "Bounty Bob Strikes Back 40 KB cartridge",
		machine: "800/XL/XE",
		size: 40,
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
	22: {
		name: "32 KB Williams cartridge",
		machine: "800/XL/XE",
		size: 32,
	},
	23: {
		name: "XEGS 256 KB cartridge",
		machine: "800/XL/XE",
		size: 256,
	},
	24: {
		name: "XEGS 512 KB cartridge",
		machine: "800/XL/XE",
		size: 512,
	},
	25: {
		name: "XEGS 1 MB cartridge",
		machine: "800/XL/XE",
		size: 1024,
	},
	26: {
		name: "MegaCart 16 KB cartridge",
		machine: "800/XL/XE",
		size: 16,
	},
	27: {
		name: "MegaCart 32 KB cartridge",
		machine: "800/XL/XE",
		size: 32,
	},
	28: {
		name: "MegaCart 64 KB cartridge",
		machine: "800/XL/XE",
		size: 64,
	},
	29: {
		name: "MegaCart 128 KB cartridge",
		machine: "800/XL/XE",
		size: 128,
	},
	30: {
		name: "MegaCart 256 KB cartridge",
		machine: "800/XL/XE",
		size: 256,
	},
	31: {
		name: "MegaCart 512 KB cartridge",
		machine: "800/XL/XE",
		size: 512,
	},
	32: {
		name: "MegaCart 1 MB cartridge",
		machine: "800/XL/XE",
		size: 1024,
	},
	33: {
		name: "Switchable XEGS 32 KB cartridge",
		machine: "800/XL/XE",
		size: 32,
	},
	34: {
		name: "Switchable XEGS 64 KB cartridge",
		machine: "800/XL/XE",
		size: 64,
	},
	35: {
		name: "Switchable XEGS 128 KB cartridge",
		machine: "800/XL/XE",
		size: 128,
	},
	36: {
		name: "Switchable XEGS 256 KB cartridge",
		machine: "800/XL/XE",
		size: 256,
	},
	37: {
		name: "Switchable XEGS 512 KB cartridge",
		machine: "800/XL/XE",
		size: 512,
	},
	38: {
		name: "Switchable XEGS 1 MB cartridge",
		machine: "800/XL/XE",
		size: 1024,
	},
	39: {
		name: "Phoenix 8 KB cartridge",
		machine: "800/XL/XE",
		size: 8,
	},
	40: {
		name: "Blizzard 16 KB cartridge",
		machine: "800/XL/XE",
		size: 16,
	},
	41: {
		name: "Atarimax 128 KB Flash cartridge",
		machine: "800/XL/XE",
		size: 128,
	},
	42: {
		name: "Atarimax 1 MB Flash cartridge (old)",
		machine: "800/XL/XE",
		size: 1024,

		// This bank-switched cartridge occupies 8 KB of address space between $A000
		// and $BFFF. The cartridge memory is divided into 128 banks, 8 KB each.
		// The seven lowest bits of the address written to $D500-$D57F select the bank
		// mapped to $A000-$BFFF, bit 7 disables the cartridge.
		//
		// Upon power up, bank $7F is selected. There is also another version of the
		// Atarimax cartridge that selects bank 0 on power up; see Type 75 for details.
		//
		// The cartridge also supports programming of the Flash ROM - this feature is
		// currently not emulated.

		initialMapping: {
			area8000: "ram",
			areaA000: 127,
		},
		// cart.txt says the bank is selected by the address *written* to
		// $D500-$D57F, so we switch on writes only (value !== null), unlike OSS
		// above.
		control(address, value, setMapping) {
			if (value !== null) {
				if (address >= 0xd500 && address <= 0xd57f) {
					if (value & 0x80) {
						// Disable
						setMapping({ area8000: "ram", areaA000: "ram" });
					} else {
						// Select bank 0-127
						const bank = value;
						setMapping({ area8000: "ram", areaA000: bank });
					}
				}
			}

			return 0xff;
		},
	},
	43: {
		name: "SpartaDOS X 128 KB cartridge",
		machine: "800/XL/XE",
		size: 128,
	},
	44: {
		name: "OSS 8 KB cartridge",
		machine: "800/XL/XE",
		size: 8,
	},
	45: {
		name: "OSS two chip 16 KB cartridge (043M)",
		machine: "800/XL/XE",
		size: 16,
	},
	46: {
		name: "Blizzard 4 KB cartridge",
		machine: "800/XL/XE",
		size: 4,
	},
	47: {
		name: "AST 32 KB cartridge",
		machine: "800/XL/XE",
		size: 32,
	},
	48: {
		name: "Atrax SDX 64 KB cartridge",
		machine: "800/XL/XE",
		size: 64,
	},
	49: {
		name: "Atrax SDX 128 KB cartridge",
		machine: "800/XL/XE",
		size: 128,
	},
	50: {
		name: "Turbosoft 64 KB cartridge",
		machine: "800/XL/XE",
		size: 64,
	},
	51: {
		name: "Turbosoft 128 KB cartridge",
		machine: "800/XL/XE",
		size: 128,
	},
	52: {
		name: "Ultracart 32 KB cartridge",
		machine: "800/XL/XE",
		size: 32,
	},
	53: {
		name: "Low bank 8 KB cartridge",
		machine: "800/XL/XE",
		size: 8,
	},
	54: {
		name: "SIC! 128 KB cartridge",
		machine: "800/XL/XE",
		size: 128,
	},
	55: {
		name: "SIC! 256 KB cartridge",
		machine: "800/XL/XE",
		size: 256,
	},
	56: {
		name: "SIC! 512 KB cartridge",
		machine: "800/XL/XE",
		size: 512,
	},
	57: {
		name: "Standard 2 KB cartridge",
		machine: "800/XL/XE",
		size: 2,
	},
	58: {
		name: "Standard 4 KB cartridge",
		machine: "800/XL/XE",
		size: 4,
	},
	59: {
		name: "Right slot 4 KB cartridge",
		machine: "800",
		size: 4,
	},
	60: {
		name: "Blizzard 32 KB cartridge",
		machine: "800/XL/XE",
		size: 32,
	},
	61: {
		name: "MegaMax 2 MB cartridge",
		machine: "800/XL/XE",
		size: 2048,
	},
	62: {
		name: "The!Cart 128 MB cartridge",
		machine: "800/XL/XE",
		size: 131072,
	},
	63: {
		name: "Flash MegaCart 4 MB cartridge",
		machine: "800/XL/XE",
		size: 4096,
	},
	64: {
		name: "MegaCart 2 MB cartridge",
		machine: "800/XL/XE",
		size: 2048,
	},
	65: {
		name: "The!Cart 32 MB cartridge",
		machine: "800/XL/XE",
		size: 32768,
	},
	66: {
		name: "The!Cart 64 MB cartridge",
		machine: "800/XL/XE",
		size: 65536,
	},
	67: {
		name: "XEGS 64 KB cartridge (banks 8-15)",
		machine: "800/XL/XE",
		size: 64,
	},
	68: {
		name: "Atrax 128 KB cartridge",
		machine: "800/XL/XE",
		size: 128,
	},
	69: {
		name: "aDawliah 32 KB cartridge",
		machine: "800/XL/XE",
		size: 32,
	},
	70: {
		name: "aDawliah 64 KB cartridge",
		machine: "800/XL/XE",
		size: 64,
	},
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
		machine: "800/XL/XE",
		size: 1024,
	},
	76: {
		name: "16 KB Williams cartridge",
		machine: "800/XL/XE",
		size: 16,
	},
	77: {
		name: "MIO diagnostics 8KB cartridge",
		machine: "800/XL/XE",
		size: 8,
	},
	78: {
		name: "Telelink II cartridge",
		machine: "800/XL/XE",
		size: 8,
	},
	79: {
		name: "Pronto cartridge",
		machine: "800/XL/XE",
		size: 16,
	},
	80: {
		name: "JRC64 cartridge (linear)",
		machine: "800/XL/XE",
		size: 64,
	},
	81: {
		name: "MDDOS cartridge",
		machine: "800/XL/XE",
		size: 64,
	},
	82: {
		name: "COS32 cartridge",
		machine: "800/XL/XE",
		size: 32,
	},
	83: {
		name: "SIC+ 1024 KB cartridge",
		machine: "800/XL/XE",
		size: 1024,
	},
	84: {
		name: "Corina 1M+8K EEPROM",
		machine: "800/XL/XE",
		size: 1024,
	},
	85: {
		name: "Corina 512K + 512K SRAM + 8K EEPROM",
		machine: "800/XL/XE",
		size: 512,
	},
	86: {
		name: "XE Multicart (8KB)",
		machine: "800/XL/XE",
		size: 8,
	},
	87: {
		name: "XE Multicart (16KB)",
		machine: "800/XL/XE",
		size: 16,
	},
	88: {
		name: "XE Multicart (32KB)",
		machine: "800/XL/XE",
		size: 32,
	},
	89: {
		name: "XE Multicart (64KB)",
		machine: "800/XL/XE",
		size: 64,
	},
	90: {
		name: "XE Multicart (128KB)",
		machine: "800/XL/XE",
		size: 128,
	},
	91: {
		name: "XE Multicart (256KB)",
		machine: "800/XL/XE",
		size: 256,
	},
	92: {
		name: "XE Multicart (512KB)",
		machine: "800/XL/XE",
		size: 512,
	},
	93: {
		name: "XE Multicart (1024KB)",
		machine: "800/XL/XE",
		size: 1024,
	},
	94: {
		name: "Ram-Cart 64 KB cartridge",
		machine: "800/XL/XE",
		size: 64,
	},
	95: {
		name: "Ram-Cart 128 KB cartridge",
		machine: "800/XL/XE",
		size: 128,
	},
	96: {
		name: "Double Ram-Cart 2x128/256 KB cartridge",
		machine: "800/XL/XE",
		size: 256,
	},
	97: {
		name: "Ram-Cart 1 MB cartridge",
		machine: "800/XL/XE",
		size: 1024,
	},
	98: {
		name: "Ram-Cart 2 MB cartridge",
		machine: "800/XL/XE",
		size: 2048,
	},
	99: {
		name: "Ram-Cart 4 MB cartridge",
		machine: "800/XL/XE",
		size: 4096,
	},
	100: {
		name: "Ram-Cart 8 MB cartridge",
		machine: "800/XL/XE",
		size: 8192,
	},
	101: {
		name: "Ram-Cart 16 MB cartridge",
		machine: "800/XL/XE",
		size: 16384,
	},
	102: {
		name: "Ram-Cart 32 MB cartridge",
		machine: "800/XL/XE",
		size: 32768,
	},
	103: {
		name: "SiDiCar 32 KB cartridge",
		machine: "800/XL/XE",
		size: 32,
	},
	104: {
		name: "J(atari)Cart8(kB)",
		machine: "800/XL/XE",
		size: 8,
	},
	105: {
		name: "J(atari)Cart16(kB)",
		machine: "800/XL/XE",
		size: 16,
	},
	106: {
		name: "J(atari)Cart32(kB)",
		machine: "800/XL/XE",
		size: 32,
	},
	107: {
		name: "J(atari)Cart64(kB)",
		machine: "800/XL/XE",
		size: 64,
	},
	108: {
		name: "J(atari)Cart128(kB)",
		machine: "800/XL/XE",
		size: 128,
	},
	109: {
		name: "J(atari)Cart256(kB)",
		machine: "800/XL/XE",
		size: 256,
	},
	110: {
		name: "J(atari)Cart512(kB)",
		machine: "800/XL/XE",
		size: 512,
	},
	111: {
		name: "J(atari)Cart1024(kB)",
		machine: "800/XL/XE",
		size: 1024,
	},
	112: {
		name: "DCart 512 KB",
		machine: "800/XL/XE",
		size: 512,
	},
	159: {
		name: "Bounty Bob Strikes Back 40 KB 5200 alt.",
		machine: "5200",
		size: 40,
	},
	160: {
		name: "RC64 cartridge (interleaved)",
		machine: "800/XL/XE",
		size: 64,
	},
};

/*

4000-7fff
8000-9fff: "ram"
a000-bfff  "ram"

*/

export type BankMapping = null | number;
export type AreaMapping =
	| "ram" // Not mapped by the cartridge, accesses RAM
	| BankMapping // 8k banks
	| [BankMapping, BankMapping] // 4K banks
	| [BankMapping, BankMapping, BankMapping, BankMapping]; // 2K banks

export type CartridgeMapping = {
	area8000: AreaMapping; // default: "ram"
	areaA000: AreaMapping; // no default
};

const CART_HEADER_SIZE = 16;

/**
 * The raw ROM bytes for a built-in (PORTB-banked) 8K slot — XL/XE BASIC or the
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

export class Cartridge implements Memory {
	#rom: Uint8Array;
	#type: CartType;
	#mapping: CartridgeMapping;

	constructor(fileContents: Uint8Array, fileName?: string) {
		const format = detectFileFormat(fileContents, fileName);

		switch (format) {
			case "raw-cart-8k-8000-9fff":
				this.#type = CART_TYPES[21]!;
				this.#mapping = this.#type.initialMapping!;
				this.#rom = fileContents;
				break;

			case "raw-cart-8k-a000-bfff":
				this.#type = CART_TYPES[1]!;
				this.#mapping = this.#type.initialMapping!;
				this.#rom = fileContents;
				break;

			case "raw-cart-16k":
				this.#type = CART_TYPES[2]!;
				this.#mapping = this.#type.initialMapping!;
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
					this.#mapping = type.initialMapping;
					this.#rom = fileContents.subarray(16);
				}
				break;

			default:
				throw new Error("Unsupported cartridge image format");
		}
	}

	get has8000To9fff(): boolean {
		return this.#mapping.area8000 !== "ram";
	}

	get hasA000ToBfff(): boolean {
		return this.#mapping.areaA000 !== "ram";
	}

	#getOffset(address: number): number | null {
		let mapping: AreaMapping;
		let base: number;

		if (address >= 0x8000 && address <= 0x9fff) {
			mapping = this.#mapping.area8000;
			base = 0x8000;
		} else if (address >= 0xa000 && address <= 0xbfff) {
			mapping = this.#mapping.areaA000;
			base = 0xa000;
		} else {
			throw new Error(`Invalid cartridge memory address ${address}`);
		}

		if (mapping === "ram") {
			throw new Error("Unmapped cartridge");
		}

		let bankMapping: BankMapping;
		let bankSize: number;

		if (!Array.isArray(mapping)) {
			// 8K banks
			bankMapping = mapping;
			bankSize = 8192;
		} else if (mapping.length === 2) {
			// 4K banks
			bankMapping = mapping[(address - base) >> 12]!;
			bankSize = 4096;
		} else {
			// 2K banks
			bankMapping = mapping[(address - base) >> 11]!;
			bankSize = 2048;
		}

		if (bankMapping === null) {
			return null;
		}

		return bankMapping * bankSize + (address & (bankSize - 1));
	}

	read(address: number, options: ReadOptions): number {
		if (address >= 0xd500 && address <= 0xd5ff) {
			// A PEEK (debugger inspection) must not bank-switch. Still run control
			// for its return value, but drop the mapping change — matters for
			// access-triggered carts like OSS, which switch on reads too.
			const peek = (options & ReadOptions.PEEK) !== 0;
			return (
				this.#type.control?.(address, null, (mapping) => {
					if (!peek) this.#mapping = mapping;
				}) ?? 0xff
			);
		}

		const offset = this.#getOffset(address);
		// TODO(floating-bus): an unmapped or out-of-range cart read is undriven;
		// $FF is the XL/XE pull-up.
		if (offset === null) {
			return 0xff;
		}

		return this.#rom[offset] ?? 0xff;
	}

	write(address: number, value: number): void {
		if (address >= 0xd500 && address <= 0xd5ff) {
			this.#type.control?.(address, value, (mapping) => {
				this.#mapping = mapping;
			});

			return;
		}

		// Do nothing (for now)
	}

	reset(cold: boolean) {
		if (cold) {
			this.#mapping = this.#type.initialMapping!;
		}
	}
}
