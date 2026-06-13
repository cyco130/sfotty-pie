# Sfotty Pie A8 Web

The browser front-end for [`@sfotty-pie/a8`](../../packages/a8) — a full Atari 8-bit emulator you can run, hack on, and self-host. Preact + `@preact/signals` for the chrome, Tailwind v4 for styling, Vite for the build.

Requirements: **Node 22 or newer** (CI builds on 24) and **pnpm 11** — the repo pins the version via `packageManager`, so `corepack enable` gives you the right one, or install pnpm yourself.

## Running locally

From the repo root:

```sh
pnpm install
pnpm build # build the workspace packages a8-web depends on
pnpm --filter @sfotty-pie/a8-web dev
```

Both the dev server and `pnpm --filter @sfotty-pie/a8-web preview` (which serves the built `dist/` instead of Vite's dev server) run over **HTTPS** on your **LAN**, not just `localhost`. That's deliberate: `AudioWorklet` — and the content-hashing planned for the library — need a [secure context](https://developer.mozilla.org/docs/Web/Security/Secure_Contexts), which `localhost` provides but a plain LAN IP doesn't. So the server uses a self-signed cert (`@vitejs/plugin-basic-ssl`) plus `server.host`, which also lets you open it on a phone over Wi-Fi. Expect a one-time "untrusted certificate" warning.

If you're editing `@sfotty-pie/a8` (or the other packages) at the same time, run `pnpm dev` at the repo root in another terminal — it watch-builds the packages into `dist/`, which Vite picks up.

`pnpm --filter @sfotty-pie/a8-web test` runs typecheck + lint.

## How it's put together

The headless emulator lives in `@sfotty-pie/a8`; this app is the I/O and chrome around it.

- **[`host.ts`](src/host.ts)** — `EmulatorHost` owns the imperative side: the live `Emulator` (swapped on reboot/Load), the `requestAnimationFrame` present loop, audio, and the keyboard. It exposes reactive state as signals and accepts commands/methods. The Preact components are thin views that **read** host signals and **call** host methods; they never drive the emulator directly.
- **[`commands.ts`](src/commands.ts)** — a registry pairing every action (keys, console buttons, joystick, config, menu) with a label, so keystrokes and a future command palette share one set of verbs.
- **[`library.ts`](src/library.ts)** — the built-in image library (see below).
- **`app.tsx` / `top-bar.tsx` / `bottom-bar.tsx` / `sidebar.tsx` / `osd.tsx` / `alert.tsx`** — the chrome (status bars, config menu, the mobile on-screen joystick + console keys, error toasts).
- **`audio.ts` / `audio-filter.ts`**, **`palette.ts`**, **`keyboard.ts`** — the host-side I/O building blocks.
- `window.a8` (from `dev-console.ts`) is a browser-console monitor: peek/poke, a disassembler, CPU/command traces, and the library listing.

## The image library

ROMs and software are loaded from two folders, globbed into one set at build time:

- **`library/`** — committed; **redistributable files only**. Ships the open-source replacement firmware (Altirra, Atari++).
- **`library.local/`** — gitignored; your per-deploy extras (real Atari ROMs, games). On a filename collision, the local copy wins.

Each has `firmware/` and `other/` subfolders. Firmware is identified (by CRC/banner) and the **best OS + BASIC is auto-selected for the running machine** (800 NTSC/PAL, 800XL, 130XE) via the ranking in `@sfotty-pie/a8`. Items under `other/` show up in the sidebar's **Software** list; the filename is the display name.

So to run your own build with the real Atari ROMs and a games library, drop them into `library.local/firmware/` and `library.local/other/` — no code changes. (Users can also load images at runtime via **Boot image…**.)

## Building and deploying your own

```sh
pnpm build # the packages
pnpm --filter @sfotty-pie/a8-web build
```

Output is `apps/a8-web/dist/` — plain static files. Notes for hosting:

- **Serve over HTTPS.** Audio (and more later) needs a secure context.
- It's a single `index.html` with hashed assets and real files under `/legal/`, so **no SPA-style catch-all redirect** is needed.
- The committed build is **firmware-only** — `library.local/` is gitignored, so a clean CI/host build won't include your ROMs or games. Bake those in by populating `library.local/` in your build environment.

Any static host works (e.g. `rsync` the `dist/` to a web root).

## Licenses

The app's own code is MIT, like the rest of Sfotty Pie.

The firmware committed under `library/firmware/` keeps its own license — it's data the emulator loads, not part of the MIT code:

- **AltirraOS** and **Altirra BASIC** by Avery Lee — FSF all-permissive.
- **Atari++ OS** and **Atari++ BASIC** by Thomas Richter — Thor Public License (≈ MPL 1.1); the corresponding source is bundled.

The full notices and the Atari++ source are served from `/legal/` (see [`public/legal/THIRD-PARTY-LICENSES.md`](public/legal/THIRD-PARTY-LICENSES.md)) and linked from the in-app About panel. Anything you add under `library.local/` is your responsibility: the original Atari OS/BASIC and most game ROMs are copyrighted — supply your own.

Sfotty Pie is an independent project, not affiliated with or endorsed by Atari, the Altirra/Acid800 project, or the Atari++ project.
