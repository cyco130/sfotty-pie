import { Signal } from "./signal.ts";

/**
 * The KR2 output lines the stock keyboard's meta keys connect to: Control on
 * line 0, Shift on line 2, Break on line 6 (AHRM 5.8). The other lines are
 * unused by the stock keyboard but exist in the matrix.
 */
export const KEYBOARD_LINES = { CONTROL: 0, SHIFT: 2, BREAK: 6 } as const;

/**
 * The keyboard matrix as POKEY sees it (AHRM 5.8). A scan code's high three
 * bits select an OUTPUT line, its low three bits a SENSE line; a key connects
 * its output line to its sense line, and the scan reads the addressed sense
 * line back on KR1. Control/Shift/Break sit on a ninth sense line, KR2, which
 * has no low-bit mux: each connects KR2 straight to an output line (see
 * {@link KEYBOARD_LINES} - we model all eight lines, for a hypothetical
 * device wired to the rest; the 5200 keypads fall out of the same
 * generality). There are no diodes, so current flows both ways through
 * pressed keys: a scan reads "down" whenever the addressed output and sense
 * lines are connected through ANY chain of pressed keys. That's how three
 * keys on a rectangle phantom the fourth corner (AHRM figure 12), and how
 * KR2 keys join in - Control+V+L simulates Shift, Control+L+9 simulates
 * Break.
 */
export class Keyboard {
	// Host facade

	/**
	 * Whether the keyboard is plugged in. When detached, the matrix sends no
	 * response: every scan reads open lines, so POKEY sees all keys up. On
	 * the XEGS the machine wires this to GTIA TRIG2 (the keyboard-presence
	 * sense) - the other models' keyboards are captive, but detaching still
	 * silences them. Key state survives detachment; it is the cable that is
	 * gone, not the fingers.
	 */
	readonly attached = new Signal(true);

	/** Press a matrix key. `code` is the 6-bit scan code - the raw matrix
	 *  position, no Shift/Ctrl bits (those are meta lines, see
	 *  {@link pressMetaKey}). */
	pressKey(code: number): void {
		code &= 0x3f;
		if (this.#keys[code]) return;
		this.#keys[code] = true;
		this.#rescan();
	}

	/** Release a matrix key. */
	releaseKey(code: number): void {
		code &= 0x3f;
		if (!this.#keys[code]) return;
		this.#keys[code] = false;
		this.#rescan();
	}

	/** Press a meta key - a KR2 output line, see {@link KEYBOARD_LINES}. */
	pressMetaKey(line: number): void {
		line &= 0x07;
		if (this.#metaKeys[line]) return;
		this.#metaKeys[line] = true;
		this.#metaCount++;
		this.#rescan();
	}

	/** Release a meta key. */
	releaseMetaKey(line: number): void {
		line &= 0x07;
		if (!this.#metaKeys[line]) return;
		this.#metaKeys[line] = false;
		this.#metaCount--;
		this.#rescan();
	}

	/**
	 * Release every key and meta key at once - the host's focus-loss
	 * backstop: when the app loses focus mid-press, the matching key-up may
	 * never arrive, and a matrix key would stay wedged down forever.
	 */
	releaseAll(): void {
		if (!this.#keys.includes(true) && !this.#metaKeys.includes(true)) return;
		this.#keys.fill(false);
		this.#metaKeys.fill(false);
		this.#metaCount = 0;
		this.#rescan();
	}

	// System facade

	/** The KR1 sense as of the last {@link scan}: the addressed key's line. */
	KR1 = false;
	/** The KR2 sense as of the last {@link scan}: the addressed output
	 *  line's meta level. */
	KR2 = false;

	/** Address the matrix like POKEY's scan counter does: latch the sense
	 *  levels for `code` into {@link KR1}/{@link KR2}. */
	scan(code: number) {
		if (!this.attached.value) {
			this.KR1 = false;
			this.KR2 = false;
			return;
		}
		code &= 0x3f;
		const line = code >> 3;
		// With two or more meta keys held, their output lines are shorted
		// together through the KR2 line, and the drive contention keeps
		// keys on those lines from asserting the sense. Control+Shift is
		// the stock-keyboard case: codes $00-$07 and $10-$17 can't be
		// scanned while both are down (see the guard in POKEY's old
		// keyDown; AHRM 5.8's key-code notes).
		const dead = this.#metaCount >= 2 && this.#metaKeys[line]!;
		this.KR1 = !dead && this.#kr1[code]!;
		// KR2 has no low-bit mux: it reads per output line, the same for all
		// eight codes on that line (Control asserts it for all of $00-$07,
		// Shift for $10-$17, Break for $30-$37).
		this.KR2 = this.#kr2[line]!;
	}

	#keys = new Array<boolean>(0x40).fill(false);
	#metaKeys = new Array<boolean>(8).fill(false);
	#metaCount = 0;

	// Sense-line levels per scan address, rebuilt on any key change:
	// #kr1[code] for the 8x8 matrix, #kr2[output line] for the KR2 line
	// (it reads the same for all eight codes on an output line).
	#kr1 = new Array<boolean>(0x40).fill(false);
	#kr2 = new Array<boolean>(0x08).fill(false);

	// Union-find over the conductor nodes: output lines 0-7, sense lines
	// 8-15, KR2 16. Pressed keys are the edges.
	#nodes = new Uint8Array(17);

	#find(node: number): number {
		while (this.#nodes[node] !== node) {
			node = this.#nodes[node]!;
		}
		return node;
	}

	#union(a: number, b: number): void {
		this.#nodes[this.#find(a)] = this.#find(b);
	}

	// Rebuild #kr1 and #kr2: connect every pressed key's lines, then read
	// each scan address as "are its two lines in the same component".
	#rescan() {
		for (let node = 0; node < 17; node++) {
			this.#nodes[node] = node;
		}

		for (let key = 0; key < 0x40; key++) {
			if (this.#keys[key]) {
				this.#union(key >> 3, 8 + (key & 0x07));
			}
		}
		for (let line = 0; line < 8; line++) {
			if (this.#metaKeys[line]) {
				this.#union(line, 16);
			}
		}

		for (let key = 0; key < 0x40; key++) {
			this.#kr1[key] = this.#find(key >> 3) === this.#find(8 + (key & 0x07));
		}
		for (let line = 0; line < 8; line++) {
			this.#kr2[line] = this.#find(line) === this.#find(16);
		}
	}
}
