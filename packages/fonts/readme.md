# Sfotty Pie Fonts

**Sfotty Pie Fonts** packages retro computer character sets as modern Unicode fonts, generated pixel-exactly from the original bitmaps. Currently it covers the Atari 8-bit OS character sets: the family **A8 Screen** contains the full domestic set (letters, digits, punctuation, the control graphics: box drawing, block elements, card suits, arrows) plus the 29 accented letters of the international character set, every glyph at its proper Unicode code point.

## Usage

The published package contains only the font files: `fonts/A8Screen-Regular.woff2` for the web and `fonts/A8Screen-Regular.ttf` for installing on a computer.

```sh
npm install @sfotty-pie/fonts
```

```css
@font-face {
  font-family: "A8 Screen";
  src: url("@sfotty-pie/fonts/fonts/A8Screen-Regular.woff2") format("woff2");
}

.atari {
  font-family: "A8 Screen", monospace;
  font-size: 16px;
  line-height: 1;
}
```

The font is monospaced, one em per character cell. At any multiple of 8px every pixel lands exactly on device pixels, and with `line-height: 1` lines tile with no gaps, exactly like the real screen. Other sizes work too, they just aren't razor-sharp.

Some notes on the character mapping:

- Text typed on a modern keyboard mostly just works: ASCII letters, digits, and punctuation map to themselves.
- The few ASCII characters that don't exist in ATASCII (`` ` ``, `{`, `}`, `~`) are absent from the font and will render as the .notdef box.
- The control graphics live at their standard Unicode homes, e.g. `♥` U+2665, `├` U+251C, `▖` U+2596, `←` U+2190, and the international set at the usual Latin-1 code points (`á`, `ñ`, `£`, ...).
- Inverse-video characters are not included; render inverse video with styling (swap foreground and background), like the hardware does.

## Provenance

The glyphs are built programmatically from the character set data of the Atari OS ROM. The standard set was byte-identical across all Atari OS revisions from the 400/800 to the XE line; the international set shipped with the XL/XE OS. The ATASCII to Unicode mapping is the same one the [Sfotty Pie A8 Web](https://github.com/cyco130/sfotty-pie/tree/main/apps/a8-web) emulator uses for its keyboard reference and clipboard translation.

> Contributors: see [design.md](./design.md) for how the build pipeline works.

## License and credits

MIT license.

- [Fatih Aygün](https://github.com/cyco130) and [contributors](https://github.com/cyco130/sfotty-pie/graphs/contributors).
- Glyph bitmaps from the Atari 8-bit OS character set, used as typeface data. Sfotty Pie is not affiliated with or endorsed by Atari.
