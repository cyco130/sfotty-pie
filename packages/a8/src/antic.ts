import type { Memory } from "@sfotty-pie/sfotty";

export interface AnticOptions {
	/** Current master clock in CPU cycles, used to derive VCOUNT. */
	cycle: () => number;
}

/**
 * ANTIC stub. 16 registers mirrored every $10 across $D400-$D4FF. Only VCOUNT is
 * modeled so far; everything else reads back 0.
 *
 * TODO: DMACTL, the display list (DLISTL/H), NMIEN/NMIST, WSYNC, the playfield
 * fetch, and actually generating a frame.
 */
export class Antic implements Memory {
	#cycle: () => number;

	constructor(options: AnticOptions) {
		this.#cycle = options.cycle;
	}

	read(address: number): number {
		// VCOUNT ($D40B): scan line / 2 — increments every 2 lines (228 cycles),
		// 0..130 over a 262-line NTSC frame.
		if ((address & 0x0f) === 0x0b) {
			return Math.floor(this.#cycle() / 228) % 131;
		}
		return 0;
	}

	write(): void {
		// TODO: latch ANTIC registers; honour WSYNC and DMA.
	}
}
