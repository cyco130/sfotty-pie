# Sfotty Pie A8 Web

The browser front-end for [`@sfotty-pie/a8`](../../packages/a8) - a full Atari 8-bit emulator you can run, hack on, and self-host. Preact + `@preact/signals` for the chrome, Tailwind v4 for styling, Vite for the build.

This readme is about running and deploying your own instance. For how the app works inside - the host/signals architecture, the run loop, the image library, input, the docs subapp - see [design.md](./design.md).

Requirements: **Node 22 or newer** (CI builds on 24) and **pnpm 11** - the repo pins the version via `packageManager`, so `corepack enable` gives you the right one, or install pnpm yourself.

## Running locally

From the repo root:

```sh
pnpm install
pnpm build # build the workspace packages a8-web depends on
pnpm --filter @sfotty-pie/a8-web dev
```

Both the dev server and `pnpm --filter @sfotty-pie/a8-web preview` (which serves the built `dist/` instead of Vite's dev server) run over **HTTPS** on your **LAN**, not just `localhost`. That's deliberate: `AudioWorklet` and the library's content hashing (`crypto.subtle`) need a [secure context](https://developer.mozilla.org/docs/Web/Security/Secure_Contexts), which `localhost` provides but a plain LAN IP doesn't. So the server uses a self-signed cert (`@vitejs/plugin-basic-ssl`) plus `server.host`, which also lets you open it on a phone over Wi-Fi. Expect a one-time "untrusted certificate" warning.

If you're editing `@sfotty-pie/a8` (or the other packages) at the same time, run `pnpm dev` at the repo root in another terminal - it watch-builds the packages into `dist/`, which Vite picks up.

`pnpm --filter @sfotty-pie/a8-web test` runs typecheck + lint.

## Bundling firmware and software

The app has two software sources. Users can always load and upload images **at runtime** - those live in each visitor's browser (IndexedDB), not in your deployment. What you can control as a deployer is the **built-in** set, compiled in at build time from two folders:

- **`library/`** - committed; **redistributable files only**. Ships the open-source replacement firmware (Altirra, Atari++).
- **`library.local/`** - gitignored; your per-deploy extras (real Atari ROMs, games). On a collision (same firmware, same content), the local copy wins.

Subfolder layout inside them is free-form (the build deep-scans both). Firmware is identified by content and the best OS + BASIC is auto-selected for the running machine via the ranking in `@sfotty-pie/a8`; other files show up as built-in software in the library.

So to run your own build with the real Atari ROMs and a games library baked in, drop them into `library.local/` - no code changes. A clean CI/host build won't include them (the folder is gitignored), so populate `library.local/` in whatever environment runs your build.

## Building and deploying

Build the static output:

```sh
pnpm build # the workspace packages a8-web depends on
pnpm --filter @sfotty-pie/a8-web build
```

Output is `apps/a8-web/dist/` - plain static files. Hosting requirements:

- **Serve over HTTPS.** Audio and the image library need a secure context.
- **Configure an SPA fallback.** Only `/` and the docs pages (`/a8/docs*`) are prerendered to real files; every other route (`/a8/emu` and its panels, `/a8/reference/*`, `/labs/*`) is client-rendered from `index.html`. Deep links and reloads on those routes 404 unless unmatched URLs rewrite to `/index.html` (nginx: `try_files $uri $uri.html /index.html;`). Cloudflare Pages does this automatically; a plain web root does not.
- Hashed assets live under `/_app/assets/` and are safe to cache forever; the HTML files should not be cached (the committed [public/\_headers](public/_headers) encodes exactly this for Cloudflare Pages).

### Cloudflare Pages (the official target)

The public instance deploys to Cloudflare Pages. From the CLI:

```sh
pnpm --filter @sfotty-pie/a8-web deploy
```

That runs the app build and `wrangler pages deploy dist` - note the Pages **project name is hardcoded** in the `deploy` script (`a8-web`); create a project with that name or edit the script. Wrangler must be authenticated against the target account.

The repo also ships the full CI pipeline (`.github/workflows/`): pushes to `main` auto-deploy production after the test and conformance jobs pass, PRs get preview deployments at a stable per-branch URL, and old production deployments are pruned weekly. If you fork and want that pipeline, set the repository variable `CLOUDFLARE_ACCOUNT_ID` and the secret `CLOUDFLARE_API_TOKEN`.

### Anywhere else

Any static host works (e.g. `rsync` the `dist/` to a web root) - just mind the HTTPS and SPA-fallback requirements above.

## Licenses

The app's own code is MIT, like the rest of Sfotty Pie.

The firmware committed under `library/` keeps its own license - it's data the emulator loads, not part of the MIT code:

- **AltirraOS** and **Altirra BASIC** by Avery Lee - FSF all-permissive.
- **Atari++ OS** and **Atari++ BASIC** by Thomas Richter - Thor Public License (~ MPL 1.1); the corresponding source is bundled.

The full notices and the Atari++ source are served from `/legal/` (see [`public/legal/THIRD-PARTY-LICENSES.md`](public/legal/THIRD-PARTY-LICENSES.md)) and linked from the in-app About panel. Anything you add under `library.local/` is your responsibility: the original Atari OS/BASIC and most game ROMs are copyrighted - supply your own.

Sfotty Pie is an independent project, not affiliated with or endorsed by Atari, the Altirra/Acid800 project, or the Atari++ project.
