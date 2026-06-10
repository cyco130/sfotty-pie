import type { Memory } from "@sfotty-pie/sfotty";

export interface PokeyOptions {
	/** Source of the RANDOM register's byte. Defaults to `Math.random`. */
	random?: () => number;
}

/**
 * POKEY stub. 16 registers mirrored every $10 across $D200-$D2FF. Only RANDOM is
 * modeled so far; everything else reads back 0.
 *
 * TODO: audio (AUDF/AUDC/AUDCTL), keyboard (KBCODE/SKSTAT/SKCTL), serial I/O,
 * timers, and the IRQ registers (IRQEN/IRQST).
 */
export class Pokey implements Memory {
	#random: () => number;

	constructor(options: PokeyOptions = {}) {
		this.#random = options.random ?? (() => (Math.random() * 256) | 0);
	}

	read(address: number): number {
		// RANDOM ($D20A): free-running polynomial counter.
		if ((address & 0x0f) === 0x0a) return this.#random() & 0xff;
		return 0;
	}

	write(): void {
		// TODO: latch POKEY registers / drive audio.
	}
}
