import type { Memory } from "@sfotty-pie/sfotty";

/**
 * GTIA stub. 32 registers mirrored every $20 across $D000-$D0FF. Only CONSOL is
 * modeled so far; everything else reads back 0.
 *
 * TODO: PRIOR, colour registers, player/missile graphics, collisions, triggers.
 */
export class Gtia implements Memory {
	read(address: number): number {
		// CONSOL ($D01F): bits 0-2 = START/SELECT/OPTION, 0 = pressed. Report all
		// released so the OS doesn't try to boot the cassette.
		if ((address & 0x1f) === 0x1f) return 0x07;
		return 0;
	}

	write(): void {
		// TODO: latch GTIA registers.
	}
}
