# CLAUDE.md

Project context for Claude Code and other agents. Keep this file focused on things that are **not** obvious from reading the repo — anything you can grep for in five seconds doesn't belong here.

Markdown in this repo is not manually wrapped. Write one paragraph per line and let the editor soft-wrap.

## Layout

- `packages/*` — publishable libraries. Built with tsdown, published to npm.
- `examples/*` — consumers of the packages. Not published. Designed to be cloned standalone (e.g. via `degit`), so **dependencies on workspace packages must use real version pins, never `workspace:*`**. The `./version` script keeps those pins in sync with the latest package versions; pnpm still links them locally during dev because of `linkWorkspacePackages: true` in [pnpm-workspace.yaml](pnpm-workspace.yaml).
- `packages/_template/` and `examples/_template/` — scaffolds. They're real workspace members named `@<projname>/template-package` and `@<projname>/template-example` (both `private: true`) so Renovate keeps their deps current. Both `src/` files are stubs (a single `console.log`) — they don't import or export anything, on purpose: a real working consumer would break the moment the package's API changes. The example template still **declares** a dep on the main published package (`@<projname>/<projname>`) — `init` rewrites this dep when bootstrapping — so degit-cloned starters arrive with the dep wired up. Common scripts (`dev`/`build`/`test`/`ci`) filter the templates out via `!@<projname>/template-*` so they don't fan into normal work.

The root `readme.md` is a symlink into the primary package's readme. Edit the symlink target, not the symlink.

## Adding a new package

1. Copy `packages/_template` to `packages/<name>`.
2. In its `package.json`: rename `@<projname>/template-package` to `@<projname>/<name>`, drop `"private": true`, and update `description`/`repository`.
3. `pnpm install` from the root.

Do not start a new package by copying an existing one — `_template` is the canonical scaffold and stays current.

**Naming convention:** every package is scoped under `@<projname>/`, including the main one (`@<projname>/<projname>`). Bare unscoped names are avoided because they're rarely available on npm. Don't introduce a bare-named package without a good reason.

## Stack invariants

These are deliberate. Don't change them without a reason.

- **ESM only.** No CJS output, no `"type": "commonjs"`. tsdown is configured for `format: ["esm"]` and `platform: "node"`.
- **Strict TS** with `nodenext` module resolution, `noUncheckedIndexedAccess`, and `noImplicitOverride`.
- **Relative imports use `.ts` extensions**, not `.js`. Lint enforces this; tsconfigs allow it via `allowImportingTsExtensions`. The point is that source runs natively under Node's TS support and Deno, no transpile step required.
- **Tabs, 80 cols.** Markdown and `package.json` use 2-space indent (see [.prettierrc](.prettierrc)). Don't reformat with spaces.
- **Node**: published source in `packages/*/src/` targets the lowest `engines.node` major (every LTS plus every Current Node release that's still maintained upstream). Dev tooling, build configs, and scripts (e.g. `init`, `tsdown.config.ts`) can assume the latest minor of the most recent LTS — features that landed in recent LTS minors are fair game there; Current-only features aren't. Off-limits inside `packages/*/src/`.
- **ESLint config** comes from `@cyco130/eslint-config/node`. Lint rules live there, not in-repo.

## Commands

Run from the repo root unless noted.

- `pnpm dev` — watch-build all packages in parallel.
- `pnpm build` — build all packages.
- `pnpm test` — runs every script matching `test:*` (uses pnpm's `/^test:/` pattern syntax). Adding a new `test:foo` script auto-joins the suite — no test runner registry to update.
- `pnpm run ci` — per-package CI script (each package decides what its CI pipeline runs). Note: bare `pnpm ci` is the clean-install command, not this script.
- `pnpm format` — Prettier write across the repo.

Inside a package, `pnpm test` similarly fans out to `test:unit` (vitest), `test:typecheck` (`tsc --noEmit`), `test:lint` (eslint), and `test:package` (publint).

## Versioning and publishing

- `./version <semver-arg>` (e.g. `./version patch`, `./version 1.2.0`) bumps every package in `packages/*` and rewrites `examples/*` deps to drop the `workspace:` protocol so they pin to the new version. Run this from a clean tree — it edits `package.json` files and the lockfile.
- Don't hand-edit versions across packages.
- Publishing is wired up in [.github/workflows/publish.yml](.github/workflows/publish.yml).

## Tooling around the edges

- **husky + lint-staged** run on pre-commit. If a commit is being blocked, fix the underlying lint/format issue rather than bypassing the hook.
- **Renovate** config lives at [.github/renovate.json](.github/renovate.json).
- **VSCode** recommended extensions and settings live in `.vscode/`.
