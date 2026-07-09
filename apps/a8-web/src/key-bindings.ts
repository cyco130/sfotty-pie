import type { Command } from "./commands.ts";
import { messages } from "./messages.ts";

// The keyboard binding table: every discrete Atari key / device action as data,
// keyed by trigger and resolved by `resolveBinding`. keyboard.ts drives input
// through it; layout-aware typing (Character mode) is the separate character
// channel in char-keys.ts.
//
// Structured as a platform-agnostic `base` plus per-platform overlays merged in
// to form the effective defaults (see `defaultBindingSet`). Every binding is one
// (key + modifiers) -> one fixed command; no folding. Modifiers are exact (must be
// up unless stated) except device inputs, which are Shift-agnostic (see `Mod`).
// One flat set serves both keyboard modes: in Character mode the character
// channel resolves first and shadows the bare/Shift character keys (so typing is
// layout-aware), then falls through to these bindings - see keyboard.ts.

/**
 * A modifier's required state. Default (absent) = must be UP; `true` = must be
 * DOWN; `"any"` = don't care. `"any"` is for device inputs (console buttons,
 * joystick, the Shift keys themselves) that fire regardless of Shift - because
 * Shift is a separate Atari line that combines at the machine level (its own
 * binding fires too), e.g. Shift+Option is a real, distinct input. Matrix/named
 * keys stay exact, where Shift/Ctrl pick the keycode variant.
 */
type Mod = boolean | "any";

/** Character mode = layout-aware typing (the character channel owns the
 *  character keys); Positional mode = the raw `code`->Atari keyboard. */
export type KeyboardMode = "character" | "positional";

export interface Binding {
	// The trigger: the physical key by `code` (layout-independent). A future
	// gamepad trigger would be a separate Binding variant, not part of `on`.
	on: string;
	// Intentional modifiers (see {@link Mod}). `alt` is the Alt/Option "Mod"
	// layer, `meta` is Cmd. Locks (Caps/Num) never matched.
	shift?: Mod;
	ctrl?: Mod;
	alt?: Mod;
	meta?: Mod;
	// Pressed on key-down; released on key-up when the command has a release half
	// (a sustained control), else instant - so a held binding is one entry.
	command: Command;
	// Where this binding resolves. "global" -> the window-level resolver dispatches
	// it regardless of focus (app commands like OPEN_PALETTE); absent/"a8" -> only
	// when the emulator input is focused (machine keys). A coarse first cut of a
	// per-binding context - it'll grow into a `when` predicate once a second axis
	// (e.g. typing/gaming) lands.
	scope?: "global" | "a8";
	// Generation hint (default bindings only), resolved away at bake (see
	// `bakeDefaults`) via getLayoutMap and never persisted. Both modes re-home `on`
	// to the physical key that *produces* the chord's letter (falling back to the
	// QWERTY position when layout data is absent):
	//   "letter" - an app shortcut that follows the letter; the command is kept
	//              (Cmd+K opens the palette on the K key, wherever that is).
	//   "ctrl"   - a positional Alt-for-Ctrl alias; the command is re-taken from
	//              the Atari Ctrl key at the *new* physical position, so on Turkish-F
	//              Alt+N (N sits on KeyI) yields Atari Ctrl+I, not Ctrl+N.
	anchor?: "letter" | "ctrl";
	// When a command has several bindings, the one to represent it (the chord
	// shown in the palette, menu, and key-help). Set on the platform-preferred
	// default by {@link markPrimaries}, or by the user ("Make primary"). At most
	// one per command; absent => the resolver falls back to first-listed.
	primary?: boolean;
	note?: string;
}

/**
 * The Atari matrix bases a binding can target - expanded to `PRESS_<base>` and
 * its `CONTROL_`/`SHIFT_`/`CONTROL_SHIFT_` variants by {@link modVariants}.
 * Covers the positional layer's character keys plus the named Atari keys.
 */
type MatrixBase =
	| "A"
	| "B"
	| "C"
	| "D"
	| "E"
	| "F"
	| "G"
	| "H"
	| "I"
	| "J"
	| "K"
	| "L"
	| "M"
	| "N"
	| "O"
	| "P"
	| "Q"
	| "R"
	| "S"
	| "T"
	| "U"
	| "V"
	| "W"
	| "X"
	| "Y"
	| "Z"
	| "0"
	| "1"
	| "2"
	| "3"
	| "4"
	| "5"
	| "6"
	| "7"
	| "8"
	| "9"
	| "ESC"
	| "LESS_THAN"
	| "GREATER_THAN"
	| "MINUS"
	| "EQUALS"
	| "SEMICOLON"
	| "PLUS"
	| "ASTERISK"
	| "COMMA"
	| "PERIOD"
	| "SLASH"
	| "HELP"
	| "INVERSE_VIDEO"
	| "CAPS"
	| "TAB"
	| "RETURN"
	| "BACKSPACE"
	| "SPACE"
	| "F1"
	| "F2"
	| "F3"
	| "F4";

// Bases whose Ctrl+Shift press can't be scanned on real hardware (base scan code
// $00-$07 / $10-$17), so it does nothing - its `CONTROL_SHIFT` binding is omitted
// (a no-op binding is pointless; the keystroke is left to fall through to nothing).
const DEAD_CTRL_SHIFT: ReadonlySet<MatrixBase> = new Set<MatrixBase>([
	"L",
	"J",
	"SEMICOLON",
	"F1",
	"F2",
	"K",
	"PLUS",
	"ASTERISK",
	"V",
	"HELP",
	"C",
	"F3",
	"F4",
	"B",
	"X",
	"Z",
]);

// A matrix key reached by `on`, expanded to its exact-modifier bindings: plain /
// Shift / Ctrl / Ctrl+Shift -> PRESS_[CONTROL_][SHIFT_]<base>. `extra` carries a
// held base modifier onto all of them (e.g. Option for the mac F1-F4). The
// Ctrl+Shift variant is dropped for bases that can't be scanned (see above).
function modVariants(
	on: string,
	base: MatrixBase,
	extra: Partial<Pick<Binding, "shift" | "ctrl" | "alt" | "meta">> = {},
): Binding[] {
	const out: Binding[] = [
		{ on, ...extra, command: `PRESS_${base}` },
		{ on, ...extra, shift: true, command: `PRESS_SHIFT_${base}` },
		{ on, ...extra, ctrl: true, command: `PRESS_CONTROL_${base}` },
	];
	if (!DEAD_CTRL_SHIFT.has(base)) {
		out.push({
			on,
			...extra,
			ctrl: true,
			shift: true,
			command: `PRESS_CONTROL_SHIFT_${base}`,
		});
	}
	return out;
}

// A 1200XL function key (F1-F4) reached by a host navigation key whose
// unmodified meaning matches the Atari Shift+Fn (PgUp = top-left = Shift+F1, Home
// = line-start = Shift+F3, ...). So host Shift is INVERTED - plain -> Shift+Fn,
// Shift -> plain Fn - while Ctrl stays direct.
function navKey(on: string, base: "F1" | "F2" | "F3" | "F4"): Binding[] {
	// F1-F4's Ctrl+Shift can't be scanned on real hardware, so there's no
	// Ctrl+Shift variant here.
	return [
		{ on, command: `PRESS_SHIFT_${base}` },
		{ on, shift: true, command: `PRESS_${base}` },
		{ on, ctrl: true, command: `PRESS_CONTROL_${base}` },
	];
}

// A Windows/Linux alternate for a browser-grabbed Ctrl combo: Alt+<code> -> the
// Atari Ctrl+<base> (and Alt+Shift -> Ctrl+Shift when `shift`). Bound only for the
// keys the browser actually eats, so every other Alt+letter stays free for app
// commands.
function altCtrl(code: string, base: MatrixBase, shift = true): Binding[] {
	// Letter aliases anchor to the produced letter's key, then take the Atari Ctrl
	// key at that physical position (the browser grabs host Ctrl+letter by the
	// produced letter, so that's the position it shadows). Digit aliases stay
	// positional - digit VKs are position-fixed, grabbed by position regardless.
	const anchor = /^[A-Z]$/.test(base) ? ({ anchor: "ctrl" } as const) : {};
	const out: Binding[] = [
		{ on: code, alt: true, command: `PRESS_CONTROL_${base}`, ...anchor },
	];
	if (shift && !DEAD_CTRL_SHIFT.has(base)) {
		out.push({
			on: code,
			alt: true,
			shift: true,
			command: `PRESS_CONTROL_SHIFT_${base}`,
			...anchor,
		});
	}
	return out;
}

// Platform-agnostic bindings. (Every F-key is additionally claimed at
// window+capture - the browser-shortcut guard - assumed for the F-keys here.)
const base: Binding[] = [
	// Console buttons (held). Shift- and Ctrl-agnostic: they're a separate CONSOL
	// line, so no host modifier suppresses them (Shift+Option is a real combo -
	// the Shift key's own binding fires alongside).
	{ on: "F2", shift: "any", ctrl: "any", command: "PRESS_OPTION" },
	{ on: "F3", shift: "any", ctrl: "any", command: "PRESS_SELECT" },
	{ on: "F4", shift: "any", ctrl: "any", command: "PRESS_START" },

	// Reset (held, Shift-agnostic -> Shift+Reset works); Ctrl+F5 cold-boots. Ctrl
	// is exact, so it cleanly splits Reset from Power-cycle with no overlap.
	{ on: "F5", shift: "any", command: "PRESS_RESET" },
	{ on: "F5", ctrl: true, shift: "any", command: "POWER_CYCLE" },

	// Break - no release (a key-up isn't observable), so instant. On F8: its one
	// reachability gap is Ctrl+F8 (Mac Safari), which Break never uses.
	{ on: "F8", command: "PRESS_BREAK" },
	{ on: "Pause", command: "PRESS_BREAK" },

	// Named Atari keys - each with all four Ctrl/Shift variants. Caps/Tab/Esc/
	// Inverse have no natural F-key home, so they take F-keys the browser leaves
	// alone (F7/F9/F10/F11); Esc and Tab keep their own keys too, the F-key adding
	// the reliable Ctrl/Shift combos - notably Ctrl+F9 -> Atari Ctrl+Tab, which the
	// real Ctrl+Tab can't reach.
	...modVariants("F7", "CAPS"),
	...modVariants("F9", "TAB"),
	// Help's natural home is F1 - F2-F5 are the console keys (Option/Select/Start/
	// Reset), so F1 extends that row as on the XE. Plain F-keys are preventable, so
	// F1 carries Help and Shift+F1 covers Shift+Help.
	...modVariants("F1", "HELP"),
	// Inverse video on F10. Windows can't intercept Shift+F10 (context menu), so
	// Shift+Inverse is unreachable there - but it has no real function. (F12 is
	// left free.)
	...modVariants("F10", "INVERSE_VIDEO"),
	...modVariants("F11", "ESC"),
	...modVariants("Escape", "ESC"),
	...modVariants("Tab", "TAB"),
	...modVariants("Enter", "RETURN"),
	...modVariants("Backspace", "BACKSPACE"),

	// Editing keys.
	{
		on: "Delete",
		command: "PRESS_CONTROL_BACKSPACE",
		note: "Delete char (Ctrl+Backspace)",
	},
	{ on: "Delete", shift: true, command: "PRESS_SHIFT_BACKSPACE" },
	{
		on: "Insert",
		command: "PRESS_CONTROL_GREATER_THAN",
		note: "Insert char (Ctrl+>)",
	},
	{ on: "Insert", shift: true, command: "PRESS_SHIFT_GREATER_THAN" },
	// (Home was Clear; it's now a navigation key -> F3 below. Clear stays reachable
	// as Ctrl+-, since the Atari < key sits at the - position positionally - Ctrl
	// resolves by code, so host Ctrl+< would hit the , key instead.)

	// Shift keys - by `code` for left/right location. Shift-agnostic (a Shift key
	// can't require Shift up: pressing it sets Shift).
	{ on: "ShiftLeft", shift: "any", command: "PRESS_JOY0_TRIGGER" },
	{ on: "ShiftRight", shift: "any", command: "PRESS_SHIFT" },

	// Arrows, plain - joystick 0 (held). Shift-agnostic: ShiftLeft is the fire
	// button, so firing while steering must work.
	{ on: "ArrowUp", shift: "any", command: "PRESS_JOY0_UP" },
	{ on: "ArrowDown", shift: "any", command: "PRESS_JOY0_DOWN" },
	{ on: "ArrowLeft", shift: "any", command: "PRESS_JOY0_LEFT" },
	{ on: "ArrowRight", shift: "any", command: "PRESS_JOY0_RIGHT" },

	// Ctrl+Arrows - Atari cursor keys (Ctrl exact, so plain/Shift arrows steer).
	{ on: "ArrowUp", ctrl: true, command: "PRESS_CONTROL_MINUS" },
	{ on: "ArrowDown", ctrl: true, command: "PRESS_CONTROL_EQUALS" },
	{ on: "ArrowLeft", ctrl: true, command: "PRESS_CONTROL_PLUS" },
	{ on: "ArrowRight", ctrl: true, command: "PRESS_CONTROL_ASTERISK" },

	// Navigation keys -> the 1200XL function keys F1-F4 (the universal home for
	// them - reachable on every platform, including Windows where Option+Arrow
	// isn't). Mapped by meaning: the unmodified key gives the Atari Shift+Fn (so
	// host Shift is inverted - see navKey). macOS also gets Option+Arrow (overlay).
	...navKey("PageUp", "F1"), // top-left
	...navKey("PageDown", "F2"), // bottom-left
	...navKey("Home", "F3"), // line start
	...navKey("End", "F4"), // line end
];

// Cmd (mac) / Alt (win) on the `-` and `=`/`+` keys -> the Atari SHIFT functions of
// the keys that sit there: Shift+Clear (the `<`/Clear key, at `-`) and insert-line
// (Shift on the `>`/Insert key, at `=`/`+`). The Ctrl forms - Clear, insert-char -
// already work as Ctrl+-/Ctrl+=, since Ctrl resolves positionally. But host Shift
// on those keys produces characters (`_`, `+`), so the Shift forms have no
// positional route; Cmd/Alt supply it. These are the browser zoom chords, but
// preventable. Shift-agnostic so the chord lands however `+`/`-` is produced.
function editKeys(mod: Pick<Binding, "meta" | "alt">): Binding[] {
	return [
		{ on: "Minus", ...mod, shift: "any", command: "PRESS_SHIFT_LESS_THAN" },
		{ on: "Equal", ...mod, shift: "any", command: "PRESS_SHIFT_GREATER_THAN" },
	];
}

// macOS overlay: Cmd+Arrow stands in for the cursor keys (the OS reserves
// Ctrl+Arrow for Mission Control), and Option+Arrow drives the 1200XL function
// keys F1-F4 (cursor up/down/left/right by default), with Ctrl/Shift variants.
const macBindings: Binding[] = [
	{ on: "ArrowUp", meta: true, command: "PRESS_CONTROL_MINUS" },
	{ on: "ArrowDown", meta: true, command: "PRESS_CONTROL_EQUALS" },
	{ on: "ArrowLeft", meta: true, command: "PRESS_CONTROL_PLUS" },
	{ on: "ArrowRight", meta: true, command: "PRESS_CONTROL_ASTERISK" },
	// Cmd+K opens the palette - a global binding (fires regardless of focus),
	// anchored to the K key so it follows the layout (Cmd+K, not Cmd+<position>).
	{
		on: "KeyK",
		meta: true,
		command: "OPEN_PALETTE",
		scope: "global",
		anchor: "letter",
	},
	// Cmd+-/Cmd+= -> Shift+Clear / insert-line (see editKeys).
	...editKeys({ meta: true }),
	// Option+Arrow -> F1-F4 (+ Ctrl/Shift). Option (not plain Alt) avoids the
	// Windows snags noted on `base` above - hence mac-only.
	...modVariants("ArrowUp", "F1", { alt: true }),
	...modVariants("ArrowDown", "F2", { alt: true }),
	...modVariants("ArrowLeft", "F3", { alt: true }),
	...modVariants("ArrowRight", "F4", { alt: true }),
];

// Windows/Linux overlay: Alt stands in for Ctrl on just the keys the browser
// grabs - Ctrl+digit (tab select / zoom) and Ctrl+N/T/W/L/O (new window / tab /
// close / address bar / open). Nothing else, so other Alt+letter combos stay free
// for app commands (e.g. Alt+K opens the palette). On macOS these reach the Atari
// via plain Ctrl, so this overlay is non-mac only.
const winBindings: Binding[] = [
	...(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const).flatMap(
		(d) => altCtrl(`Digit${d}`, d),
	),
	...altCtrl("KeyN", "N"),
	...altCtrl("KeyT", "T"),
	...altCtrl("KeyW", "W"),
	...altCtrl("KeyL", "L", false),
	...altCtrl("KeyO", "O", false),
	// Alt+K opens the palette - a global binding (Cmd's stand-in on Windows),
	// anchored to the K key so it follows the layout.
	{
		on: "KeyK",
		alt: true,
		command: "OPEN_PALETTE",
		scope: "global",
		anchor: "letter",
	},
	// Alt+-/Alt+= -> Shift+Clear / insert-line (editKeys; Cmd's stand-in on Windows).
	...editKeys({ alt: true }),
];

// --- Positional layer ----------------------------------------------------
// The raw keyboard: each character-producing host key, by physical `code`, mapped
// to the Atari matrix key at that position. In Character mode the character
// channel resolves first and shadows the bare/Shift keys (typing is layout-aware,
// by produced char); these still serve Ctrl combos, non-ATASCII keys, and all of
// Positional mode. Modifiers are exact here - Ctrl/Shift are part of the keycode.

// Host `code` -> the Atari matrix base at that physical position.
// Backquote/IntlBackslash double the ESC key (the key left of `1`, as on the
// Atari).
const positionalKeys: Record<string, MatrixBase> = {
	Backquote: "ESC",
	Digit1: "1",
	Digit2: "2",
	Digit3: "3",
	Digit4: "4",
	Digit5: "5",
	Digit6: "6",
	Digit7: "7",
	Digit8: "8",
	Digit9: "9",
	Digit0: "0",
	Minus: "LESS_THAN",
	Equal: "GREATER_THAN",
	IntlBackslash: "ESC",
	KeyQ: "Q",
	KeyW: "W",
	KeyE: "E",
	KeyR: "R",
	KeyT: "T",
	KeyY: "Y",
	KeyU: "U",
	KeyI: "I",
	KeyO: "O",
	KeyP: "P",
	BracketLeft: "MINUS",
	BracketRight: "EQUALS",
	KeyA: "A",
	KeyS: "S",
	KeyD: "D",
	KeyF: "F",
	KeyG: "G",
	KeyH: "H",
	KeyJ: "J",
	KeyK: "K",
	KeyL: "L",
	Semicolon: "SEMICOLON",
	Quote: "PLUS",
	Backslash: "ASTERISK",
	KeyZ: "Z",
	KeyX: "X",
	KeyC: "C",
	KeyV: "V",
	KeyB: "B",
	KeyN: "N",
	KeyM: "M",
	Comma: "COMMA",
	Period: "PERIOD",
	Slash: "SLASH",
	Space: "SPACE",
};

// Each position -> its four exact-modifier bindings (see modVariants). In
// Character mode the character channel resolves first and shadows the bare/Shift
// character keys (so typing is layout-aware); these still apply for Ctrl combos,
// non-ATASCII keys, and the whole of Positional mode.
export const positional: Binding[] = Object.entries(positionalKeys).flatMap(
	([code, base]) => modVariants(code, base),
);

/** The host `code`s that produce a character in Character mode (the positional
 *  layer's keys). The editor warns when a bare one of these is bound, since
 *  typing shadows it there. */
export const CHARACTER_CODES: ReadonlySet<string> = new Set(
	Object.keys(positionalKeys),
);

/** Host `code`s offered in the binding editor's key picker (the keys you might
 *  reasonably bind), grouped roughly by kind. */
export const KEY_CODES: readonly string[] = [
	..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((c) => `Key${c}`),
	..."0123456789".split("").map((d) => `Digit${d}`),
	"Minus",
	"Equal",
	"BracketLeft",
	"BracketRight",
	"Semicolon",
	"Quote",
	"Backquote",
	"Backslash",
	"Comma",
	"Period",
	"Slash",
	"IntlBackslash",
	"Space",
	"Enter",
	"Tab",
	"Backspace",
	"Delete",
	"Insert",
	"ArrowUp",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
	"Home",
	"End",
	"PageUp",
	"PageDown",
	...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
	"Escape",
	"Pause",
	"ShiftLeft",
	"ShiftRight",
	"ControlLeft",
	"ControlRight",
	"AltLeft",
	"AltRight",
	"MetaLeft",
	"MetaRight",
	...Array.from({ length: 10 }, (_, i) => `Numpad${i}`),
	"NumpadEnter",
	"NumpadAdd",
	"NumpadSubtract",
	"NumpadMultiply",
	"NumpadDivide",
	"NumpadDecimal",
];

/** A binding's trigger identity (key + modifier states) - overlays replace by
 *  this, and the editor detects conflicts with it. Each modifier's state (up /
 *  down / any) is part of the identity. */
export function triggerKey(b: Binding): string {
	const state = (m: Mod | undefined): string =>
		m === "any" ? "any" : m ? "down" : "up";
	return `${b.on}|s:${state(b.shift)}|c:${state(b.ctrl)}|a:${state(b.alt)}|m:${state(b.meta)}`;
}

// Overlay `ext` onto `acc`: a binding with the same trigger replaces, else adds.
function overlay(acc: Binding[], ext: Binding[]): Binding[] {
	const byTrigger = new Map(acc.map((b) => [triggerKey(b), b]));
	for (const b of ext) byTrigger.set(triggerKey(b), b);
	return [...byTrigger.values()];
}

// --- Primary bindings ----------------------------------------------------
// Which of a command's several bindings represents it (the chord shown in the
// palette, menu, and key-help). The choice is platform-aware and can't be a
// static list order, because the shared `base` bindings want opposite primaries
// per platform (e.g. Esc's primary is F11 on Windows - the only catchable route
// for Ctrl+Esc - but the Esc key itself on macOS).

// Punctuation `code`s. A Shift+punct binding's label is layout-fragile (the
// legend can misread under Shift), so it's never made primary when the command
// has any other binding.
const PUNCT_CODES: ReadonlySet<string> = new Set([
	"Backquote",
	"Minus",
	"Equal",
	"BracketLeft",
	"BracketRight",
	"Semicolon",
	"Quote",
	"Backslash",
	"IntlBackslash",
	"Comma",
	"Period",
	"Slash",
]);

const isFKey = (b: Binding): boolean => /^F\d+$/.test(b.on);
const isArrow = (b: Binding): boolean => b.on.startsWith("Arrow");
const isLetterOrDigit = (b: Binding): boolean =>
	/^(Key[A-Z]|Digit[0-9])$/.test(b.on);
const isShiftPunct = (b: Binding): boolean =>
	b.shift === true && PUNCT_CODES.has(b.on);

const CURSOR_COMMANDS: ReadonlySet<Command> = new Set<Command>([
	"PRESS_CONTROL_MINUS", // cursor up
	"PRESS_CONTROL_EQUALS", // cursor down
	"PRESS_CONTROL_PLUS", // cursor left
	"PRESS_CONTROL_ASTERISK", // cursor right
]);

// The platform-preferred primary among a command's `group` of bindings, or
// undefined to fall back to first-listed (minus Shift+punct). Encodes the agreed
// family table; the reasons live with each rule.
function choosePrimary(
	command: Command,
	group: Binding[],
	mac: boolean,
): Binding | undefined {
	const find = (pred: (b: Binding) => boolean) => group.find(pred);
	const onKey = (on: string) => group.find((b) => b.on === on);

	// Esc, Tab, and Break -> the F-key everywhere. F11 is the only catchable route
	// for Ctrl+Esc on Windows and F9 the only one for Ctrl+Tab; the Esc glyph (⎋)
	// is obscure, and Pause is fading from keyboards - so the F-key leads.
	if (
		command.endsWith("ESC") ||
		command.endsWith("TAB") ||
		command === "PRESS_BREAK"
	)
		return find(isFKey);
	// Atari cursor keys: Cmd+Arrow on macOS (the OS reserves Ctrl+Arrow for
	// Mission Control), Ctrl+Arrow on Windows.
	if (CURSOR_COMMANDS.has(command))
		return find((b) => isArrow(b) && (mac ? b.meta === true : b.ctrl === true));
	// Delete/Insert editing row: the dedicated key on Windows; the Ctrl/Shift form
	// on macOS, whose laptops lack Delete/Insert.
	if (command.endsWith("BACKSPACE"))
		return mac ? onKey("Backspace") : onKey("Delete");
	if (command === "PRESS_CONTROL_GREATER_THAN")
		return mac
			? find((b) => b.on === "Equal" && b.ctrl === true)
			: onKey("Insert");
	if (command === "PRESS_SHIFT_GREATER_THAN")
		return mac
			? find((b) => b.on === "Equal" && b.meta === true)
			: onKey("Insert");
	// Windows Alt-for-Ctrl aliases: Ctrl+digit / Ctrl+letter are browser-grabbed,
	// so the working Alt combo is primary. (macOS reaches these via plain Ctrl -
	// a single binding, handled below.)
	if (!mac) {
		const alias = find((b) => b.alt === true && isLetterOrDigit(b));
		if (alias) return alias;
	}
	// 1200XL function keys F1-F4: Option+Arrow on macOS; on Windows there's only
	// the PgUp/PgDn/Home/End nav binding (Option+Arrow is mac-only), so no choice.
	if (/F[1-4]$/.test(command))
		return mac ? find((b) => isArrow(b) && b.alt === true) : undefined;

	return undefined;
}

// Flag each multi-binding command's representative binding. Returns a new array
// (the chosen bindings cloned with `primary`), leaving the shared `base`/overlay
// binding objects untouched.
function markPrimaries(bindings: Binding[], mac: boolean): Binding[] {
	const groups = new Map<Command, Binding[]>();
	for (const b of bindings) {
		const g = groups.get(b.command);
		if (g) g.push(b);
		else groups.set(b.command, [b]);
	}
	const primary = new Set<Binding>();
	for (const group of groups.values()) {
		if (group.length < 2) continue;
		const command = group[0]!.command;
		const chosen =
			choosePrimary(command, group, mac) ??
			group.find((b) => !isShiftPunct(b)) ??
			group[0];
		if (chosen) primary.add(chosen);
	}
	return bindings.map((b) => (primary.has(b) ? { ...b, primary: true } : b));
}

/**
 * The full default binding set for a platform: the platform-agnostic bindings
 * plus the positional layer, with the platform overlay merged in - macOS
 * (Cmd/Option+Arrow) on Mac, the Windows/Linux Alt-for-Ctrl aliases elsewhere.
 * One flat set, the same in both keyboard modes; the mode only decides whether
 * the character channel resolves first (see the keyboard). This is what the
 * binding store persists (and the customization UI edits). Each multi-binding
 * command carries a `primary` flag on its platform-preferred representative.
 */
export function defaultBindingSet(mac: boolean): Binding[] {
	return markPrimaries(
		overlay([...base, ...positional], mac ? macBindings : winBindings),
		mac,
	);
}

// --- Resolution ----------------------------------------------------------

/** A keyboard event reduced to what matching needs: identity + modifier states. */
export interface KeyEventLike {
	code: string;
	key: string;
	shift: boolean;
	ctrl: boolean;
	alt: boolean;
	meta: boolean;
}

// A modifier matches when it's `"any"`, or its required state (absent = up)
// equals the event's.
function modMatches(required: Mod | undefined, actual: boolean): boolean {
	return required === "any" || (required ?? false) === actual;
}

function matches(b: Binding, event: KeyEventLike): boolean {
	return (
		event.code === b.on &&
		modMatches(b.shift, event.shift) &&
		modMatches(b.ctrl, event.ctrl) &&
		modMatches(b.alt, event.alt) &&
		modMatches(b.meta, event.meta)
	);
}

// A binding's specificity: how many modifiers it pins concretely (`"any"` doesn't
// count). When several bindings match one event - only possible via `"any"`
// wildcards - the most specific wins, so a precise binding beats a catch-all.
function specificity(b: Binding): number {
	let pinned = 0;
	for (const m of [b.shift, b.ctrl, b.alt, b.meta]) if (m !== "any") pinned++;
	return pinned;
}

/** The binding `event` triggers in `bindings`, or null - the most specific match
 *  (ties keep array order). Bindings are keyed by `code`, so there's no key-vs-
 *  code precedence; specificity only orders overlaps that `"any"` modifiers
 *  create, making resolution independent of the set's order. */
export function resolveBinding(
	bindings: Binding[],
	event: KeyEventLike,
): Binding | null {
	let best: Binding | null = null;
	let bestSpec = -1;
	for (const b of bindings) {
		if (!matches(b, event)) continue;
		const spec = specificity(b);
		if (spec > bestSpec) {
			best = b;
			bestSpec = spec;
		}
	}
	return best;
}

// --- Display labels ------------------------------------------------------
// A binding's human label is layout-dependent, so it's resolved at display time
// (not stored): the user's physical layout via getLayoutMap(), else QWERTY.

// US-QWERTY legends for the punctuation `code`s the layout map doesn't cover.
// Letters/digits derive from the code; named/platform keys go through the tables
// below.
const QWERTY_PUNCT: Record<string, string> = {
	Backquote: "`",
	Minus: "-",
	Equal: "=",
	BracketLeft: "[",
	BracketRight: "]",
	Semicolon: ";",
	Quote: "'",
	Backslash: "\\",
	IntlBackslash: "\\",
	Comma: ",",
	Period: ".",
	Slash: "/",
};

// The QWERTY/fallback legend for a character `code`: letters and digits read off
// the identifier, punctuation from the table, else the identifier verbatim (so
// "F5", "Pause" ... display as-is when nothing else claims them).
function qwertyLabel(id: string): string {
	const letter = /^Key([A-Z])$/.exec(id);
	if (letter) return letter[1]!;
	const digit = /^Digit([0-9])$/.exec(id);
	if (digit) return digit[1]!;
	return QWERTY_PUNCT[id] ?? id;
}

// Bare modifier keys, as a trigger or in the picker: "{Side} {Name}". macOS
// spells the name in full (Control/Option/Command); Windows uses the short words.
// Shift is "Shift" on both.
const MODIFIER_KEYS: Record<
	string,
	{ side: "left" | "right"; kind: "shift" | "ctrl" | "alt" | "meta" }
> = {
	ShiftLeft: { side: "left", kind: "shift" },
	ShiftRight: { side: "right", kind: "shift" },
	ControlLeft: { side: "left", kind: "ctrl" },
	ControlRight: { side: "right", kind: "ctrl" },
	AltLeft: { side: "left", kind: "alt" },
	AltRight: { side: "right", kind: "alt" },
	MetaLeft: { side: "left", kind: "meta" },
	MetaRight: { side: "right", kind: "meta" },
};

function modifierKeyLabel(
	side: "left" | "right",
	kind: "shift" | "ctrl" | "alt" | "meta",
	mac: boolean,
): string {
	const k = messages.keys;
	const name =
		kind === "shift"
			? k.mod.shift
			: kind === "ctrl"
				? mac
					? k.modFull.control
					: k.mod.ctrl
				: kind === "alt"
					? mac
						? k.modFull.option
						: k.mod.alt
					: mac
						? k.modFull.command
						: k.mod.win;
	return `${side === "left" ? k.side.left : k.side.right} ${name}`;
}

// Named / navigation keys, whose label differs by platform: glyphs (and fn-
// combos) on macOS, short localizable words on Windows. Anything not here is a
// character key, resolved from the layout map / QWERTY.
const NAMED_KEYS: Record<string, (mac: boolean) => string> = {
	Backspace: (mac) => (mac ? "⌫" : messages.keys.backspace),
	Enter: (mac) => (mac ? "↩" : messages.keys.enter),
	Tab: (mac) => (mac ? "⇥" : messages.keys.tab),
	CapsLock: (mac) => (mac ? "⇪" : messages.keys.capsLock),
	Escape: () => messages.keys.esc, // ⎋ is obscure - spell it on both
	Space: (mac) => (mac ? "␣" : messages.keys.space),
	// Arrows (not triangles) on both - they align better beside the ⌘⇧ glyphs.
	ArrowUp: () => "↑",
	ArrowDown: () => "↓",
	ArrowLeft: () => "<-",
	ArrowRight: () => "→",
	Home: (mac) => (mac ? "fn←" : messages.keys.home),
	End: (mac) => (mac ? "fn→" : messages.keys.end),
	PageUp: (mac) => (mac ? "fn↑" : messages.keys.pageUp),
	PageDown: (mac) => (mac ? "fn↓" : messages.keys.pageDown),
	Insert: () => messages.keys.insert, // "Ins" on both (macOS lacks the key)
	Delete: (mac) => (mac ? "fn⌫" : messages.keys.delete),
	Pause: () => messages.keys.pause,
};

/** A `code`'s display label: bare modifier keys named with their side, named /
 *  nav keys per platform, everything else a character key resolved from the
 *  layout map (else QWERTY). */
export function keyLabel(
	code: string,
	mac: boolean,
	layout?: Map<string, string>,
): string {
	const mod = MODIFIER_KEYS[code];
	if (mod) return modifierKeyLabel(mod.side, mod.kind, mac);
	const named = NAMED_KEYS[code];
	if (named) return named(mac);
	return layout?.get(code) ?? qwertyLabel(code);
}

interface KeyboardLayoutAPI {
	getLayoutMap?(): Promise<Map<string, string>>;
}

/**
 * The user's physical layout labels (`code` -> UPPERCASED key legend) from
 * `navigator.keyboard.getLayoutMap()`. Empty where unsupported (Firefox, Safari)
 * - `keyLabel` then falls back to QWERTY. Covers only the writing-system keys
 * (letters/digits/symbols); function/named keys aren't in it.
 */
/** Uppercase layout legends to keycap form, minding legends that mislead on a
 *  real key:
 *  - Turkish/Azeri carry both the dotted and dotless i, whose caps are İ / I, but
 *    plain `toUpperCase` folds both to "I" - so when the pair is present we case
 *    in the Turkish locale, keeping each dot.
 *  - German ß uppercases to "SS"; a key just prints "ß", so we keep it.
 *  - The number row: a full unshifted digit set is kept as-is (honoring any
 *    reordering - e.g. Programmer Dvorak); otherwise each DigitN is labeled with
 *    its numeral, since AZERTY & co. carry symbols there unshifted, yet Ctrl+N is
 *    universally shown (and resolved, digit VKs being position-fixed) as the digit. */
export function upperLegends(
	entries: Iterable<[string, string]>,
): Map<string, string> {
	const list = [...entries];
	const labels = new Set(list.map(([, label]) => label));
	const turkish = labels.has("i") && labels.has("ı");
	const cap = (label: string) =>
		label === "ß"
			? "ß"
			: turkish
				? label.toLocaleUpperCase("tr")
				: label.toUpperCase();
	const map = new Map(list.map(([code, label]) => [code, cap(label)]));
	const digits: (string | undefined)[] = [];
	for (let n = 0; n <= 9; n++) digits.push(map.get(`Digit${n}`));
	// A full digit row (all ten present, each an ASCII digit) is trustworthy - keep
	// it, reordering and all. Anything else (symbols on AZERTY/Dvorak) -> numerals.
	const fullDigitRow =
		digits.every((v) => v !== undefined && /^[0-9]$/.test(v)) &&
		new Set(digits).size === 10;
	if (!fullDigitRow) {
		for (let n = 0; n <= 9; n++) {
			if (map.has(`Digit${n}`)) map.set(`Digit${n}`, String(n));
		}
	}
	return map;
}

export async function loadLayoutLabels(): Promise<Map<string, string>> {
	const kb = (navigator as unknown as { keyboard?: KeyboardLayoutAPI })
		.keyboard;
	if (!kb?.getLayoutMap) return new Map();
	try {
		return upperLegends(await kb.getLayoutMap());
	} catch {
		return new Map(); // permission/availability hiccup -> QWERTY fallback
	}
}

/** Whether the browser exposes the physical keyboard layout (Chromium does;
 *  Firefox/Safari don't). When false, character-key labels fall back to QWERTY
 *  and may mislead on a non-US layout. */
export function layoutLabelsAvailable(): boolean {
	return !!(navigator as unknown as { keyboard?: KeyboardLayoutAPI }).keyboard
		?.getLayoutMap;
}

/**
 * Prepare a default binding set for persistence: resolve anchored chords (see
 * `Binding.anchor`) against the layout - re-homing each to the physical key that
 * produces its letter (and, for a "ctrl" alias, re-taking the Atari command at
 * that position). Absent layout data (Firefox/Safari) this is a no-op: chords
 * keep their QWERTY position. Labels are never frozen - display recomputes them
 * from the persisted layout (see {@link chordLabel}).
 */
export function bakeDefaults(
	bindings: Binding[],
	layout: Map<string, string>,
): Binding[] {
	// Invert the layout (produced letter -> the code that types it) so an anchored
	// chord can hop to that key. First code wins; letters are unique in practice.
	const codeForLetter = new Map<string, string>();
	for (const [code, label] of layout) {
		if (!codeForLetter.has(label)) codeForLetter.set(label, code);
	}
	// The Atari Ctrl command at each physical position (from the positional layer),
	// so a re-homed "ctrl" alias takes the command of the key it lands on.
	const ctrlAt = new Map<string, Command>();
	const ctrlShiftAt = new Map<string, Command>();
	for (const b of bindings) {
		if (b.ctrl === true && b.alt !== true && b.meta !== true) {
			(b.shift === true ? ctrlShiftAt : ctrlAt).set(b.on, b.command);
		}
	}
	return bindings.flatMap((b) => {
		if (b.anchor === "letter") {
			// App shortcut: hop to the letter's key, keep the command.
			const letter = qwertyLabel(b.on); // the intended letter (KeyK -> "K")
			const baked = { ...b, on: codeForLetter.get(letter) ?? b.on };
			delete baked.anchor; // strip the hint; it never persists
			return [baked];
		}
		if (b.anchor === "ctrl") {
			// Positional Alt-for-Ctrl alias: hop to the letter's key, then take the
			// Atari Ctrl key that sits at that physical position. Drop it if that key
			// has no such combo (e.g. an unscannable Ctrl+Shift landing spot).
			const letter = qwertyLabel(b.on);
			const on = codeForLetter.get(letter) ?? b.on;
			const command = (b.shift === true ? ctrlShiftAt : ctrlAt).get(on);
			if (!command) return [];
			const baked = { ...b, on, command };
			delete baked.anchor;
			return [baked];
		}
		return [b];
	});
}

// Chords are labelled from the persisted layout map; empty => QWERTY fallback.
const NO_LAYOUT = new Map<string, string>();

/** The required modifiers of a chord (each simply down or not). */
export interface ChordMods {
	ctrl?: boolean;
	shift?: boolean;
	alt?: boolean;
	meta?: boolean;
}

/**
 * A chord from its modifiers + already-resolved key label, in canonical order
 * (Ctrl, Shift, Alt, Cmd/Win). macOS concatenates glyphs with the key (⌘K);
 * Windows joins localizable words with "+" (Ctrl+Shift+K). Shared by
 * {@link chordLabel} and the editor's live capture preview.
 */
export function formatChord(
	mods: ChordMods,
	key: string,
	mac: boolean,
): string {
	if (mac) {
		let prefix = "";
		if (mods.ctrl) prefix += "⌃";
		if (mods.shift) prefix += "⇧";
		if (mods.alt) prefix += "⌥";
		if (mods.meta) prefix += "⌘";
		return prefix + key;
	}
	const m = messages.keys.mod;
	const parts: string[] = [];
	if (mods.ctrl) parts.push(m.ctrl);
	if (mods.shift) parts.push(m.shift);
	if (mods.alt) parts.push(m.alt);
	if (mods.meta) parts.push(m.win);
	parts.push(key);
	return parts.join("+");
}

/**
 * A binding's full chord for display, recomputed from `layout` + platform (no
 * frozen labels). Required modifiers only - `"any"` is device-agnostic, so
 * omitted.
 */
export function chordLabel(
	b: Binding,
	mac: boolean,
	layout: Map<string, string> = NO_LAYOUT,
): string {
	return formatChord(
		{
			ctrl: b.ctrl === true,
			shift: b.shift === true,
			alt: b.alt === true,
			meta: b.meta === true,
		},
		keyLabel(b.on, mac, layout),
		mac,
	);
}

/**
 * Each command's primary (first-listed) trigger chord, for showing the shortcut
 * next to a command. Commands with no binding are absent. An optional live
 * `layout` map (see {@link chordLabel}) makes the key legends track the actual
 * keyboard rather than the baked-in fallback.
 */
export function primaryChords(
	flat: Binding[],
	mac: boolean,
	layout: Map<string, string> = NO_LAYOUT,
): Map<Command, string> {
	// The command's `primary` binding wins; else the first listed. (A user or the
	// defaults mark at most one primary per command - see {@link markPrimaries}.)
	const chosen = new Map<Command, Binding>();
	for (const b of flat) {
		const cur = chosen.get(b.command);
		if (!cur || (b.primary && !cur.primary)) chosen.set(b.command, b);
	}
	const chords = new Map<Command, string>();
	for (const [command, b] of chosen)
		chords.set(command, chordLabel(b, mac, layout));
	return chords;
}
