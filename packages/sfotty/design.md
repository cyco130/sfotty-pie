# How `@sfotty-pie/sfotty` works

Notes on the internals of the CPU core, for contributors and AI agents. This is the package-scoped peer of the repo-wide [CONTRIBUTING.md](../../CONTRIBUTING.md): the readme is for _users_ of the library; this file is for people working _on_ it. It explains the approach and the moving parts; the per-token and per-method details live in doc comments next to the code.

## What it is

Sfotty is a cycle-accurate NMOS 6502 core. It implements all 256 opcodes — including the undocumented ones and the unstable "magic" ones — and is exercised against Tom Harte's per-cycle reference vectors (see [Correctness](#correctness-the-harte-suite)). It models the 6502 used by the Atari 8-bit machines and, via options, the Ricoh 2A03 (NES) decimal behavior.

The core does **not** own memory, interrupts, or a clock. The host drives it one cycle at a time and supplies a bus. Everything else — RAM, I/O chips, cartridge mapping, IRQ/NMI lines — lives outside.

## The big idea: microcode as data

A real 6502 executes each instruction as a sequence of cycles, and each cycle does exactly one bus access (a read or a write) plus some internal register shuffling. Sfotty mirrors that literally:

1. Every instruction is described as **data** — a list of cycles, each cycle a list of tokens — in [src/nmos.ts](src/nmos.ts). The first token of a cycle is its single bus operation; the rest are internal register transfers. This is the "microcode DSL."
2. A build step, [src/generate-step.ts](src/generate-step.ts), **compiles** that data into [src/nmos-step.ts](src/nmos-step.ts): one tiny function per `(opcode, cycle)` plus a flat dispatch table, `MICROCODE`.
3. Each token maps to a method on the `Sfotty` class (the `opXxx` methods in [src/sfotty.ts](src/sfotty.ts)). Those methods are the CPU's actual behavior; the generated functions just call them in order and pick the next cycle.

So the data in `nmos.ts` is the source of truth, the methods in `sfotty.ts` are the verbs, and `nmos-step.ts` is the generated glue that wires them together into a dispatch table. Two of these files are generated and committed (`nmos.ts`, `nmos-step.ts`); see [The code-generation pipeline](#the-code-generation-pipeline).

## Public API surface

Everything exported lives in [src/index.ts](src/index.ts):

- `Sfotty` — the CPU. Construct with a `Memory` bus and optional `SfottyOptions`.
- `Memory`, `ReadOptions` — the bus contract (see [Memory, reads, and traps](#memory-reads-and-traps)).
- `DECODE` — the sentinel microstate for the opcode-fetch cycle.
- `disassemble`, `traceLine`, `Disassembly`, `PeekReader` — the disassembler in [src/disasm.ts](src/disasm.ts), used for tracing and debugging.

Programmer-visible registers (`A`, `X`, `Y`, `S`, `PC`) and the discrete status flags (`cFlag`, `zFlag`, …) are public fields on `Sfotty`; `getP()`/`setP()` pack and unpack them into a status byte. The host can seed these directly, or call `reset(cold)` to run the reset sequence (see [The reset sequence](#the-reset-sequence)). The input lines `RDY`, `IRQ`, and `NMI` are public booleans the host drives between `run()` calls (see [The RDY line](#the-rdy-line) and [Interrupts](#interrupts)).

## The execution model: one cycle per `run()`

`Sfotty.run()` advances the CPU by exactly one clock cycle, which is exactly one bus access. Its whole body is:

```ts
run(): void {
	this.#microcode[this.state]!(this);
}
```

`state` is the current microstate; `#microcode[state]` is a `Step` function; calling it performs this cycle's bus op, applies its register transfers, and writes the next `state`. There is no "execute a whole instruction" entry point — the host loops `run()` and counts cycles. This is what makes the core cycle-accurate: an interrupt, a DMA steal, or a trap can land between any two cycles.

## Microstates and the dispatch table

A microstate is encoded as `(opcode << 3) | cycle`:

- `opcode` (8 bits) selects the instruction.
- `cycle` (3 bits) is the 0-based index into that instruction's `code[]` array, i.e. the cycle _after_ the opcode fetch. 3 bits is enough because no 6502 instruction has more than 7 post-fetch cycles.

One special state sits above all of these: `DECODE` (`0x800`), the shared opcode-fetch cycle. `Sfotty` starts in `DECODE`, so the first `run()` fetches an opcode. `decode()` reads the byte at `PC` (asserting `OPCODE_FETCH`), bumps `PC`, and sets `state = opcode << 3` — landing on cycle 0 of that opcode's microcode.

`MICROCODE` (in [src/nmos-step.ts](src/nmos-step.ts)) is a single flat array indexed by microstate. It is generated as a positional literal: each opcode owns a block of 8 slots, with cycles past the instruction's length filled by `badState` (which throws — reaching one is a bug), and `decode` in the final slot at index `0x800`. Because every slot is filled, V8 keeps it a fast packed array.

### Cycle numbering

In the generated names, `decode` is **cycle 0**, so `code[i]` is cycle `i + 1`. For example BNE's `code[0]` is `bne_rel_1`. The state encoding still indexes by the raw `code[]` position (`code[0]` → `(opcode << 3) | 0`); only the human-facing name is shifted by one so the fetch counts as cycle 0.

## Anatomy of a step function

Take `ORA ($zp,X)` (opcode `0x01`), whose data in `nmos.ts` is:

```ts
code: [
  ["r-pc++", "ar=dr"], // cycle 1: read zp pointer, AR = pointer
  ["r-ar", "ar+=x", "dr=al"], // cycle 2: dummy read, add X, stash low
  ["r-dr++"], // cycle 3: read effective-address low
  ["r-dr"], // cycle 4: read effective-address high
  ["r-ar", "ro-ora"], // cycle 5: read operand, ORA into A
];
```

The first token of each cycle is the bus op; the rest are internal ops. The generator turns cycle 2 into:

```ts
function ora_inx_2(cpu: Sfotty): void {
  cpu.opReadAddr(); // r-ar  (the single bus access)
  cpu.opAddX(); // ar+=x
  cpu.opDrFromAl(); // dr=al
  cpu.state++; // advance to cycle 3
}
```

The last cycle ends with `cpu.state = DECODE` instead of `state++`, returning to the fetch. Note the **bus access is always the first statement**, and the `state` write is always last — this is what makes traps safe (below).

## Micro-ops: the CPU's internal verbs

Each token corresponds to one `opXxx` method on `Sfotty`, mapped by the `TOKEN_METHOD` / `COND` tables in [src/generate-step.ts](src/generate-step.ts). They fall into two kinds:

- **Bus ops** (the first token of a cycle): `r-pc++`, `r-ar`, `w-ar`, … — perform the read or write, then bump any pointers _after_ the access returns.
- **Internal ops** (the rest): address-latch math (`ar=dr`, `ar+=x`, `ah++`), loads/stores (`a=dr`, `dr=a`), ALU (`ro-adc`, `mo-asl`), flags (`cf=1`), stack/PC plumbing (`dr=pch`, `pcl=dr`), transfers (`x=a`), etc.

Internal state beyond the visible registers lives in private latches on `Sfotty`: `#dr` (data latch, doubling as the zero-page pointer for indirect modes), `#al`/`#ah` (the effective-address latch `AR = AH:AL`), `#crossed` (page-boundary flag), `#offset` and `#branchFixup` (branch plumbing). Reading through the `opXxx` methods top to bottom in [src/sfotty.ts](src/sfotty.ts) is the fastest way to learn the ISA's mechanics; each carries a one-line doc comment naming its token.

## Memory, reads, and traps

The host implements `Memory` ([src/interface.ts](src/interface.ts)):

```ts
read(address: number, options: ReadOptions): number;
write(address: number, value: number): void;
```

`ReadOptions` is a bit-flag set (a `const` object, not an `enum` — enums emit runtime code this repo's no-transpile model rejects): `PEEK` for side-effect-free inspection (disassembler/debugger), `OPCODE_FETCH` for the SYNC-line fetch cycle, `DMA` for accesses driven by another chip.

The package has no built-in trap type. A host interrupts the CPU — for memory-mapped I/O, execute traps, or breakpoints — by **throwing its own sentinel** from `read`/`write`. It works because of the ordering invariant in every step function: the bus access happens _first_, before any register is mutated, and the `state` write happens _last_. So a throw mid-cycle unwinds with the CPU still in its exact pre-cycle state; the host catches it around `run()`, reacts, and simply re-`run()`s to retry the same cycle. The sentinel needs no payload — the host sources the address and access kind from its own bus (or from CPU state, e.g. `PC` at an execute trap).

## The RDY line

The `RDY` input (a public boolean on `Sfotty`, default `true`) models the NMOS ready line. The host pulls it low to stall the CPU — on the Atari this is the `WSYNC` strobe, which syncs the CPU to the start of a scanline. (DMA cycle-stealing is a _separate_ mechanism, ANTIC's `HALT`, not `RDY`.) Two NMOS quirks define the behavior: only **read** cycles honor `RDY` (writes complete regardless), and a halted CPU keeps its address parked and **re-reads** every cycle, consuming the byte present on the cycle `RDY` finally rises.

This is encoded in the bus-read micro-ops themselves. Each read op issues its read through the `#read` choke point, then checks `RDY`: if low it returns `false` _without_ mutating any register or latch; otherwise it commits (stores `DR`, bumps pointers) and returns `true`. The read happens before the `RDY` check, so the bus still sees the read every stalled cycle. The generator emits the bus op of a read cycle as `if (!cpu.opReadX()) return;`, so a stalled read bails before any internal op runs and before `state` advances — the next `run()` re-enters the same step and re-reads, until `RDY` rises and the cycle completes (its read being the consumed one). Write ops (`opWriteAddr`/`opWriteAddrDec`) never consult `RDY` and return void, so write cycles always finish. `opReadDecode` is the one read that owns its own `state` transition, so it returns `false` on a stall and simply doesn't advance.

An earlier design threw a `NOT_READY` symbol from `#read` and caught it in `run()`, reusing the trap-unwind invariant. It was correct but ~15× slower per stalled cycle (a `WSYNC` kernel stalls most of every scanline), so the boolean short-circuit replaced it; stalled cycles now cost about the same as running ones. The stall path is covered by [src/sfotty.test.ts](src/sfotty.test.ts).

## The reset sequence

`reset(cold)` emulates the `RES` line. It doesn't set the post-reset registers directly — it launches a real seven-cycle sequence (states `RESET`..`RESET + 6`, reserved above `DECODE`), so the next seven `run()`s carry out the reset and land back at `DECODE`. The cycles: two dummy reads, three fake stack "pushes" done as **reads** with `S--` each, then the reset vector at `$FFFC`/`$FFFD` read into `PC` with `I` set. Starting from `S = 0` (a cold reset), the three decrements leave `S = $FD`, the familiar power-on value. The reads honor `RDY` like any other, so a stalled reset just re-reads.

It is a _dedicated_ sequence rather than a BRK variant: BRK would need runtime conditionals for write-suppression and the `$FFFC` vector, whereas the reset steps (hand-written in `generate-step.ts` like the `decode` wrapper, since reset isn't an opcode) just do the right thing. `cold` additionally clears the registers, flags, and internal latches to a known state before the sequence; a warm reset leaves them (so `S` is decremented from its current value and `D` is untouched, matching NMOS). Either way it clears a CIM crash. Nothing arms reset automatically — the host calls it; the Harte harness instead seeds registers directly and never resets.

## Interrupts

The host drives two input lines, public booleans on `Sfotty` in positive logic (`true` = asserted): `IRQ` (level-sensitive, honored while the I flag is clear) and `NMI` (edge-triggered). Multiple sources must be wired-OR'd by the host into each single boolean.

Recognition is a three-stage pipeline with a deliberate one-cycle delay, so an interrupt is taken based on the line state **two cycles before** the decode that services it — matching the hardware, where the poll reads edge/level detectors that lag the pins by half a cycle (we round that up to a whole cycle, since we don't model φ1/φ2):

1. **Detect** — at the _end_ of every `run()`, `#nmiPending` latches on a false→true `NMI` edge (`#nmiPrev` tracks the line), and `#interruptDetected = #nmiPending || (IRQ && !iFlag)` is recomputed. Because this runs after the step, anything reading `#interruptDetected` during a step sees the _previous_ cycle's value — that's the one-cycle delay, for free.
2. **Poll** — `opPoll` latches `#interruptDetected` into `#interruptPending`. The generator injects it (as a synthetic `poll` token) on every cycle that can end an instruction — terminal cycles, a branch's `cond?` cycle, an indexed read's `?` cycle — **except** BRK (the sequence never polls) and a taken branch's `pc+=dr?` (PCL-add) cycle. It sits right after the bus op, before any I-flag write, and overwrites rather than accumulates (so a later poll in the same instruction, e.g. a branch's fix-up cycle, wins).
3. **Recognize** — `decode` (`opReadDecode`) checks `#interruptPending`. If set it does a dummy opcode fetch (PC _not_ advanced), clears the flag, sets `bFlag = false`, and forces `state = 0` — the BRK microcode — instead of dispatching the fetched opcode.

The IRQ/NMI sequence is the **BRK microcode reused** (RESET is separate — see above). Three pieces specialize it without runtime branching into separate states:

- **`bFlag`** is the B flag (it isn't a real register bit; `getP` derives bit 4 from it). `decode` sets it `true` on a normal fetch, `false` when forcing an interrupt — so BRK/PHP push B=1 while a hardware interrupt pushes B=0.
- **`r-brk`** (BRK's code[0] read) advances PC only when `bFlag` is set, so a software BRK skips its signature byte (pushing PC+2) while a hardware interrupt leaves PC put (pushing the interrupted address).
- **`ar=vector`** (`opAddrVector`, at the push-P cycle) picks the vector: if `#nmiPending` is latched it takes `$FFFA` and acknowledges the NMI (clears the latch); otherwise `$FFFE`. Since the vector-fetch cycles just read that address, this _is_ the hijack — an NMI latched early enough steals a BRK/IRQ sequence's vector (and a hijacked BRK still pushes B=1). Finally `nmi-hold` (`opNmiHold`, the sequence's last cycle) drops a still-pending NMI whose line has since gone inactive; it only clears, never sets, so it can't resurrect an already-consumed NMI — that's the "lost if too short, caught if held" boundary.

What falls out, with no per-instruction special-casing: the two-cycles-before timing; the one-instruction `CLI`/`SEI`/`PLP` delay (the poll reads the pre-write I via `#interruptDetected`) versus immediate `RTI` (which writes I mid-sequence); the taken-non-crossing-branch delay (that cycle doesn't poll); NMI hijacking; and a too-short NMI at the push-P cycle being lost. These behaviors are tested in [src/interrupts.test.ts](src/interrupts.test.ts) (stack-frame and landing-vector observables); none are covered by Harte (no async IRQ/NMI in those vectors).

**Deferred / approximate.** We're cycle-exact, not φ-exact, so the _precise_ hijack window and the exact lost/caught boundary are modeled to a whole-cycle grid and still want confirmation against a Visual6502 trace.

## Relative state transitions (and why dedup falls out)

Step functions never bake the opcode into their next-state. Advancing a cycle is `cpu.state++` (since `cycle` never overflows its 3 bits), the page-cross skip is `cpu.state += 2`, terminal cycles set `cpu.state = DECODE`, and a crash leaves `state` untouched (so it repeats forever). Because the transition is relative, a step's body depends only on its microcode shape, not on which opcode it belongs to.

That makes most steps **opcode-independent and identical across opcodes that share an addressing-mode shape**, so the generator emits each distinct body once and points every matching `MICROCODE` slot at it (e.g. all twelve CIM opcodes share `cim_imp_1`). If two opcodes ever genuinely diverged in microcode under the same `mnemonic_mode_cycle` name, the generator would disambiguate by re-adding the opcode to the name (`cim02_imp_1`); today nothing triggers that, but it guards against silently emitting two different bodies under one name.

## Branches and page crossing

Two situations need a step to choose its successor at runtime rather than always falling through:

- **Indexed reads that may cross a page** use the `?` token. The speculative read is issued; if `#crossed`, the step takes the re-read cycle (`state++`); otherwise the value is already valid, so it finishes early (`state += 2`), skipping the fix-up cycle.
- **Branches** evaluate their condition (`cc?`, `ne?`, …) and, if not taken, jump straight to `DECODE`. If taken, `pc+=dr?` adds the signed offset to `PCL`; only on a page cross is the extra PCH-fix cycle (`pch=fix`) taken. The offset is stashed before the next fetch overwrites `DR`.

The generator special-cases these tokens in `emitBody`; the rest of a cycle is a straight sequence of `opXxx` calls.

## CPU variants

`SfottyOptions` selects hardware variants:

- `withoutDecimal` — the D flag still exists but ADC/SBC stay binary, matching the Ricoh 2A03 (NES). Decimal-mode logic in `opAdc`/`opSbc`/`opArr` is gated on this.
- `withoutUndocumented` (default **on**) — undocumented opcodes crash like CIM instead of executing. This is implemented by `MICROCODE_CRASH_UNDOCUMENTED`, a copy of `MICROCODE` with each undocumented opcode's first slot patched to `crashStep`. `decode` still records the opcode in `state`, so a crash is attributable.

The NMOS decimal-mode flag quirks and the unstable opcodes (the `ANE`/`LXA` "magic constant", the `SHA`/`SHX`/`SHY`/`SHS` high-byte corruption) are subtle; the relevant methods in [src/sfotty.ts](src/sfotty.ts) document the specific choices and their Harte vector counts.

## The code-generation pipeline

Two generators produce two committed files. Regenerate after editing a generator:

- [src/generate.ts](src/generate.ts) → [src/nmos-opcodes.ts](src/nmos-opcodes.ts) and [src/nmos.ts](src/nmos.ts). `pnpm --filter @sfotty-pie/sfotty generate:opcodes`. This is where the per-instruction microcode (the `code[]` arrays) is authored/derived.
- [src/generate-step.ts](src/generate-step.ts) → [src/nmos-step.ts](src/nmos-step.ts). `pnpm --filter @sfotty-pie/sfotty generate:step`. Compiles the microcode data into step functions and the `MICROCODE` table. It also **validates** that every token is known, throwing with the offending opcode/cycle/token if `nmos.ts` ever references one the emitter doesn't handle.

The generated files carry a "do not edit by hand" header. Treat `nmos.ts` as the place to change behavior and `nmos-step.ts` as pure output.

## Correctness: the Harte suite

The backbone is [src/single-step-test.ts](src/single-step-test.ts), run with `pnpm --filter @sfotty-pie/sfotty harte` (alias `harte`). It runs the [SingleStepTests/65x02](https://github.com/SingleStepTests/65x02) vectors — 10,000 randomized cases per opcode — and checks final registers, every touched RAM byte, **and per-cycle bus activity** (address + read/write for each cycle). It tests all 256 opcodes by default; pass hex opcodes to narrow it (`harte a9 a5`). Vector files are fetched on demand into `external.local/` (gitignored). A passing `harte` run is the bar for any change to the core or the microcode.

The repo-level `pnpm test` (vitest + typecheck + lint + publint) is separate and lighter; it does not pull the Harte vectors.

## File map

| File                                               | Role                                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [src/sfotty.ts](src/sfotty.ts)                     | The `Sfotty` class: registers, latches, `run()`, `decode()`, and every `opXxx` micro-op. The ISA's behavior.   |
| [src/microcode.ts](src/microcode.ts)               | Core types (`Step`, `Instruction`, `BusOp`, `InternalOp`) and the `DECODE` constant. The microcode vocabulary. |
| [src/nmos.ts](src/nmos.ts)                         | _Generated._ The 256 instructions as microcode data (`NMOS_INSTRUCTIONS`).                                     |
| [src/nmos-step.ts](src/nmos-step.ts)               | _Generated._ Step functions and the `MICROCODE` dispatch table.                                                |
| [src/generate-step.ts](src/generate-step.ts)       | Compiles `nmos.ts` → `nmos-step.ts`; token→method mapping and `emitBody`.                                      |
| [src/generate.ts](src/generate.ts)                 | Generates `nmos-opcodes.ts` and `nmos.ts`.                                                                     |
| [src/interface.ts](src/interface.ts)               | The `Memory` bus contract and `ReadOptions`.                                                                   |
| [src/disasm.ts](src/disasm.ts)                     | Disassembler and trace formatting (`disassemble`, `traceLine`).                                                |
| [src/single-step-test.ts](src/single-step-test.ts) | The Harte cycle-exact test runner.                                                                             |
