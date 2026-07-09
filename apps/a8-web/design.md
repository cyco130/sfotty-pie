# How Sfotty Pie A8 Web works

Notes on the internals of the web app, for contributors (and AI agents). The [readme](./readme.md) is for people who want to run or deploy their own instance; this file is for people working on the app. Per-function details live in doc comments next to the code.

## What it is

The headless emulator lives in `@sfotty-pie/a8`; this app is the I/O and chrome around it. Stack: Preact + `@preact/signals` for reactive state, `preact-iso` for SPA routing, Tailwind v4 for styling, Vite for the build, MDX for the docs subapp, `fflate` for zip. Everything - emulation included - runs on the main thread; workers are used only for library imports/exports.

The architectural pattern throughout: a single imperative **`EmulatorHost`** ([src/host.ts](src/host.ts)) owns all mutable machine/session state and exposes it as signals; Preact components are thin views that **read** host signals and **call** host methods. They never drive the emulator directly. There is no store framework - module-level signals cover the few cross-cutting pieces (library entries, import progress, recents).

## Structure and routing

[index.html](index.html) has a single `<main id="app">` and loads [src/main.tsx](src/main.tsx), which picks hydrate-vs-render per path: routes that are prerendered (`/` and `/a8/docs*`) and actually arrived with markup are `hydrate`d; everything else ships an empty `#app` and is `render`ed fresh.

[src/root.tsx](src/root.tsx) holds the top-level `<Router>`. Routes are code-split with `preact-iso`'s `lazy()` so the landing bundle stays light and the emulator core only loads with the `/a8/emu` layout chunk. Two structural tricks are load-bearing:

- **Two routes → one component.** `preact-iso`'s `/*` splat needs at least one segment, so `/a8/emu` (exact) and `/a8/emu/*` (splat) both map to the same component - sharing the component instance keeps the Router from remounting the machine when switching panels. Same pattern for `/a8/docs`.
- **Nested `<Router>`s** inside the emu and docs sections render the matched panel into the layout's sidebar/content slot.

`NavigationBridge` captures `preact-iso`'s `route` function into a module-level seam ([src/navigate.ts](src/navigate.ts)) so non-component code (the host, commands) can navigate. Unmatched URLs render the not-found page at HTTP 200 - pure-SPA mode; only `/` and the docs pages exist as real files (see [Build and deploy](#build-and-deploy)).

Routes live under [src/routes/](src/routes/): the home page, the `/a8` hub, `/a8/emu` + its panels, the generated `/a8/reference/atascii-and-keyboard` page (client-rendered, data in [src/keyboard-docs.ts](src/keyboard-docs.ts)), the MDX docs, and `/labs/keyboard` - a raw `keydown`/`keyup`/`input`/`composition` event probe for untangling browser keyboard quirks on borrowed machines (formerly a standalone keyboard-lab.html).

## The host and the emulator

`EmulatorHost` is built via async `EmulatorHost.create()` (the first OS+BASIC bytes must be fetched before a machine can exist). It owns the live `Emulator` ([src/emulator.ts](src/emulator.ts)) - swapped wholesale on reboot/config/media change - plus audio, keyboard, gamepads, and the reactive UI state (`config`, `staged`, `running`, `turboMode`, `keyBindings`, `attachments`, toasts, applied/staged ROMs, …). Panels reach it through `EmuContext` (`useEmu()`), not prop drilling.

Reboots fetch firmware asynchronously while the old machine keeps running, guarded by a reboot token so a slow fetch can't clobber a newer config. Model-specific construction quirks (BASIC as an $A000 cart on 400/800 vs built-in-banked on XL/XE with an OPTION hold to disable it, 1200XL LED wiring off PORTB) live in the host's machine-construction path.

**Frame pipeline.** The emulator renders into a double buffer for tear-free display; `frameCount` ticks on flip. `attachScreen(canvas)` starts a `requestAnimationFrame` present loop: map Atari color bytes through the NTSC/PAL palette into a `Uint32Array` view of `ImageData`, `putImageData` only when `frameCount` changed, letterbox via `ResizeObserver` honoring the TV standard's pixel aspect ratio. FPS is sampled from the emulator's own frame counter over wall-clock, not from RAF observations (which coalesce under load).

## Timing and audio

The run loop (`Emulator.#loop`) is a cooperative async loop over scanlines with three regimes:

- **Audio-master** (normal): the audio queue depth is the clock - run scanline batches until the buffered audio reaches the ~50 ms target, else sleep briefly. This makes the audio device's clock the pacing master, so audio never underruns from drift.
- **Wall-clock** (audio unavailable/suspended): pace per-scanline against `performance.now()`; when falling too far behind, rebase and drop the lost time rather than death-spiraling.
- **Turbo**: unthrottled - run a whole emulated frame, then yield one macrotask. Audio is suppressed (real-time playback can't speed up without unbounded buffering).

Loop details that matter: the yield is a real macrotask via `MessageChannel` (an `await 0` microtask would starve rAF and input); the yield interval is coprime to both region line counts so the yield point doesn't alias to a fixed scanline; the loop pauses on `document.hidden` and rebases on return. Timed input pulses (boot OPTION hold, momentary palette "taps") are **frame-paced** (`afterFrames`), not wall-clock timers - correct under turbo and tab stalls. Gamepads are polled in `afterYield`, right after every event-loop yield, so reads are as fresh as possible before the next scanline batch samples the pins.

**Audio** ([src/audio.ts](src/audio.ts)): an `AudioContext` plus a tiny AudioWorklet whose processor source ships as a string loaded from a Blob URL (no bundler worklet plumbing). The worklet plays queued `Float32Array` chunks and holds the last level on underrun; `buffered()` estimates queue depth from the audio clock. Mute is a `GainNode` at the output - chunks keep flowing so pacing keeps working. The sink is a page-level singleton created once in the emu layout and reused across machine reboots; it's resumed on the first completed user gesture (iOS requirement). The per-cycle path: POKEY level + console speaker → order-16 Chebyshev anti-alias filter ([src/audio-filter.ts](src/audio-filter.ts), 8 cascaded biquads) → decimation to the device rate → one-pole DC blocker → 1024-sample chunks pushed with buffer transfer.

## The image library

Two layers merge into one library: **built-ins** compiled into the app at build time, and **user images** in IndexedDB.

**Build side** ([firmware-library-plugin.ts](firmware-library-plugin.ts)): a Vite plugin emits the virtual module `virtual:firmware-library` (typed by [src/firmware-library.d.ts](src/firmware-library.d.ts)). It deep-scans `library/` (committed, redistributable only) and `library.local/` (gitignored, per-deploy extras), runs each file through the package's `canonicalize` (a combined dump becomes byte-range slice entries sharing one asset URL) and `detectFirmware`, precomputes canonical SHA-256 and kind, and dedups by firmware key with priority standalone > slice, then local > committed. Asset URLs aren't baked in - the generated module resolves them through `import.meta.glob` so Vite still hashes and dev-serves them.

**Runtime side** ([src/images/](src/images/)): `library.ts` is the facade - `libraryEntries` is a `computed` of built-ins (with metadata overrides) ∪ user entries; `readyLibrary()` lazily and idempotently loads from IDB and degrades to built-ins-only if IDB is unavailable (private mode, quota). The IDB schema (`db.ts`) is three stores: `entries` (one row per user image, UUID-keyed, indexed on hash/type/tags/slots/…), `blobs` (content-addressed by canonical SHA-256), `overrides` (edits to built-in metadata).

Design decisions worth knowing:

- **Content addressing + refcounting.** Identity (`id`) is decoupled from content (`hash`). Identical bytes share one blob row; a blob is deleted only when the last entry referencing its hash goes away.
- **Compression at rest** (`compress.ts`): `deflate-raw` via native `CompressionStream`, stored only when smaller (ROMs stay raw; mostly-zero disks shrink a lot). The hash is always over the uncompressed payload, so identity never sees the compressed form.
- **Two-tier metadata** (`metadata.ts`): `derived` is recomputed from bytes; `user` (display name, slots, tags) survives re-derivation.
- **Transients and recents.** Booting a file auto-adds it as a transient entry (so it has an id for resume/save); [src/recents.ts](src/recents.ts) keeps a capped localStorage MRU that drives the menu's Recents; `sweepTransients` collects transients that fell off recents and aren't mounted. (Known gap: blobs orphaned by interrupted writes and stale recents ids have no sweep yet.)
- **Workers.** Bulk folder import ([src/images/import.worker.ts](src/images/import.worker.ts)) and zip export/import ([src/images/zip.worker.ts](src/images/zip.worker.ts)) run off the main thread, reporting through the `importProgress` signal. The zip format is a manifest JSON plus decompressed images under human-friendly names.
- **Cross-tab:** there is no cross-tab coordination; concurrent mutations from two tabs can race the refcount. Single-tab use is assumed for now.

Mounted media is per-tab (sessionStorage) and resolves ids lazily against the library on restore. Disk writes live in RAM for the session; the user can download the live D1: as `.atr` or save it back over its library entry (re-hash, rewrite blob, reclaim the old one) - refused for synthetic XEX boot disks, built-ins, and file-loaded disks with no library source.

[src/library.ts](src/library.ts) (top level, not `images/`) is the legacy build-time-glob library; it survives only as the dev console's `a8.library` listing.

## Firmware selection

[src/firmware-slots.ts](src/firmware-slots.ts) defines the OS slots (`800-ntsc`, `800-pal`, `xlxe`, `1200xl`, `xegs`) and maps a running machine to one. Resolution order per slot: an explicit user override (a library image id) wins; otherwise the package's ranking (`preferredOsKeys`/`preferredBasicKeys`) picks the best-ranked image in the library - an uploaded copy of a known ROM ranks like the built-in because a built-in's id is its firmware key. Rank-resolved picks are **pinned** into persisted prefs so importing a "better" ROM later can't silently change a settled slot; a slot is re-picked only when empty or pointing at a vanished image. The ROM selector panel stages changes like machine config and reboots only when the change touches the running machine.

## Input

### Keyboard

Four cooperating pieces:

- **[src/key-bindings-store.ts](src/key-bindings-store.ts)** - one flat `Binding[]` persisted per-tab, generated from platform defaults on first run (or reset) and user-owned after that: code changes don't reach an existing store until the user resets bindings. A layout snapshot (`code → legend`) is persisted alongside so key labels stay stable across refresh; the layout preference is auto-detect or a manual pick from the built-in layout tables.
- **[src/key-bindings.ts](src/key-bindings.ts)** - the binding model: physical `code` + exact modifier states → command, with scope (window-global vs machine-focused), an `anchor` hint (chords that should follow a _letter_ re-home to whatever physical key produces that letter on the active layout - e.g. Turkish-F), and per-platform overlays (mac vs Windows/Linux, Alt-for-Ctrl aliases for browser-grabbed combos, label formatting). `resolveBinding` picks the most-specific match so resolution is order-independent.
- **[src/char-keys.ts](src/char-keys.ts)** - the character channel: printable characters resolve to Atari keystrokes layout-awarely (letters fold by the Shift modifier so CapsLock can't add a phantom Shift; symbols carry their own Shift).
- **[src/keyboard.ts](src/keyboard.ts)** - the runtime. Listens on an offscreen `<input>` so dead-key composition works (`compositionend` delivers glyphs as momentary taps). Two modes, read live per keystroke: **Character** (char channel first, shadowing bare/Shift positional keys, then bindings) and **Positional** (raw code → matrix). Held-key bookkeeping distinguishes matrix keys (which share one POKEY register and release when the held set empties) from keys that carry their own release. Global bindings resolve at window capture phase; a bubble-phase guard suppresses browser defaults for _bound_ keys only (F5!) and skips editable targets; unbound keys (F12) pass through untouched.

Layout detection uses `navigator.keyboard.getLayoutMap()` where available (Chromium); elsewhere the user picks from `KEYBOARD_LAYOUTS` ([src/keyboard-layouts.ts](src/keyboard-layouts.ts)) or gets the QWERTY baseline. `upperLegends` centralizes the locale traps (Turkish İ/I, German ß, digit row).

### Gamepad

[src/gamepad.ts](src/gamepad.ts) polls (the Gamepad API has no button events): `poll()` runs from the emulator's `afterYield` plus a keepalive from the present loop so meta buttons work while paused; edges are synthesized by diffing snapshots. Analog sticks become digital 8-way via radial deadzone + octant snapping + hysteresis (reachable diagonals, no chatter), and stick/d-pad OR together per role. Port assignment is connection-order with explicit swap, stable across disconnects. Bindings ([src/gamepad-bindings-store.ts](src/gamepad-bindings-store.ts)) are device-independent: joystick inputs → role per port, console/meta inputs → commands on port 0 only. (Per-device normalization/calibration is planned as a separate store - see the Phase 2 notes in the PR history.)

### Commands

[src/commands.ts](src/commands.ts) is the single action registry: every keystroke, console button, joystick direction, config change, and menu action is a `Command` with a label key into [src/messages.ts](src/messages.ts). The **press/release model**: `run` is press-or-instant; a command with `release` is a sustained control - held keys and touches tie release to their own up-event, while a click/palette `dispatch` presses and auto-releases after a 2-frame frame-paced pulse. Matrix keys are flagged (`matrix: true`) because they share POKEY's one key register. The palette ([src/palette.tsx](src/palette.tsx)) and the reusable fuzzy picker ([src/command-picker.tsx](src/command-picker.tsx), VSCode-style scoring) both consume the registry; commands can opt out of the palette.

## UI chrome

[src/app.tsx](src/app.tsx) is the shell: sidebar slot (panels dock beside the screen, never overlay), top bar, import progress, the letterboxed canvas (double-click fullscreen), OSD, bottom bar, toasts, and two hidden inputs (the shared file picker; the offscreen keystroke-capture input). Window-level drag-drop loads files.

- **Top bar** ([src/top-bar.tsx](src/top-bar.tsx)): machine summary, audio/pause/turbo indicators, FPS.
- **Bottom bar** ([src/bottom-bar.tsx](src/bottom-bar.tsx)): cartridge/drive labels, 1200XL LEDs, crash indicator.
- **OSD** ([src/osd.tsx](src/osd.tsx), [src/osd-keyboard.tsx](src/osd-keyboard.tsx)): touch-only; console holds + analog-angle joystick + fire, or the on-screen keyboard; persisted left-hander swap.
- **Panels** are URL-driven routes under `/a8/emu/*` (menu, config, palette, keys + per-command editor + layout picker, controllers, roms, library + item details); the emu layout mirrors the path onto `host.sidebar` and owns Esc-to-close. The library page keeps sort/filter/page state in the URL query so views are shareable and reload-safe.
- **Toasts** ([src/toasts.tsx](src/toasts.tsx)): errors pin top-center with a Copy button until dismissed; info/warnings auto-dismiss bottom-right.
- **Icons** ([src/icon.tsx](src/icon.tsx), [src/icons.svg](src/icons.svg)): one SVG sprite referenced by `<use href="#id">`; the build must keep the sprite a real file (see below).
- **Localization** ([src/messages.ts](src/messages.ts)): all user-facing prose and command labels route through two catalogs so they can become per-language tables. Hardware tokens (model names, NTSC/PAL, key caps) deliberately stay inline - see the header comment there.
- **Machine config** ([src/machine-config.ts](src/machine-config.ts)): the model/RAM/PORTB/TV/BASIC domain logic (sanitize, clamp, equality), consumed by the staged config form and the one-shot `SET_*` palette commands.
- **Dev console** ([src/dev-console.ts](src/dev-console.ts)): installs `window.a8` - peek/poke, disassembler, CPU/command traces, library harness.

## The docs subapp and prerendering

`/a8/docs/*` is prose-only, so it's prerendered to static HTML at build time while everything else stays client-rendered. MDX under [src/routes/a8/docs/](src/routes/a8/docs/) compiles to Preact components (`@mdx-js/rollup`, `enforce: "pre"` so it runs before preset-vite's babel); the docs layout applies Tailwind Typography. Head tags are declared once per page via [src/head.ts](src/head.ts): at runtime `useHead` reconciles the live `document`, during prerender it hands the data up through a collector context. [src/prerender.tsx](src/prerender.tsx) is a build-only entry (referenced via `prerenderScript`, never shipped) that renders `/` and `/a8/docs*` to markup, an empty shell for everything else, and refuses to follow discovered links outside the docs (the emulator needs browser APIs).

## Build and deploy

[vite.config.ts](vite.config.ts) - plugin order matters: MDX (pre) → `@preact/preset-vite` with prerender → `flattenPrerenderedHtml` → Tailwind → `basicSsl` → the firmware-library plugin.

- **`flattenPrerenderedHtml`** renames each prerendered `<route>/index.html` to a flat `<route>.html` (root `index.html` stays put as the SPA fallback) - Cloudflare Pages derives canonical-URL/trailing-slash behavior from the file layout, and the flat file makes `/a8/docs` (no slash) canonical.
- Hashed assets go under **`/_app/assets`** for immutable long-caching; [public/\_headers](public/_headers) sets `immutable` there and `no-cache` on the HTML routes. The header sections are **enumerated per top-level route** (not `/*`) because Cloudflare combines matching rules - add a section when adding a top-level route.
- `assetsInlineLimit` returns `false` for `.svg`: the icon sprite must stay a real hashed file, because `#fragment` references don't resolve into data: URIs.
- Dev and preview run over **HTTPS on the LAN** (`basicSsl` + `server.host`): AudioWorklet and `crypto.subtle` (library hashing) need a secure context, and LAN HTTPS enables phone testing.
- `optimizeDeps.exclude`s the two workspace packages so their watch-rebuilds are picked up without a dev-server restart. `GIT_HASH` (short SHA, `-dirty` suffix) is defined at build and shown in About. `.rom/.xex/.atr/.car` are treated as binary assets.

Deployment is Cloudflare Pages, wired in `.github/workflows/`: `ci.yml` auto-deploys production on `main` after the quality+conformance jobs pass; `preview.yml` deploys per-PR previews to a stable per-branch alias with a sticky PR comment and cleans up on close; `deploy.yml` is the manual escape hatch; `cleanup.yml` prunes old production deployments weekly (the custom scripts live in [scripts/](scripts/)). The app's `deploy` script runs the build and `wrangler pages deploy dist` with the project name hardcoded. See the readme for the self-hosting story (including the SPA-fallback requirement on non-Cloudflare hosts).
