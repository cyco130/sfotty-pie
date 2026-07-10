import type { Memory } from "@sfotty-pie/sfotty";

/**
 * A `Memory` implementation that can additionally expose stable per-page
 * bytes for the MMU's fast page tables. Anything on the Atari bus that is
 * ROM/RAM-like behind its registers - cartridges, PBI/ECI device ROM - can
 * implement `pageView` so its pages become plain byte loads; pure register
 * devices simply don't.
 */
export interface AtariMemory extends Memory {
	/**
	 * The bytes decoded at `page` (addresses `page << 8` to
	 * `(page << 8) | 0xff`):
	 *
	 * - a 256-byte view: reads are plain loads off it until the device
	 *   signals a mapping change;
	 * - `null`: the page is unconnected and reads $FF;
	 * - `undefined`: no fast path - the page is read-sensitive or otherwise
	 *   dynamic, so every access must go through `read`/`write`.
	 *
	 * An absent `pageView` composes with the `undefined` case: callers use
	 * `target.pageView?.(page)` and treat `undefined` uniformly.
	 */
	pageView?(page: number): Uint8Array | null | undefined;
}
