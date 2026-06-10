import { ReadOptions, type Memory } from "@sfotty-pie/sfotty";
import { AnticGtia } from "./antic-gtia.ts";
import { AtariBus } from "./bus-manager.ts";
import { Cartridge } from "./cartridge.ts";
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
	/** Debug log sink (used by ANTIC's display list disassembler). */
	log?: (message: string) => void;
}

/**
 * An Atari 8-bit machine (NTSC) built on the {@link AtariBus}, the combined
 * {@link AnticGtia} video chip pair, and stubs for the rest (POKEY/PIA/PBI).
 *
 * - `"800"` — OS-B, 48K, no PORTB banking; BASIC is a standard $A000 8K cart.
 * - `"800XL"` — XL OS, 64K, PORTB banking; BASIC is built in and banked via
 *   PORTB (the OS enables it unless OPTION is held).
 *
 * The host drives the machine one cycle at a time:
 *
 * ```ts
 * machine.anticGtia.beforeCpu();
 * cpu.NMI = machine.anticGtia.nmi;
 * cpu.RDY = machine.anticGtia.rdy;
 * if (!machine.anticGtia.halt) cpu.run();
 * machine.anticGtia.afterCpu(frame, machine.busData);
 * ```
 */
export class Atari implements Memory {
	readonly anticGtia: AnticGtia;

	readonly #bus: AtariBus;
	readonly #pia: Pia;

	constructor(config: MachineConfig) {
		const { model, os, basic, log } = config;
		const xl = model === "800XL";

		// The dmaRead closure reads #bus lazily, resolving the chip/bus
		// construction cycle.
		this.anticGtia = new AnticGtia(
			{
				dmaRead: (address) => this.#bus.read(address, ReadOptions.DMA),
				log: log ?? (() => {}),
			},
			{ anticTvSystem: "ntsc", gtiaTvSystem: "ntsc" },
		);

		this.#pia = new Pia();

		this.#bus = new AtariBus({
			portbBanking: xl,
			conventionalRamSize: xl ? 64 : 48,
			xeBankCount: 0,
			separateAnticAccess: false,
			osRom: os,
			// 800XL: built-in BASIC, banked in via PORTB. 800: BASIC as a cart.
			basicRom: xl ? basic : undefined,
			cartridge: xl ? undefined : new Cartridge(basic),
			gtia: this.anticGtia,
			pokey: new Pokey(),
			pia: this.#pia,
			antic: this.anticGtia,
			pbi: new Pbi(),
		});
	}

	/** The last value driven on the data bus (see {@link AtariBus.busData}). */
	get busData(): number {
		return this.#bus.busData;
	}

	read(address: number, options: ReadOptions): number {
		return this.#bus.read(address, options);
	}

	write(address: number, value: number): void {
		this.#bus.write(address, value);
	}

	reset(cold: boolean): void {
		this.#bus.reset(cold);
		this.anticGtia.reset(cold);
		this.#pia.reset(cold);
	}
}
