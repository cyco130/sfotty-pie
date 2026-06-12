/**
 * A serializable delay line for chip pipeline timing — "this takes effect N
 * cycles from now" — as a power-of-two ring of integer slots.
 *
 * Two write modes with different collision semantics:
 *
 * - {@link schedule} ORs bits in: for *events* (op masks). Idempotent —
 *   re-scheduling the same op onto the same cycle is one event — and
 *   cancellable with {@link cancel}.
 * - {@link scheduleValue} overwrites: for *payloads* (register bytes in
 *   flight). The later bus write wins a slot collision, matching hardware.
 *
 * Ops carry no payload of their own — they're signals; handlers read chip
 * state at execution time. Value-dependent latency (e.g. an enable taking
 * effect a cycle before a disable) is resolved at schedule time by picking
 * the slot, keeping the line itself dumb. Same-cycle races against CPU
 * writes (a write canceling an event scheduled earlier in the same cycle)
 * are the chip's business: keep a this-cycle flag and `cancel` under it.
 *
 * The whole state is the ring plus a cursor, so a future save state copies
 * it verbatim. Within a cycle, tick first, then schedule: a `delay` of N
 * means "due on the Nth tick after this one". `delay` must be between 1 and
 * the ring size.
 */
export class DelayLine {
	#slots: Uint32Array;
	#mask: number;
	#cursor = 0;

	/** `size` must be a power of two (the cursor wraps by masking). */
	constructor(size: number = 16) {
		if (size <= 0 || (size & (size - 1)) !== 0) {
			throw new Error("DelayLine size must be a power of two");
		}
		this.#slots = new Uint32Array(size);
		this.#mask = size - 1;
	}

	/** OR `bits` into the slot `delay` cycles ahead. */
	schedule(delay: number, bits: number): void {
		// The cursor already points one past this cycle's tick.
		const slot = (this.#cursor + delay - 1) & this.#mask;
		this.#slots[slot] = this.#slots[slot]! | bits;
	}

	/** Overwrite the slot `delay` cycles ahead with `value`. */
	scheduleValue(delay: number, value: number): void {
		this.#slots[(this.#cursor + delay - 1) & this.#mask] = value;
	}

	/** Remove `bits` from every pending slot. */
	cancel(bits: number): void {
		const slots = this.#slots;
		for (let i = 0; i < slots.length; i++) {
			slots[i] = slots[i]! & ~bits;
		}
	}

	/** Advance one cycle: return what's due now and clear its slot. */
	tick(): number {
		const cursor = this.#cursor;
		const bits = this.#slots[cursor]!;
		this.#slots[cursor] = 0;
		this.#cursor = (cursor + 1) & this.#mask;
		return bits;
	}

	reset(): void {
		this.#slots.fill(0);
		this.#cursor = 0;
	}
}
