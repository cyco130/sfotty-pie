# Contributing

Thanks for considering a contribution.

## Prerequisites

- **Git**.
- **Node** — the latest minor of the most recent LTS. Published packages support a broader range — every LTS plus every Current Node release still maintained upstream, pinned in `engines.node` of each `packages/*/package.json` — but dev/build scripts may rely on features that landed in recent LTS minors.
- **pnpm** — the version pinned in the root `package.json`'s `packageManager` field. `corepack enable` picks it up automatically; otherwise any pnpm of the same major should work.

## Setup

```sh
pnpm install --frozen-lockfile
```

## Layout

- `packages/*` — published libraries.
- `examples/*` — degit-cloneable consumer demos.
- `packages/_template/` and `examples/_template/` — scaffolds; copy from these when adding new packages.

Some packages carry a `design.md` next to their `readme.md` that explains how they work internally — start there when working on a package's guts.

## Common commands

```sh
pnpm dev      # watch-build all packages
pnpm build    # one-off build
pnpm test     # full suite: per-package tests + Prettier check
pnpm format   # write Prettier across the repo
```

Inside a package, `pnpm test` runs `test:unit` (vitest), `test:typecheck` (tsc), `test:lint` (eslint), and `test:package` (publint).

## Adding a package

Copy `packages/_template/` to `packages/<name>/`, rename `@<projname>/template-package` to `@<projname>/<name>` in its `package.json`, drop `"private": true`, fill in the `description`/`keywords` and the `TODO:` placeholders in `readme.md`, and run `pnpm install`. Claude Code users: `/new-package <name>` does this in one step.

## Code style and commits

We use Prettier and ESLint, running `pnpm format` and `pnpm test:lint` should leave nothing to argue about. Pre-commit hooks (husky + lint-staged) auto-format staged files.

If you'd rather run formatters by hand, opt out of the hooks per-commit with `git commit --no-verify` (or `-n`), or for the whole shell session with `export HUSKY=0`. Either is fine — just make sure CI is green before you push.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `release:`, etc.

## Pull requests

- AI use is fine as long and is subject to the same review standards as human-written code.
- Small, focused, and well-described PRs are welcome.
- For large or complex changes, open an issue first to discuss the approach before investing time in implementation.
- Code-quality CI (`.github/workflows/cq.yml`) must pass.

## Releases

Releases are cut by a maintainer via the `Publish to NPM` workflow in GitHub Actions, which runs `./version <semver>` and publishes to npm via `pnpm -r publish`.
