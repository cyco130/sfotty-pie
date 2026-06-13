---
description: Scaffold a new package from packages/_template
---

Add a new package named `$ARGUMENTS` to the workspace.

If `$ARGUMENTS` is empty, ask the user for the package name first (kebab-case, npm-safe).

Steps:

1. Read `packages/_template/package.json` to derive the project scope. Its `name` is `@<scope>/template-package`.
2. Copy `packages/_template/` to `packages/$ARGUMENTS/`.
3. In the new `packages/$ARGUMENTS/package.json`:
   - Rename `@<scope>/template-package` to `@<scope>/$ARGUMENTS`.
   - Remove the `"private": true` line (real packages are publishable).
4. Run `pnpm install` from the repo root.
5. Report briefly: the new package name and the path created.

Don't touch `packages/_template/` itself — it stays as the canonical scaffold for future packages.
