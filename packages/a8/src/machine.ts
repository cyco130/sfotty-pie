import { type Memory, type ReadOptions } from "@sfotty-pie/sfotty";
import { Antic } from "./antic.ts";
import { AtariBus } from "./bus-manager.ts";
import { Cartridge } from "./cartridge.ts";
import { Gtia } from "./gtia.ts";
import { Pbi } from "./pbi.ts";
import { Pia } from "./pia.ts";
import { Pokey } from "./pokey.ts";

export type AtariModel = "800" | "800XL";

export interface MachineConfig {
	/** Which machine to emulate. */
	model: AtariModel;
	/** OS ROM: OS-B (10K) for the 800, XL OS (16K) for the 800XL. */
	os: Uint8Array;
	/** BASIC ROM (8K): an $A000 cartridge on the 800, built-in on the 800XL. */
	basic: Uint8Array;
}

/**
 * An Atari 8-bit machine (NTSC) built on the real {@link AtariBus} plus chip
 * stubs (GTIA/POKEY/PIA/ANTIC/PBI).
 *
 * - `"800"` — OS-B, 48K, no PORTB banking; BASIC is a standard $A000 8K cart.
 * - `"800XL"` — XL OS, 64K, PORTB banking; BASIC is built in and banked via
 *   PORTB (the OS enables it unless OPTION is held).
 */
export class Atari implements Memory {
	/** Master clock in CPU cycles; drives time-based registers like VCOUNT. */
	cycle = 0;

	readonly #bus: AtariBus;

	constructor(config: MachineConfig) {
		const { model, os, basic } = config;
		const xl = model === "800XL";

		this.#bus = new AtariBus({
			portbBanking: xl,
			conventionalRamSize: xl ? 64 : 48,
			xeBankCount: 0,
			separateAnticAccess: false,
			osRom: os,
			// 800XL: built-in BASIC, banked in via PORTB. 800: BASIC as a cart.
			basicRom: xl ? basic : undefined,
			cartridge: xl ? undefined : new Cartridge(basic),
			gtia: new Gtia(),
			pokey: new Pokey(),
			pia: new Pia(),
			antic: new Antic({ cycle: () => this.cycle }),
			pbi: new Pbi(),
		});
	}

	read(address: number, options: ReadOptions): number {
		return this.#bus.read(address, options);
	}

	write(address: number, value: number): void {
		this.#bus.write(address, value);
	}

	reset(cold: boolean): void {
		this.#bus.reset(cold);
	}
}
