---
description: Scaffold a new package from packages/_template
---

Add a new package named `$ARGUMENTS` to the workspace.

If `$ARGUMENTS` is empty, ask the user for the package name first (kebab-case, npm-safe).

The template ships with placeholders that must be filled in: `package.json` has `"description": "TODO: ..."` and empty `keywords`, and `readme.md` has a `# TODO: package title` heading and a `TODO:` description paragraph. Resolve all of them.

Steps:

1. Read `packages/_template/package.json` to derive the project scope. Its `name` is `@<scope>/template-package`.
2. Copy `packages/_template/` to `packages/$ARGUMENTS/`.
3. Ask the user for a human-readable title (the project uses the `<Project> <Suffix>` style, e.g. "Sfotty Pie CLI") and a one-line description, unless both are obvious from context.
4. In the new `packages/$ARGUMENTS/package.json`:
   - Rename `@<scope>/template-package` to `@<scope>/$ARGUMENTS`.
   - Remove the `"private": true` line (real packages are publishable).
   - Replace the placeholder `description` with the one-line description.
   - Fill `keywords` with a few relevant terms (look at sibling packages for the house style). If none are obvious, leave `[]` and flag it.
5. In the new `packages/$ARGUMENTS/readme.md`, replace the `# TODO: package title` heading with the title and the `TODO:` paragraph with the description. Leave the license/credits section as-is (it already points at the right repo).
6. Run `pnpm install` from the repo root.
7. Report briefly: the new package name, the path created, and any placeholder left unresolved (e.g. empty `keywords`).

Don't touch `packages/_template/` itself — it stays as the canonical scaffold for future packages.
