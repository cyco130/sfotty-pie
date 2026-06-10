export const CYCLES_PER_LINE = 114; // 94 visible cycles (17..111) + 20 horizontal blank

export const NTSC_MASTER_CLOCK_RATE = 14_318_180;
export const NTSC_CYCLES_PER_SECOND = NTSC_MASTER_CLOCK_RATE / 8; // 1_789_772.5, slightly off from the exact (5 * 7 * 9) / (16 * 11) MHz ~= 1_789_772.73
export const NTSC_LINES_PER_FRAME = 262; // 240 visible lines (8..247) + 22 vertical blank
export const NTSC_CYCLES_PER_FRAME = CYCLES_PER_LINE * NTSC_LINES_PER_FRAME; // 114 * 262 = 29868
export const NTSC_SQUARE_PIXEL_RATE = ((12 + 3 / 11) / 2) * 1_000_000; // ~6_136_363.64
export const NTSC_PIXEL_ASPECT_RATIO =
	NTSC_SQUARE_PIXEL_RATE / (NTSC_MASTER_CLOCK_RATE / 2); // ~0.8571, exactly 6/7 with exact clocks
export const NTSC_FRAMES_PER_SECOND =
	NTSC_CYCLES_PER_SECOND / NTSC_CYCLES_PER_FRAME;

export const PAL_MASTER_CLOCK_RATE = 14_187_570;
export const PAL_CYCLES_PER_SECOND = PAL_MASTER_CLOCK_RATE / 8; // 1_773_446.25, slightly off from 1_773_447.5 = 4.43361875 * 400_000
export const PAL_LINES_PER_FRAME = 312; // 288 + 24 vertical blank but only 240 is rendered by Atari [-25..287]
export const PAL_CYCLES_PER_FRAME = CYCLES_PER_LINE * PAL_LINES_PER_FRAME; // 114 * 312 = 35568
export const PAL_SQUARE_PIXEL_RATE = 14_750_000 / 2; // 7_375_000
export const PAL_PIXEL_ASPECT_RATIO =
	PAL_SQUARE_PIXEL_RATE / (PAL_MASTER_CLOCK_RATE / 2); // ~1.0396
export const PAL_FRAMES_PER_SECOND =
	PAL_CYCLES_PER_SECOND / PAL_CYCLES_PER_FRAME;

/*
A write on cycle 65 of a scan line shows up on 128.

In a normal width mode E line, this would be immediately before ANTIC reads data for positions $8C-$8F (140-143) (24th fetch)

GTIA is 8 cc behind ANTIC: 140 - 132 = 8
*/

/*

Master clock rates are based on the Atari's crystal oscillator frequencies..

Pixel aspect ratios are the TV standard's square-pixel clock divided by Atari's pixel clock (master clock / 2).
The full 376-pixel width spans ~322 (NTSC) / ~391 (PAL) square pixels — slightly wider than the 4:3 picture (320 / 384).

Vertical: 192..240 lines (0..48 lines, increments in 2)
    Large overscan: 240 lines
    Altirra's normal overscan: 224 lines (-16)
    More overscan: 216 lines (-24)
    Some overscan: 208 lines (-32)
    No overscan: 192 lines (-48)

- For NTSC, 204..216 (12..24) were typical in TV sets from the 80s.
- For PAL, 248..264 (-8..-24) were typical in TV sets from the 80s.

Horizontal: 320..376 pixels (0..56 pixels, increments in 2)
    Large overscan: 376 pixels
    Altirra's normal overscan: 336 pixels (-40)
    No overscan: 320 pixels (-56)

 */
