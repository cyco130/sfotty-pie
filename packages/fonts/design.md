# Sfotty Pie Fonts internals

The package is a dev-only build pipeline with zero runtime and zero dependencies; the published artifact is just the font files. `pnpm build` runs [src/build.ts](src/build.ts) which writes `fonts/A8Screen-Regular.ttf` and `.woff2`.

## Pipeline

1. **Glyph data** ([src/data/](src/data/), 2x1KB, committed): the character sets extracted from the XL/XE OS ROM by [src/extract-charsets.ts](src/extract-charsets.ts). The standard set lives at `$E000` (byte-identical in every OS revision), the international set at `$CC00`. 128 characters x 8 bytes, one byte per row, bit 7 = leftmost pixel, in internal (screen code) order.
2. **Mapping** ([src/mapping.ts](src/mapping.ts), generated once from the a8-web keyboard reference): ATASCII code to Unicode code point, 128 standard entries plus the 29 international replacements (ATASCII `$00-$1A`, `$60`, `$7B`). The two sets map to disjoint code points, all in the BMP, so one font carries both and the cmap needs only format 4.
3. **Tracing** ([src/trace.ts](src/trace.ts)): each 8x8 bitmap becomes rectilinear contours by walking the boundary between filled and empty pixels, so adjacent pixels merge into clean polygons instead of per-pixel squares (which can leave antialiasing seams on coincident edges). Filled area stays on the right of the walk; holes come out with opposite orientation, which is what the TrueType non-zero winding rule needs. Corner-touching diagonal pixels take the sharper right turn and stay separate contours.
4. **TTF** ([src/sfnt.ts](src/sfnt.ts)): a purpose-built sfnt writer, not a general one: every glyph advances one em, all points are on-curve, no composites, no hinting. Metrics: 2048 units/em, 1 pixel = 256 units, ascent 7px / descent 1px (capitals sit on the baseline at the bottom of row 6, descenders use row 7), so ascent + descent = exactly one em and lines tile like the real screen. Tables: OS/2, cmap, gasp, glyf, head, hhea, hmtx, loca, maxp, name, post.
5. **WOFF2** ([src/woff2.ts](src/woff2.ts)): repackages the TTF using the null transform for every table (transformation version 3 for glyf/loca, 0 for the rest), so the payload is just the Brotli-compressed concatenation of the raw tables via `node:zlib`. Decoders must support the null transform per the W3C spec; skipping the glyf transform costs a little compression and saves a lot of code.

## Testing

[src/font.test.ts](src/font.test.ts) re-parses the built TTF with an independent minimal OpenType parser (written against the spec, sharing no code with the builder), rasterizes every glyph with the non-zero winding rule at pixel centers, and requires an exact match with the source ROM bitmap. The WOFF2 test decodes the container (header, flags, UIntBase128 lengths, Brotli payload) and requires each table to reconstruct the TTF's bytes. [src/trace.test.ts](src/trace.test.ts) covers the tracer's edge cases (holes, diagonal touches, edge merging).

## Regenerating the data

`node src/extract-charsets.ts <path-to-16KB-XL/XE-OS-ROM>` rewrites the committed `.bin` files, and `node <one-off script>` regenerated `mapping.ts` from `apps/a8-web/src/keyboard-docs.ts`; neither should ever need running again unless the mapping choices change.
