# spasm-vscode

VSCode language support for the [spasm](../../packages/spasm) 6502 assembler: syntax highlighting (TextMate grammar), live diagnostics from the real assembler over LSP, go to definition, hover (the definition line with its preceding comments, plus the converged value - a label shows its address), and a document outline (labels with their `@` locals nested and their addresses shown, dictionaries with entries, macros with params; code labels span to the next label so breadcrumbs and sticky scroll track the enclosing routine), and context-aware completion (statement position offers mnemonics, directives, and visible macros; expression position offers in-scope symbols with their values; `::` offers a binding's exports or a dictionary's keys; nothing inside comments or strings), semantic highlighting (identifiers colored by what they resolve to - labels, constants, dictionaries and their entries, macros, params, namespace bindings - layered over the TextMate grammar), find references, and cross-file rename (locals keep their `@`, registers and anonymous labels refuse).

Definition and hover answers come from the assembler itself: the converged pass records every reference the evaluator resolves (`AssembleResult.references`/`definitions`), so locals, `.if`-arm renames, splat and namespaced imports all behave exactly like assembly - there is no separate, driftable resolver in the extension.

The extension is a thin client plus a language server bundled from [src/server.ts](src/server.ts). The server imports `@sfotty-pie/spasm` directly and assembles on every change (debounced), reading open editor buffers through the assembler's `Host` so unsaved edits diagnose correctly. Diagnostics keep spasm's stable `SPxxxx` codes, and secondary spans ("previously defined here") map to related-information links.

Unlike the rest of the workspace, the package name is unscoped: a VSCode extension's identifier is `publisher.name` and the marketplace does not accept scoped npm names.

## Project configuration: spasm.jsonc

A lone module often can't assemble standalone - a library that fills segments the entry `.emit`s would report whole-program errors like "segment never consumed". A `spasm.jsonc` next to (or above) your sources names the entry modules, and the server assembles each entry's whole import closure instead, attributing diagnostics to the right files:

```jsonc
{
  // Entry modules, relative to this file.
  "entries": ["src/main.s"],
}
```

Open files not reached from any configured entry (or with no config anywhere up to the workspace folder) fall back to standalone assembly. The config is read from disk, so edits to it apply on save.

## Developing

```sh
pnpm install          # from the repo root
pnpm --filter spasm-vscode build   # or `dev` for watch mode
```

Then press F5 in VSCode ("Run spasm extension" - the launch config lives in the repo's [.vscode/launch.json](../../.vscode/launch.json) and builds first via a pre-launch task). A second window opens with the extension loaded; open any `.s` file. After code changes, rebuild (automatic under `dev`) and run "Developer: Reload Window" in the dev-host window.

The build bundles `src/extension.ts` (client) and `src/server.ts` (server) to CommonJS with esbuild - the VSCode extension host still requires CJS entry points, so the app bundles to `.cjs` while sources stay ESM like the rest of the repo.
