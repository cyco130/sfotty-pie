# How `@sfotty-pie/spasm` works

Notes on the internals of the assembler, for contributors and AI agents. This is the package-scoped peer of the repo-wide [CONTRIBUTING.md](../../CONTRIBUTING.md): the readme is for _users_ of the library; this file is for people working _on_ it. It explains the approach and the moving parts; the per-function details live in doc comments next to the code.

## What it is

spasm is a multipass 6502 assembler. The defining choice is that **assembly and linking are one integrated, multipass engine** rather than separate tools: addressing-mode sizing (zero-page vs absolute), span-dependent branch offsets, and segment placement all feed each other, so they're resolved together by iterating to a fixpoint. There is no separate object-file/link step - a build is one or more source modules assembled together into final bytes.

The opcode table is **documented opcodes only** (it's generated as the inverse of the sibling [@sfotty-pie/sfotty](../sfotty) disassembler's `NMOS_OPCODES`). The eventual language is large (macros, a type system, conditionals, relocation); what's built today is tracked in [What's deferred](#whats-deferred).

## The pipeline

```
source -> lex -> parse -> +------------- multipass loop -------------+ -> bytes
                          | collect (evaluate + encode) -> render    |
                          +------------------------------------------+
```

1. **Lex** ([src/lexer.ts](src/lexer.ts)) - a single big anchored regex turns source into tokens.
2. **Parse** ([src/parser.ts](src/parser.ts)) - recursive descent for statements, a Pratt parser for expressions, producing a CST-ish AST that keeps its tokens (and trivia) for a future pretty-printer.
3. **Load** ([src/loader.ts](src/loader.ts)) - resolve and parse the `.import` closure into a module graph.
4. **Expand macros** ([src/macros.ts](src/macros.ts)) - a static rewrite of every module's statements before assembly; macros are visible across modules via `.export .macro` and expansion is hygienic (see below).
5. **Assemble** ([src/assemble.ts](src/assemble.ts)) - the multipass loop: each pass _collects_ content into segments (evaluating expressions and encoding instructions) and then _renders_ the OUTPUT segment to bytes, until the symbol table reaches a fixpoint.

Steps 1-4 happen once; step 5 iterates.

## Public API surface

Everything exported lives in [src/index.ts](src/index.ts):

- `assemble(source, name?): AssembleResult` - assemble a single source string (no imports). **Synchronous** (no `Host`, so no I/O).
- `assemble(entry, host): Promise<AssembleResult>` - assemble a project rooted at module id `entry`, reaching other modules through a `Host`. **Asynchronous**, because the host is.
- `AssembleResult` - `{ output: Uint8Array, symbols: Map<string, Value>, diagnostics: Message[] }`. `output` is meaningful only when `diagnostics` is empty.
- `Host` - `{ resolve(specifier, fromId): string | Promise<string>; read(id): string | Promise<string> }` (re-exported from the loader). Both may throw (or reject); the loader turns that into a diagnostic.
- `Message`, `Value` - the diagnostic and value types.

**Sync core, async edge.** The `Host` is the only I/O and is consulted entirely upfront - `loadModules` (the loader) is the single async boundary, awaiting `resolve`/`read` while building the module graph. Everything after the graph is built (macro expansion, the multipass) is synchronous and shared by both entry points; the single-source overload just builds a one-module graph by parsing in-process, with no async at all. This keeps lexer/parser/evaluator/encoder sync and ready to port to a web or URL-backed host by swapping the `Host` alone.

A thin CLI ships too ([src/cli.ts](src/cli.ts), `bin: spasm`): `spasm INPUT -o OUTPUT`, parsing args with `node:util` `parseArgs` over an async `node:fs/promises` host.

## The multipass fixpoint

This is the core idea, and everything else is arranged to serve it.

A 6502 program can't be assembled in one linear pass: `lda foo` is 2 bytes if `foo` is in zero page and 3 if it isn't, but `foo`'s address depends on the sizes of everything before it. spasm resolves this by **iterating**:

- **Evaluate against the previous pass.** Within a pass, every expression resolves names and segment bases from the values the _previous_ pass produced. The first pass sees everything as unresolved.
- **Pessimistic, shrink-only sizing.** An unresolved operand is sized at its largest (absolute); once its value is known it can only shrink (to zero page). Monotone shrinking converges, and every intermediate state is a _valid_ program - so a non-converging build can still emit valid (if suboptimal) bytes.
- **Converge on symbol AND byte stability.** A pass snapshots the symbol table, runs, and compares - and the output bytes must also match the previous pass's. Symbols alone miss non-symbol state that feeds bytes (segment bases, `*`-relative `.res` counts - and, later, iterative-`.if` branch flips, which are emit-only and often symbol-invisible); bytes alone would stop early on placeholder streaks while values are still propagating one hop per pass. Each side catches what the other can't see: emplaced segments contribute no bytes but move labels. The cap (statement count + 1, min 8) is a backstop, not the normal exit; overshooting emits a warning, not an error.

The symbol table ([src/symbols.ts](src/symbols.ts)) is built for this: values **persist across passes** (so a forward reference resolves to last pass's value rather than clobbering to `undefined`), while a per-pass "seen" set enforces **define-once** (a second definition in the same pass is the error; the first is kept). `undefined` means "not resolved yet," distinct from `has()` ("defined, regardless of value").

## Values and evaluation

`Value = bigint | string` ([src/value.ts](src/value.ts)); `undefined` threads through as "unresolved." **Dictionaries** are not a `Value`: `N = { OPEN: 0, CLOSE: 2 }` lowers each entry to a qualified symbol (`N<NUL>OPEN` - the same NUL-joined key scheme module scoping uses), accessed as `N::OPEN` (chains for nested dicts), so entries get multipass resolution, forward references, and define-once for free. Dict literals take `:` (the call-site association mark - a keyword-arg list is a braceless dict literal; `=` inside braces would parse as equality), allow newlines as entry separators, reserve register names as keys like everywhere else (a future namespace-splat must be able to turn any key into a bare symbol, so keys and scope names share one name grammar - write `A4`, not `A`), are immutable and statically keyed, and are only legal as the whole right-hand side of a `=` definition (a dict is a value, not an address, so `:=` rejects it). An exported dict exports its entries (the import-resolution export check tests a qualified name's root). Numbers are unbounded `bigint` (range is checked at emit, not during arithmetic). Strings are first-class values, decoded with minimal C escapes; a **character literal is a single _byte_** in the target encoding (UTF-8 for now), so `'A'` is `65` but `'ü'` (two UTF-8 bytes) is an error - char and string literals share one encoder.

[src/evaluate.ts](src/evaluate.ts) is a straightforward recursive evaluator over an `EvalEnv` (`resolve`, the `*` location counter, `report`, `strict`). `resolve` takes an optional `origin` - the module a macro-stamped identifier lexically binds to (see Macros). `*` is also source-level syntax - an expression can reference the current location counter directly (`jmp *`). `undefined` propagates through arithmetic so forward references defer cleanly. With `strict` on (the assemble pass turns it on), an unresolved _identifier_ is reported as undefined - but only on the converged pass survives, since earlier passes' diagnostics are discarded. Equality is `=` (ca65-style, no `==`); precedence low->high is `|| < && < (= != < >) < (+ -) < (* / %)`, with prefix `+ - < > !` binding tightest and `::` (scope resolution) tighter still.

## Instruction encoding

[src/encode.ts](src/encode.ts) maps an instruction's operand _shape_ (immediate, indexed, indirect, ...) plus its evaluated value to an addressing mode, then to a byte, using the generated `OPCODES` table as the oracle (if a mnemonic lacks a mode, that's the error). Zero-page/absolute selection is the shrinkable decision: unresolved or >= `$100` -> absolute; a resolved value < `$100` with a zp form available -> zero page. Branch offsets are relative to `pc + 2`; range checks (byte, word, branch) fire at emit. An unresolved operand emits correctly-sized zero placeholders so later passes can fix it up.

## The segment / OUTPUT layout engine

This is what makes "assembler = linker." It lives in [src/layout.ts](src/layout.ts) and the `collect`/`render` split in [src/assemble.ts](src/assemble.ts).

**Segments are byte-collectors.** A `Segment` is an ordered list of _items_: literal `bytes` (from instructions and `.byte`/`.word`), an `.org`, a `label` (resolved later), a `res` (its count expression, evaluated at render), or an `emit`/`emplace` of another segment. The "current" segment (default `OUTPUT`, switched by `.segment "X"` or the shorthands `.code`/`.rodata`/`.data`/`.bss`/`.zeropage`, which upper-case into the segment name) receives content as collection walks the statements. `OUTPUT` is not special-cased - it's just the segment written to the file at the end.

**Collect -> render, per pass:**

- _Collect_ walks statements into segments, evaluating expressions and encoding instructions against the previous pass's symbol values and segment bases. Constants (`=`/`:=`) are defined here. Labels are recorded as items (their addresses aren't known yet).
- _Render_ (`render(segments, "OUTPUT", ...)`) walks the OUTPUT segment with two counters - a **location counter** (run address; set by `.org`, advanced by content/emit/emplace) and the **file length** (advanced by content/emit, _not_ by `.org`/`.emplace`, so run addresses and file offsets diverge cleanly). It recurses through `.emit "X"` (render X at the current LC, splice its bytes) and `.emplace "X"` (same, but reserve without emitting). Reaching a label item resolves it to the current LC; reaching an emit assigns that segment its **base**. A `res` item evaluates its count at the current LC (via an injected evaluator callback, same layering as label definition), so `*`-relative fills like `.res $2000 - *` are exact even on the first pass - the zeros ride the normal bytes path, so emit-vs-emplace needs no special casing. Collect can't know the size (it would bake the previous pass's base), so render feeds resolved sizes back (`resSizes`, like `bases`) and collect's running location advances by the previous render's size - one pass of lag the fixpoint absorbs, kept honest by byte-stable convergence. A negative count reports "content overflows the fill boundary." Cycles in the emit graph are detected (a stack set) and reported, not followed.

**Labels resolve as `base + offset`.** A segment's labels are offsets within it; render assigns the segment a base where it's emitted, and the label's absolute address is `base + offset`. Conceptually a label is the expression `.base("SEG") + offset` - it collapses to an absolute number once an `.org` anchors the emit chain (which, for the current samples, is immediate). The reverse, "stays symbolic until anchored" (true relocation), is deferred.

**Forward-segment references converge via the one-pass lag.** OUTPUT's header can reference a label (`.word start`) in a segment emitted _later_ in the same render. Because everything evaluates against the previous pass's values, the reference reads last pass's address and settles over passes - the same mechanism as ordinary forward labels. Branch pc is handled the same way: collect tracks a per-segment running location starting at the previous render's base, and same-segment branch offsets are base-invariant, so they converge regardless of the base.

## Modules and scoping

A build is a graph of modules reached through a `Host`. The loader ([src/loader.ts](src/loader.ts)) starts at the entry, resolves each `.import` (relative to the importer), parses it, and recurses - **deduped by canonical id** (a diamond loads once), in dependency order (imports before importers), with import cycles reported rather than followed. It records each module's resolved imports for scoping. `.import` evaluates the _whole_ module (any top-level side effects run); there is no `import type`-style exports-only form - though a module like lib.s that only exports assignments and macros has no side effects left to run.

Scoping ([src/scopes.ts](src/scopes.ts)) layers per-module scopes and one ambient scope over a single `SymbolTable` via qualified keys (`moduleId \0 name`; the ambient scope uses a reserved pseudo-module id). The rules:

- A module's symbols are **private** unless `.export`ed.
- `.import "m"` is a **splat**: `m`'s exports become resolvable in the importer. Resolution checks the module's own scope, then its splat-imports' export sets.
- There is **no ambient/global scope**. The entry-point handshake is an exported macro: the format module exports (say) `output_sfotty_exe start`, the program calls it passing its entry label, and after expansion the `.word start` in the format script is an ordinary intra-module reference in the program - no cross-module value flow, no extra pass.

Because labels are defined during _render_ (when addresses are known) but belong to a specific module's scope, each label item carries its `moduleId`, and render defines it via `scopes.defineLocal(moduleId, ...)`.

## Macros

Macros are a static, syntactic step ([src/macros.ts](src/macros.ts)) that runs once _before_ the multipass - `expandModules` collects every module's `.macro name params ... .endmacro` definitions (removing them from the stream), then replaces each call - an instruction whose mnemonic names a visible macro - with the body. Visibility mirrors symbol scoping: a module sees its own macros plus the **exported** (`.export .macro`) ones of its imports, and a body's own macro calls resolve where the macro was _defined_, not where it was called.

A macro call takes a comma-separated **operand list** - a comma followed by a register name binds to the preceding operand as its indexed suffix (registers are reserved words, so this is unambiguous), any other comma separates operands - and each argument is a whole _operand_, shape included: `mva (src),y, (dst),y` passes two indirect-indexed operands. Operand is a **super-type of simple values**: a simple operand (a plain expression) substitutes anywhere; a shaped operand (immediate, indexed, indirect, accumulator) substitutes only where a param stands alone in operand position (`lda src`), and using one inside an expression is a type error at expansion. (Future introspection builtins - `.mode()`/`.value()` - will open shaped operands up to advanced macros.) Real mnemonics reject operand lists with an arity error at encode.

Expansion is hygienic with **lexical binding**. Per call, the body is `structuredClone`d (so the template isn't mutated) and each identifier is classified three ways: a _param_ substitutes to its argument operand (the caller's binding - params are the only call-site channel); a name _defined_ in the body (labels, `:=`/`=`) renames with a per-expansion suffix (`name@N`) so repeated calls don't collide; a _free_ name is stamped with the defining module's id (`Token.origin`) so it resolves in the defining module's scope - private helpers work in bodies without being exported, and the ca65-style "the includer defines the symbol" idiom is deliberately rejected. The outward channel is a declared contract: a `.out` param (`.macro alloc .out name`) receives its definition from the body (`name: .res 1`, `name = expr`, or forwarding to a nested call's `.out` position - reads are also allowed) and lands it under the caller's name in the caller's scope. Both directions are checked at the definition site, for used and unused macros alike: an `.out` param the body never defines is an error, and a plain param the body defines (or forwards to an `.out` position) is an error telling you to declare it `.out`. At the call, an `.out` argument must be a plain identifier - rejected at the call span otherwise. Nested calls expand recursively under a depth cap.

Free names of macros that are never expanded are still checked structurally at the definition site (a name must be defined in the defining module or exported by its imports); expanded bodies get the same check for free via the normal strict-mode undefined-symbol path, whose spans point at the body tokens. Module-level directives (`.import`/`.export`/`.macro`) are rejected inside bodies.

The exported-macro mechanism is also the **output-format channel**: lib.s exports `output_sfotty_exe start`, whose body defines the segments and the OUTPUT script; each program calls it once, passing its entry label.

## Syntax decisions worth knowing

- **`=` vs `:=`.** `name = expr` defines a _constant_; `name := expr` (and `name:`) defines a _label_ (address-valued). The kind is recorded on the symbol; it carries no behavior yet but is the hook for future address attributes.
- **`::`, not `.`, for dictionary/scope access.** A member dot would collide with the dotted-keyword lexing (`.byte`, `.word`), so access uses `::` (ca65-style): `NOTES::C4`. Evaluates against dict-valued symbols (see Values); namespace _imports_ (`name = .import "m"`, macros through dicts) are still deferred.
- **The register-name lexing trap.** Bare `a`, `x`, `y` lex as registers, not identifiers (so `asl a` is accumulator mode). Tests and sample code must avoid them as symbol names - a recurring gotcha.
- **Diagnostics carry raw offsets.** `Message` is `{ type, start, end, message }`. Across multiple modules these offsets are module-local and currently un-disambiguated by file; nice formatting via [src/source-file.ts](src/source-file.ts) is wired but not yet used by `assemble` (it's the CLI's job, deferred).

## The opcode table

[src/opcodes.ts](src/opcodes.ts) is **generated and committed**: `mnemonic -> { mode: byte }`, documented opcodes only. [src/generate-opcodes.ts](src/generate-opcodes.ts) (dev-only, `pnpm --filter @sfotty-pie/spasm generate:opcodes`) imports the sibling sfotty core's `NMOS_OPCODES` _source_ directly (no package dependency), inverts it, filters undocumented opcodes, asserts the inverse is faithful, and prettier-formats the output. Treat `opcodes.ts` as pure output.

## What's deferred

All four samples (hello/echo/cat/guess) now assemble and run. Not yet built (roughly in priority order - **nicer diagnostics** is the highest-value next step now that there's a CLI):

- **`.if`/`.elseif`/`.else`/`.endif` + `.error`** - layout-time conditionals.
- **Segment attributes** (`.define_segment "X", type:..., executable:...`) - the kind/exec flags and their keyword-arg syntax; emit-vs-reserve is currently chosen by `.emit`/`.emplace` alone.
- **Relocation** - symbolic `.base()`/`.reloc`, and the `.base`/`.startof`/`.sizeof` builtins.
- **Richer modules** - named/aliased/namespace imports (`name = .import` binding the module's export dict, macros included; `.import "m": a, b`), the `.namespace ... .endnamespace` inline-module block, and `.export` of anything but an assignment or a macro (notably labels). (Dict-valued symbols and `::` access are done - the import forms build on them.)
- **Richer macros** - keyword arguments and defaulted params, operand introspection builtins (`.mode()`/`.value()`), and exporting macro-defined symbols beyond the param-named-definition channel (fixed-name or derived names like `name_end`).
- **Nicer diagnostics** - `Message` carries raw offsets with no module id, so the CLI prints messages without `file:line:col`; multi-module span formatting is unbuilt. (The CLI and standing run-in-the-core sample tests now exist - see `@sfotty-pie/cli`'s `build:samples` and `samples.test.ts`.)
- **Cyclic _definition_ detection** - `A = B` / `B = A` converges to undefined and reports "undefined symbol" (no hang), not a precise cycle error.
- **A pretty-printer / formatter** - the parser keeps every token and its trivia precisely so the AST can round-trip back to source; nothing consumes that yet.

## File map

| File                                               | Role                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [src/lexer.ts](src/lexer.ts)                       | Big-regex tokenizer; `DOT_KEYWORDS`, the register names.                                    |
| [src/source-file.ts](src/source-file.ts)           | Source wrapper: line/column lookup and error/caret message formatting.                      |
| [src/parser.ts](src/parser.ts)                     | Recursive-descent + Pratt parser; the AST, `getExpressionLocation`, `Message`/`ParseError`. |
| [src/value.ts](src/value.ts)                       | `Value` type and `decodeStringLiteral`.                                                     |
| [src/evaluate.ts](src/evaluate.ts)                 | Expression evaluator and `EvalEnv`.                                                         |
| [src/encode.ts](src/encode.ts)                     | Instruction encoder: operand shape -> mode -> byte, zp/abs sizing, branch offsets.          |
| [src/opcodes.ts](src/opcodes.ts)                   | _Generated._ The documented-opcode table (`OPCODES`).                                       |
| [src/generate-opcodes.ts](src/generate-opcodes.ts) | Dev-only generator; inverts sfotty's `NMOS_OPCODES`.                                        |
| [src/symbols.ts](src/symbols.ts)                   | `SymbolTable`: define-once, label/constant kind, persist-across-passes, fixpoint snapshot.  |
| [src/scopes.ts](src/scopes.ts)                     | Per-module + ambient scopes over `SymbolTable` via qualified keys.                          |
| [src/loader.ts](src/loader.ts)                     | `Host` contract and the module-graph loader (dedup, cycles, dependency order).              |
| [src/macros.ts](src/macros.ts)                     | `expandModules` - cross-module hygienic macro expansion (lexical binding).                  |
| [src/layout.ts](src/layout.ts)                     | `Segment` and `render` - the segment/OUTPUT layout engine.                                  |
| [src/assemble.ts](src/assemble.ts)                 | The orchestrator: `assemble()`, `collect`, and the multipass loop.                          |
| [src/cli.ts](src/cli.ts)                           | The `spasm` CLI (`bin`): `spasm INPUT -o OUTPUT` over an async fs host.                     |
| [src/utils.ts](src/utils.ts)                       | Tiny helpers (`impossible` exhaustiveness check, `assume`).                                 |
| [src/index.ts](src/index.ts)                       | Public API.                                                                                 |
