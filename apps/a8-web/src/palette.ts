/**
 * Generate an NTSC GTIA palette: 16 hues x 16 luminances, as little-endian
 * RGBA words for writing through a Uint32 view of ImageData.
 *
 * YIQ model with atari800's default NTSC parameters: chroma phase starts at
 * the 303-degree color burst and advances 26.8 degrees per hue; hue 0 is
 * grey. Luminance is linear for now. TODO: luma table + gamma, tunable
 * saturation/phase, PAL palette.
 */
export function buildNtscPalette(): Uint32Array {
	const palette = new Uint32Array(256);
	const saturation = 0.175;

	for (let index = 0; index < 256; index++) {
		const hue = index >> 4;
		const luma = index & 0x0f;

		const y = luma / 15;
		let i = 0;
		let q = 0;
		if (hue > 0) {
			const angle = ((303 + (hue - 1) * 26.8) * Math.PI) / 180;
			i = saturation * Math.cos(angle);
			q = saturation * Math.sin(angle);
		}

		const r = channel(y + 0.9563 * i + 0.621 * q);
		const g = channel(y - 0.2721 * i - 0.6474 * q);
		const b = channel(y - 1.107 * i + 1.7046 * q);

		palette[index] = 0xff000000 | (b << 16) | (g << 8) | r;
	}

	return palette;
}

function channel(value: number): number {
	return Math.max(0, Math.min(255, Math.round(value * 255)));
}
