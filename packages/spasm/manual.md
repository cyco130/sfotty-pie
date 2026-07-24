# The spasm language manual

This is the user manual for spasm's assembly language: the source format, expressions, directives, segments, modules, and macros. It documents what the assembler implements today. Spasm is a work in progress - the syntax is still evolving, and a few reserved constructs are listed at the [end](#not-yet-implemented).

For the JavaScript API and the CLI, see the [readme](./readme.md); for the assembler's internals, see [design.md](./design.md).

## Contents

- [Overview](#overview)
- [Source format](#source-format)
- [Numbers, strings, and characters](#numbers-strings-and-characters)
- [Symbols: constants and labels](#symbols-constants-and-labels)
- [Expressions](#expressions)
- [Instructions and addressing modes](#instructions-and-addressing-modes)
- [Data and fill directives](#data-and-fill-directives)
- [Segments and output layout](#segments-and-output-layout)
- [Modules](#modules)
- [Macros](#macros)
- [Expression macros](#expression-macros)
- [Dictionaries](#dictionaries)
- [Symbol attributes](#symbol-attributes)
- [The multipass model](#the-multipass-model)
- [Directive reference](#directive-reference)
- [Not yet implemented](#not-yet-implemented)

## Overview

Spasm is a multipass cross-assembler for the 6502 (documented opcodes only). Its defining feature is that the assembler and the linker are one integrated engine: segment placement, zero-page vs absolute operand sizing, and forward references are all resolved together by iterating to a fixpoint. There is no separate object-file or link step - a build is one or more source modules assembled together into final bytes.

The simplest program uses none of that machinery. Everything you write goes, by default, straight into the output file:

```
; hello.s - every byte lands in the output file directly
	.byte "HELLO", $0A, 0
```

```
$ spasm hello.s -o hello.bin
```

A more realistic flat program mixes raw file bytes (headers) with code placed at a run address:

```
	.word $FFFF          ; header: file bytes with no run address
	.word start
	.word last - 1

	.org $2000           ; run address of everything that follows
start:
	lda #0
color_loop:
	sta $D40A
	clc
	adc #1
	jmp color_loop
last:
```

`last` is referenced before it is defined; the multipass engine resolves forward references anywhere, including in header material that precedes the code. When a program outgrows the flat form, [segments](#segments-and-output-layout) let you collect code, data, and BSS separately and script the file layout explicitly, and [modules](#modules) let you split it across files.

## Source format

Spasm is line-oriented. Each line holds one statement:

```
label: mnemonic operands ; comment
```

Every part is optional. A statement may start with any number of `name:` labels (usually zero or one), which may also stand on a line of their own. Comments run from `;` to the end of the line. Blank lines are ignored.

A backslash at the end of a line continues the statement onto the next line. Trailing blanks and a comment may follow the backslash (but the backslash must come first - inside a comment it is just comment text):

```
	.byte 1, 2, 3, \ ; six bytes
	      4, 5, 6
```

**Labels require the colon.** `foo bar` is not a label `foo` followed by `bar`; it is a call of the macro `foo` with the operand `bar`. The colon rule keeps macro invocations and labels unambiguous.

**Case.** The fixed vocabulary - mnemonics, register names, and dotted directives - is case-insensitive (`LDA`, `lda`, and `Lda` are the same instruction). Everything the user names is case-sensitive: `Foo` and `foo` are two distinct symbols.

**Names** start with an ASCII letter or underscore, followed by any number of letters, digits, or underscores. The register names `a`, `x`, and `y` (in any case) are reserved words and cannot be used to name anything - symbols, macro parameters, or dictionary keys - because `asl a` must parse as accumulator mode. This is a common trap when porting code; rename such symbols (e.g. `x` to `xpos`).

**Directives** start with a dot (`.byte`, `.macro`, ...). The dot keeps them out of both user namespaces, and an unknown dotted word is an error rather than a symbol.

## Numbers, strings, and characters

- Decimal: `123`. Hexadecimal: `$FF`. Underscores may be used as digit separators in both (`1_000_000`, `$FF_FF`). There are no binary, octal, `0x`, or `0b` forms.
- Numbers are unbounded integers. Arithmetic never overflows; values are range-checked only where bytes are emitted (a `.byte` operand must fit a byte, and so on).
- String literals use double quotes: `"Hello"`. They are single-line, with the C-style escapes `\\`, `\"`, `\'`, `\n`, `\t`, `\r`, and `\0`. Strings encode to UTF-8 bytes with no terminator; `.byte "HI"` emits exactly two bytes, and a message supplies its own terminator (`.byte "HI", 0`).
- Character literals use single quotes: `'A'` is the number 65. A character literal is a single byte in the target encoding (currently UTF-8), so `'ü'`, which encodes to two bytes, is an error.

## Symbols: constants and labels

Symbols are introduced three ways:

```
MAX = 100          ; a constant: any value
EXIT := $0200      ; a label: an address you name explicitly
start:             ; a label: the current location
```

`=` defines a **constant** and `:=` defines a **label** (an address-valued symbol). Both take arbitrary expressions; the kind records intent - only labels may carry [placement attributes](#symbol-attributes), and constants may hold non-numeric values like [dictionaries](#dictionaries) and [expression macros](#expression-macros). `name:` is the positional form of a label: it binds `name` to the address the assembler is currently at.

**Symbols are define-once.** There is no `.set`-style mutable variable; defining the same name twice is an error.

**Forward references work everywhere.** A symbol may be used before it is defined - in operands, in `.byte`/`.word` data, in other definitions (`SYM1 = SYM2 + 3` with `SYM2` defined later). The multipass engine resolves them; see [The multipass model](#the-multipass-model). One current limitation: a genuinely cyclic definition (`A = B` and `B = A`) is not specifically detected - it converges to unresolved and is reported as an undefined symbol.

Symbols are scoped to their [module](#modules) and private unless exported.

## Expressions

Operands, data values, and the right-hand sides of definitions are all expressions. Binary operators, from lowest to highest precedence:

| Precedence | Operators                     | Meaning                                 |
| ---------- | ----------------------------- | --------------------------------------- |
| 1 (lowest) | `\|\|`                        | logical OR                              |
| 2          | `&&`                          | logical AND                             |
| 3          | `=` `!=` `<` `>`              | comparison (note: equality is `=`)      |
| 4          | `+` `-` `\|`                  | additive, bitwise OR                    |
| 5          | `*` `/` `%` `&` `^` `<<` `>>` | multiplicative, bitwise AND/XOR, shifts |

Prefix operators bind tighter than any binary operator: `+` `-` (sign), `<` (low byte), `>` (high byte), `!` (logical NOT), `~` (bitwise complement). Tighter still are `::` ([scope resolution](#dictionaries)) and function application (`F(v)`).

Notes:

- **Equality is `=`, not `==`** (ca65-style). It is unambiguous: an identifier followed by `=` at the start of a statement is a definition; `=` anywhere in expression position is equality.
- Comparison and logical operators yield `1` or `0`. Any nonzero value is truthy. `&&` and `||` short-circuit, so `0 && whatever` resolves even while `whatever` is still an unresolved forward reference.
- `<expr` and `>expr` take the low and high byte of a value - the standard idiom for address halves: `lda #<message` / `ldx #>message`.
- `~` is an arbitrary-precision complement: `~$0C` is `-$0D` as an unbounded integer, and truncating it to a byte yields the expected `$F3`.
- Division and modulo by zero, and negative shift counts, are errors.
- `*` in expression position is the current location counter (the run address): `jmp *` is an infinite loop, and `.res $2000 - *` fills up to `$2000`.
- Parentheses group, but at the start of an instruction operand they can also mean indirect addressing; see [the disambiguation rule](#parentheses-indirect-addressing-vs-grouping).

**Gotcha:** `<<` lexes greedily. Comparing against a low byte needs a space: `a < <b` (less-than low-byte-of-b), not `a << b` (shift).

## Instructions and addressing modes

Spasm accepts the documented NMOS 6502 instruction set. Mnemonics are case-insensitive; a real instruction takes at most one operand (comma-separated operand lists exist for [macro calls](#macros)). The operand's shape selects the addressing mode:

| Shape            | Written as                  | Modes                                     |
| ---------------- | --------------------------- | ----------------------------------------- |
| none             | `clc`                       | implied                                   |
| accumulator      | `asl a` (or `asl`)          | accumulator                               |
| immediate        | `lda #expr`                 | immediate                                 |
| direct           | `lda expr`                  | zero page or absolute (automatic)         |
| indexed          | `lda expr,x` / `lda expr,y` | zero page,X/Y or absolute,X/Y (automatic) |
| indirect         | `jmp (expr)`                | indirect                                  |
| indexed indirect | `lda (expr,x)`              | (indirect,X)                              |
| indirect indexed | `lda (expr),y`              | (indirect),Y                              |

A bare shift (`asl`, `lsr`, `rol`, `ror`) with no operand means accumulator mode, for compatibility with assemblers that omit the `A`.

**Zero page vs absolute is chosen for you.** If the operand's value is known to fit in `$00`-`$FF` and the instruction has a zero-page form, the short encoding is used; otherwise the absolute form. An operand whose value is not yet known (a forward reference) is sized pessimistically at absolute first and shrinks to zero page once its value settles - see [The multipass model](#the-multipass-model).

**Branches** (`bne`, `bcc`, ...) take a target address as their operand; the assembler computes the relative offset. A target further than the -128..+127 byte reach is an error (there is no automatic long-branch rewriting yet).

### Parentheses: indirect addressing vs grouping

At the start of an operand, a parenthesized term is indirect addressing **only when it is the whole operand**: `(expr)`, `(expr,x)`, or `(expr),y`. If anything follows the closing parenthesis - an operator tail, or an `,x` index on the parenthesized value - the parentheses were grouping and the operand is a computed direct value:

```
	jmp (vector)          ; indirect jump
	jmp (base + 2) * 2    ; absolute jump to a computed address
	lda (ptr),y           ; (indirect),Y - ptr must be a zero-page pointer
	lda (base + 8),x      ; absolute,X of a grouped value ((zp),X does not exist)
```

To force a lone parenthesized term to be a plain value rather than indirect, give it a tail or a prefix: `jmp +(expr)` or `jmp (expr) + 0`.

## Data and fill directives

**`.byte`** emits one byte per numeric value (each must fit in -128..255) and splices string values in as their UTF-8 bytes:

```
message:
	.byte "Score: ", 0
digits:
	.byte '0', '1', '2'
```

**`.word`** emits 16-bit little-endian words (-32768..65535). Strings are not allowed in `.word`.

```
	.word $FFFF, start, last - 1
```

**`.res count`** reserves `count` bytes of zeros. The count is evaluated at the reservation's final address, so location-relative fills are exact: `.res $2000 - *` pads to `$2000`. A negative count reports that the content has overflowed the fill boundary. `.res` is the usual way to lay out variables:

```
.segment "ZEROPAGE"
ptr:    .res 2
count:  .res 1
.segment "BSS"
buffer: .res 128
```

Whether reserved bytes occupy space in the output file depends on how their segment is placed - `.emit` writes them as zeros, `.emplace` assigns addresses without writing anything (see below).

## Segments and output layout

A **segment** is a named collector of bytes, labels, and reservations. At any point during assembly there is a _current segment_ receiving everything you write; it starts out as `OUTPUT` and is switched with:

- `.segment "NAME"` - switch to (creating if needed) the named segment.
- `.code`, `.rodata`, `.data`, `.bss`, `.zeropage` - shorthands for `.segment "CODE"` etc. (the name is the keyword upper-cased).
- `.define_segment "NAME"` - declare a segment without switching to it (useful in format definitions so the names exist even if the program leaves some empty).

`OUTPUT` is the segment written to the output file; it is otherwise ordinary. Content in any other segment reaches the file only by being placed from `OUTPUT` (directly or transitively):

- **`.emit "X"`** renders segment X at the current location and splices its bytes into the file.
- **`.emplace "X"`** does the same address assignment but writes no bytes - the right placement for BSS-style segments whose contents don't ship in the file.

Placement is what turns a segment's labels into absolute addresses: a label's value is the segment's base (where it was placed) plus the label's offset within the segment. Segments may emit other segments, forming a tree rooted at `OUTPUT`; a circular `.emit`/`.emplace` is an error, as is placing an unknown segment. Place each labeled segment exactly once - placing it twice would give its labels two contradictory addresses.

**`.org expr` sets the run address, not the file position.** Spasm tracks two counters: the location counter `*` (the address code runs at, which labels resolve to) and the file offset (how many bytes have been written). `.org` jumps the location counter and writes nothing, so a file header can sit at file offset 0 with no run address while the code after `.org $2000` runs at `$2000` yet is stored right after the header. `.emplace` advances the location counter without advancing the file offset for the same reason.

Putting it together, an Atari XEX-style layout reads:

```
.segment "OUTPUT"
	.word $FFFF            ; binary-load signature (file bytes only)
	.word load_address
	.word chunk_end - 1

.org $80
	.emplace "ZEROPAGE"    ; zero-page variables: addresses, no file bytes

.org load_address
	.emit "CODE"           ; the load chunk: real file bytes
	.emit "RODATA"
	.emit "DATA"
chunk_end:
	.emplace "BSS"         ; BSS sits after the loaded image, no file bytes
```

In practice a layout script like this lives in a [format macro](#the-format-macro-pattern) so programs can apply it with one line.

Two scoping notes. Segments are **build-global, keyed by name**: a `.segment "CODE"` in one module and an `.emit "CODE"` in another meet in the same segment (this is what lets a format module place a program's code). Symbols, by contrast, stay module-scoped. And when several modules write to the same segment, their content accumulates in module load order - imported modules first, importers after, source order within each module. Each module starts collecting into `OUTPUT`; a `.segment` switch does not carry over from one module to the next.

## Modules

A source file is a module. Modules form a graph through imports, each module is loaded and evaluated once (a diamond does not duplicate), and import cycles are reported as errors. With the CLI, the module id is the file path and `.import` specifiers resolve like relative paths: `.import "./lib/atari/pia.s"`. Imports conventionally sit at the top of the file, though the loader accepts them anywhere at top level.

A module's symbols are **private by default**. `.export` publishes them, in several forms:

```
.export MAX = 100          ; define a constant and export it
.export EXIT := $0200      ; define a label and export it (attributes allowed)
.export start:             ; define a label here and export it
.export DOUBLE(v) = 2 * v  ; define an expression macro and export it
.export helper             ; export a name defined elsewhere in this module
.export .macro mva src, dest ; define a code macro and export it
	lda src
	sta dest
.endmacro
```

Bare `.export name` may appear any number of times and anywhere in the module; it is an error only if `name` is never defined at all. Exporting a [dictionary](#dictionaries) exports its entries.

Importing has two forms:

**Splat import** - `.import "m"` makes all of `m`'s exports resolvable by their bare names in the importing module:

```
.import "./lib.s"
	lda RAND        ; RAND is exported by lib.s
```

Name resolution checks the module's own symbols first, then its splat imports in source order (first import that exports the name wins).

**Namespaced import** - `name = .import "m"` binds the module's exports to a namespace instead. Values are reached with `::`, and exported macros are called through the same path:

```
pia = .import "./lib/atari/pia.s"

	lda pia::PORTA
	and #pia::JoystickBits::UP    ; paths chain into exported dictionaries

utils = .import "./utils.s"
	utils::memcpy dest, src, 8    ; statement position: an exported macro call
```

Nothing leaks into the bare namespace; the binding name itself is define-once, and bare `pia` is not a value - only `pia::something` is.

There is no global scope shared between modules. The idiomatic way to connect a program to an output format is the [format macro pattern](#the-format-macro-pattern): the only cross-module channels are exports, imports, and macro parameters.

## Macros

A macro is a named statement sequence, expanded at each call site before assembly begins:

```
.macro mva src, dest
	lda src
	sta dest
.endmacro

	mva #0, counter
```

Definitions are top-level only (not inside another macro body) and take a parameter list (the commas between parameters are optional). A call is written like an instruction: the macro's name in mnemonic position followed by operands.

**Arguments are whole operands, shape included.** The operand-list rule: a comma followed by a register name (`,x` / `,y`) binds to the preceding operand as its index suffix; any other comma separates operands. So this passes exactly two arguments, both indirect-indexed:

```
	mva (src),y, (dest),y
```

A _simple_ argument (a plain expression) can be used anywhere in the body, including inside larger expressions. A _shaped_ argument (immediate `#n`, indexed `addr,x`, indirect forms, accumulator) can only be used where the parameter stands alone as a whole operand (`lda src`); using it inside an expression is an error at expansion. (Passing an operand list to a real instruction instead of a macro is caught too: real mnemonics take at most one operand.)

**Expansion is hygienic.** Labels and symbols defined inside the body are renamed uniquely per expansion, so a macro used twice does not collide with itself:

```
.macro mprint str
	.rodata
message:                   ; a fresh, local `message` per expansion
	.byte str, 0
	.code
	lda #<message
	ldx #>message
	jsr print
.endmacro
```

Free names in the body (`print` above) resolve where the macro was **defined**, not where it is called - a macro can use its module's private helpers without exporting them, and the caller's symbols cannot capture the body's references. Parameters are the only inward channel.

**`.out` parameters are the outward channel.** A macro that defines a symbol _for the caller_ declares that parameter `.out`; the body's definition lands under the caller's chosen name, in the caller's scope:

```
.macro alloc_byte .out name
name:	.res 1
.endmacro

	alloc_byte counter     ; defines `counter` in the calling module
	inc counter
```

The contract is checked at the definition site for every macro, used or not: an `.out` parameter the body never defines is an error, and a body that defines a plain parameter is told to declare it `.out`. At the call site an `.out` argument must be a plain identifier. Forwarding an `.out` parameter into a nested call's `.out` position also counts as defining it.

Other rules:

- A label on the call line attaches to the first statement of the expansion.
- Macros may call macros, including recursively, up to a nesting depth of 64.
- `.import`, `.export`, and `.macro` are not allowed inside a body.
- Macros share the mnemonic namespace and are visible to the defining module plus (when exported with `.export .macro`) to its importers - by bare name through a splat import, or as `ns::name args` through a namespaced import (one level: `binding::macro`).

### The format macro pattern

Output formats are ordinary exported macros that script segment layout, taking the program's entry point (and anything else they need) as parameters. The Atari XEX format used by the samples:

```
; xex.s
.export .macro output_xex start, load
	.define_segment "CODE"
	.define_segment "RODATA"
	.define_segment "DATA"
	.define_segment "BSS"
	.define_segment "ZEROPAGE"

	.segment "OUTPUT"
		.word $FFFF
		.word load
		.word chunk_end - 1

	.org $80
		.emplace "ZEROPAGE"

	.org load
		.emit "CODE"
		.emit "RODATA"
		.emit "DATA"
chunk_end:
		.emplace "BSS"

		.word $02E0, $02E1   ; RUNAD chunk: run the program at `start`
		.word start
.endmacro
```

A program applies it with one call and then just fills the segments:

```
; game.s
.import "./xex.s"

output_xex start, $2000

.code
start:
	; ...
```

After expansion the format's `.word start` is an ordinary reference to the program's own label - no global scope needed.

## Expression macros

An expression macro is a pure, named, parameterized expression - the value-level counterpart of a code macro:

```
DOUBLE(v) = 2 * v

	lda #DOUBLE(2)        ; assembles as lda #4
```

They live in the symbol namespace: the parameter list on the left-hand side is what makes the definition a function rather than a constant, so `FOO` and `FOO(v)` cannot coexist. Application is any identifier (or `::` path) hugging a parenthesized argument list; argument count must match.

Semantics:

- Arguments are evaluated eagerly, in the caller's scope; the body's other names resolve in the defining module (same hygiene as code macros). Parameters shadow outer names within the body.
- The value is a first-class _function value_: `D = DOUBLE` aliases it, `.export DOUBLE(v) = 2 * v` exports it, and it travels through namespaced imports (`lib::DOUBLE(2)`). But a function is not data - using one as an operand, a `.byte` value, or an attribute value is an error, and functions are omitted from the assembled result's symbol map.
- Application nesting (including recursion) is capped at depth 64. Since there is no lazy conditional in the expression language yet, recursion has no usable base case - treat the cap as a safety net rather than a feature.

## Dictionaries

A dictionary groups named constants under one symbol:

```
JoystickBits = {
	UP: 1
	DOWN: 2
	LEFT: 4
	RIGHT: 8
}

	lda #JoystickBits::UP | JoystickBits::LEFT
```

Entries are `key: value` pairs separated by commas or newlines (a trailing comma is fine). Values are arbitrary expressions, evaluated with the same forward-reference power as any constant - later entries may reference earlier ones, or other symbols entirely. Entries can themselves be dictionaries, accessed by chaining: `Config::Video::HEIGHT`.

Dictionaries are values, with restrictions that keep them static:

- A dictionary literal may only appear as the entire right-hand side of a `=` definition (a dictionary is a value, not an address, so `:=` rejects it, and it cannot be nested inside a larger expression).
- They are immutable and statically keyed: every entry exists from the definition, and an unknown key is an error at the access site.
- Keys are ordinary identifiers, which means the reserved register names `a`, `x`, `y` cannot be keys (write `A4`, not `A`).
- `.export Name = { ... }` exports the dictionary and with it every entry.

Under the hood each entry is an ordinary constant under a qualified name, which is why forward references, define-once, and export all behave exactly as they do for plain symbols.

## Symbol attributes

Labels can carry placement metadata that the assembler tracks but never interprets - it is surfaced back to tooling (debuggers, emulators) and readable in source. The one attribute so far is `size`, the number of bytes the symbol covers.

Attributes are written as a keyword tail on `:=` definitions:

```
.export PIA_AREA := $D300, size: 256   ; a whole register area
.export NMIVEC := $FFFA, size: 2       ; a vector
.export PORTA := $D300                 ; defaults to size: 1
```

The value is an ordinary expression (forward references allowed), must be a non-negative number, and may be given only once. Defaults: a `:=` definition covers 1 byte unless declared; a positional `label:` has size 0. Only labels have attributes - a constant is a pure number, so `FOO = 5, size: 2` is an error, and the positional `label:` form takes no tail (write the full `name := *, size: n` when you need one).

Attributes are read with builtins:

```
	ldx #.sizeof(NMIVEC)              ; 2
	ldx #.attributes(NMIVEC)::size    ; the same, spelled out
AREA_END = PIA_AREA + .sizeof(PIA_AREA)
```

`.attributes(SYM)` evaluates to the symbol's attribute dictionary and `.sizeof(SYM)` is shorthand for its `size` entry. Both require their argument to be a label (constants and functions have no attributes) and accept `::` paths (`.sizeof(lib::NMIVEC)`). Unknown attribute keys are errors on both the write and the read side. Attributes travel with the symbol through `.export` and namespaced imports.

## The multipass model

You normally don't need to think about the multipass engine, but it explains what converges, when errors are reported, and the one warning it can emit.

A 6502 program cannot be assembled in one linear pass: `lda foo` is 2 bytes if `foo` is in zero page and 3 if not, but `foo`'s address depends on the sizes of everything before it. Spasm iterates instead: each pass assembles everything against the values the previous pass produced, and assembly stops when a pass changes nothing - neither any symbol nor any output byte.

Two properties make this well-behaved:

- **Pessimistic, shrink-only sizing.** An operand whose value is unknown is sized at its largest (absolute); once the value is known it can only shrink (to zero page). Sizes never oscillate, and every intermediate state is a valid program.
- **Final-pass diagnostics.** Errors that depend on values still in flux (an undefined symbol that is really just a forward reference, a range check against an address that hasn't settled) would fire spuriously mid-iteration, so only the diagnostics of the final, converged pass are reported.

If the pass cap is hit without convergence (rare - it requires pathological layouts), spasm emits a **warning** and the last pass's output, which is valid but may use larger encodings than necessary.

## Directive reference

| Directive                                    | Section                                                   |
| -------------------------------------------- | --------------------------------------------------------- |
| `.byte values...`                            | [Data and fill directives](#data-and-fill-directives)     |
| `.word values...`                            | [Data and fill directives](#data-and-fill-directives)     |
| `.res count`                                 | [Data and fill directives](#data-and-fill-directives)     |
| `.org address`                               | [Segments and output layout](#segments-and-output-layout) |
| `.segment "NAME"`                            | [Segments and output layout](#segments-and-output-layout) |
| `.define_segment "NAME"`                     | [Segments and output layout](#segments-and-output-layout) |
| `.code` `.rodata` `.data` `.bss` `.zeropage` | [Segments and output layout](#segments-and-output-layout) |
| `.emit "NAME"`                               | [Segments and output layout](#segments-and-output-layout) |
| `.emplace "NAME"`                            | [Segments and output layout](#segments-and-output-layout) |
| `.import "spec"` / `name = .import "spec"`   | [Modules](#modules)                                       |
| `.export ...`                                | [Modules](#modules)                                       |
| `.macro name params` ... `.endmacro`         | [Macros](#macros)                                         |
| `.out` (parameter marker)                    | [Macros](#macros)                                         |
| `.attributes(SYM)` / `.sizeof(SYM)`          | [Symbol attributes](#symbol-attributes)                   |

## Not yet implemented

Spasm's syntax is still evolving. Notable planned constructs that do **not** exist yet, so you aren't left wondering:

- Conditional assembly (`.if`/`.else`/`.endif` and a static `#if` family) and `.error`.
- Binary literals (`%1010`).
- Backtick-quoted symbol names (for names that collide with `a`/`x`/`y` or aren't valid identifiers).
- `@local` labels (macro-body hygiene covers the common case today).
- Operand size assertions (`lda .word addr` to force absolute).
- Segment attributes on `.define_segment` (`kind:`, `executable:`) and relocation (`.reloc`, `.startof`, `.endof`).
- Keyword arguments and parameter defaults for macros, and operand introspection (`.mode()`, `.value()`).
- Named/aliased import forms (`.import "m": a, b`) and inline `.namespace` blocks.
- Target-specific string encodings (ATASCII, screen codes) - strings are UTF-8 passthrough for now.

The dotted-keyword vocabulary is reserved as a whole: spelling any `.word`-like token that isn't a current directive is an error, so future directives cannot collide with your symbols.
