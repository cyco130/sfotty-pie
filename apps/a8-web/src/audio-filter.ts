/**
 * Anti-aliasing low-pass for the 1.79MHz POKEY output stream, applied before
 * decimating to the audio device rate.
 *
 * Designed with http://jaggedplanet.com/iir/iir-explorer.asp:
 *   Type: Chebyshev, Form: Low-pass, Order: 16,
 *   Samplerate: 88200 (the tool's maximum), Cutoff: 900, Ripple: 2.999.
 * Running it at the real 1.79MHz input rate scales the cutoff to ~18kHz.
 *
 * Implemented as eight cascaded biquads in transposed direct form II — the
 * same transfer function as the designer's reference code, without its
 * per-sample history shifting.
 */

// Per biquad: [a2, a1]. The numerators are all (1 + 2z⁻¹ + z⁻²).
const COEFFICIENTS = Float64Array.from([
	0.9996145196668148, -1.9983545273099301, 0.9988587772441132,
	-1.9976938869130205, 0.9981473333675241, -1.9971576529189947,
	0.9975073861842917, -1.996746353623606, 0.9969633805505398,
	-1.996449660968628, 0.9965360891153308, -1.9962507536956569,
	0.9962418271704168, -1.9961312392281252, 0.9960918318419058,
	-1.9960758013748503,
]);

const GAIN = 3.208855047816406e32;
const STAGES = COEFFICIENTS.length / 2;

export class AntiAliasFilter {
	#s1 = new Float64Array(STAGES);
	#s2 = new Float64Array(STAGES);

	apply(value: number): number {
		const s1 = this.#s1;
		const s2 = this.#s2;

		let x = value / GAIN;
		for (let k = 0; k < STAGES; k++) {
			const a2 = COEFFICIENTS[2 * k]!;
			const a1 = COEFFICIENTS[2 * k + 1]!;
			const y = x + s1[k]!;
			s1[k] = 2 * x - a1 * y + s2[k]!;
			s2[k] = x - a2 * y;
			x = y;
		}
		return x;
	}

	reset(): void {
		this.#s1.fill(0);
		this.#s2.fill(0);
	}
}
