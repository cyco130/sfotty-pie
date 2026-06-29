import type { Command } from "./commands.ts";

// The keyboard binding table: every discrete Atari key / device action as data,
// keyed by trigger and resolved by `resolveBinding`. keyboard.ts drives input
// through it; layout-aware typing (Character mode) is the separate character
// channel in char-keys.ts.
//
// Structured as a platform-agnostic `base` plus per-platform overlays merged in
// to form the effective defaults (see `defaultBindings`). Every binding is one
// (key + modifiers) → one fixed command; no folding. Modifiers are exact (must be
// up unless stated) except device inputs, which are Shift-agnostic (see `Mod`).
// The raw `code`→Atari layer is tagged Positional-only (the positional layer);
// in Character mode those keys belong to the character channel instead.

/** Host key identity: physical position (`code`) or logical/named key (`key`). */
type KeyId = { code: string } | { key: string };

/**
 * A modifier's required state. Default (absent) = must be UP; `true` = must be
 * DOWN; `"any"` = don't care. `"any"` is for device inputs (console buttons,
 * joystick, the Shift keys themselves) that fire regardless of Shift — because
 * Shift is a separate Atari line that combines at the machine level (its own
 * binding fires too), e.g. Shift+Option is a real, distinct input. Matrix/named
 * keys stay exact, where Shift/Ctrl pick the keycode variant.
 */
type Mod = boolean | "any";

/** Character mode = layout-aware typing (the character channel owns the
 *  character keys); Positional mode = the raw `code`→Atari keyboard. */
export type KeyboardMode = "character" | "positional";

export interface Binding {
	on: KeyId;
	// Intentional modifiers (see {@link Mod}). `alt` is the Alt/Option "Mod"
	// layer, `meta` is Cmd. Locks (Caps/Num) never matched.
	shift?: Mod;
	ctrl?: Mod;
	alt?: Mod;
	meta?: Mod;
	// Pressed on key-down; released on key-up when the command has a release half
	// (a sustained control), else instant — so a held binding is one entry.
	command: Command;
	// Which keyboard mode this binding is active in; absent = both. The raw
	// character-key layer is positional-only (in Character mode those keys belong
	// to the character channel).
	mode?: KeyboardMode;
	// Display label override — a frozen fallback for user bindings. Default
	// bindings resolve their label from the layout map / QWERTY (see `labelFor`).
	label?: string;
	note?: string;
}

/**
 * The Atari matrix bases a binding can target — expanded to `PRESS_<base>` and
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
	| "F1"
	| "F2"
	| "F3"
	| "F4";

// A matrix key reached by `on`, expanded to its four exact-modifier bindings:
// plain / Shift / Ctrl / Ctrl+Shift → PRESS_[CONTROL_][SHIFT_]<base>. `extra`
// carries a held base modifier onto all four (e.g. Option for the mac F1–F4).
function modVariants(
	on: KeyId,
	base: MatrixBase,
	extra: Partial<Pick<Binding, "shift" | "ctrl" | "alt" | "meta">> = {},
): Binding[] {
	return [
		{ on, ...extra, command: `PRESS_${base}` },
		{ on, ...extra, shift: true, command: `PRESS_SHIFT_${base}` },
		{ on, ...extra, ctrl: true, command: `PRESS_CONTROL_${base}` },
		{
			on,
			...extra,
			ctrl: true,
			shift: true,
			command: `PRESS_CONTROL_SHIFT_${base}`,
		},
	];
}

// A 1200XL function key (F1–F4) reached by a host navigation key whose
// unmodified meaning matches the Atari Shift+Fn (PgUp = top-left = Shift+F1, Home
// = line-start = Shift+F3, …). So host Shift is INVERTED — plain → Shift+Fn,
// Shift → plain Fn — while Ctrl stays direct.
function navKey(on: KeyId, base: "F1" | "F2" | "F3" | "F4"): Binding[] {
	return [
		{ on, command: `PRESS_SHIFT_${base}` },
		{ on, shift: true, command: `PRESS_${base}` },
		{ on, ctrl: true, command: `PRESS_CONTROL_${base}` },
		{ on, ctrl: true, shift: true, command: `PRESS_CONTROL_SHIFT_${base}` },
	];
}

// Platform-agnostic bindings. (Every F-key is additionally claimed at
// window+capture — the browser-shortcut guard — assumed for the F-keys here.)
const base: Binding[] = [
	// Console buttons (held). Shift- and Ctrl-agnostic: they're a separate CONSOL
	// line, so no host modifier suppresses them (Shift+Option is a real combo —
	// the Shift key's own binding fires alongside).
	{ on: { key: "F2" }, shift: "any", ctrl: "any", command: "PRESS_OPTION" },
	{ on: { key: "F3" }, shift: "any", ctrl: "any", command: "PRESS_SELECT" },
	{ on: { key: "F4" }, shift: "any", ctrl: "any", command: "PRESS_START" },

	// Reset (held, Shift-agnostic → Shift+Reset works); Ctrl+F5 cold-boots. Ctrl
	// is exact, so it cleanly splits Reset from Power-cycle with no overlap.
	{ on: { key: "F5" }, shift: "any", command: "PRESS_RESET" },
	{ on: { key: "F5" }, ctrl: true, shift: "any", command: "POWER_CYCLE" },

	// Break — no release (a key-up isn't observable), so instant. On F8: its one
	// reachability gap is Ctrl+F8 (Mac Safari), which Break never uses.
	{ on: { key: "F8" }, command: "PRESS_BREAK" },
	{ on: { key: "Pause" }, command: "PRESS_BREAK" },

	// Named Atari keys — each with all four Ctrl/Shift variants. Help/Inverse/Esc
	// moved off the browser/OS-grabbed F1/F6/F8 to free F-keys; Esc and Tab also
	// keep their natural keys, the F-key home adding the reliable Ctrl/Shift combos
	// (notably Ctrl+F9 → Ctrl+Tab, which Ctrl+Tab itself can't reach anywhere). Esc
	// takes F11 (dead on Mac) since it's covered elsewhere too; Inverse, which
	// isn't, takes F12.
	...modVariants({ key: "F7" }, "CAPS"),
	...modVariants({ key: "F9" }, "TAB"),
	...modVariants({ key: "F10" }, "HELP"),
	// Help is also double-bound to F1: Shift+F10 is the Windows context-menu key
	// (not preventable), so Shift+Help (cursor home) would be lost there — but
	// Shift+F1 is clear on both OSes. (Plain F1 is browser Help on Windows; that's
	// fine, F10 is the primary home.)
	...modVariants({ key: "F1" }, "HELP"),
	...modVariants({ key: "F11" }, "ESC"),
	...modVariants({ key: "F12" }, "INVERSE_VIDEO"),
	...modVariants({ key: "Escape" }, "ESC"),
	...modVariants({ key: "Tab" }, "TAB"),
	...modVariants({ key: "Enter" }, "RETURN"),
	...modVariants({ key: "Backspace" }, "BACKSPACE"),

	// Editing keys.
	{
		on: { key: "Delete" },
		command: "PRESS_CONTROL_BACKSPACE",
		note: "Delete char (Ctrl+Backspace)",
	},
	{ on: { key: "Delete" }, shift: true, command: "PRESS_SHIFT_BACKSPACE" },
	{
		on: { key: "Insert" },
		command: "PRESS_CONTROL_GREATER_THAN",
		note: "Insert char (Ctrl+>)",
	},
	{ on: { key: "Insert" }, shift: true, command: "PRESS_SHIFT_GREATER_THAN" },
	// (Home was Clear; it's now a navigation key → F3 below. Clear is still
	// reachable as Ctrl+< / Shift+Ctrl+,.)

	// Shift keys — by `code` for left/right location. Shift-agnostic (a Shift key
	// can't require Shift up: pressing it sets Shift).
	{ on: { code: "ShiftLeft" }, shift: "any", command: "PRESS_JOY0_TRIGGER" },
	{ on: { code: "ShiftRight" }, shift: "any", command: "PRESS_SHIFT" },

	// Arrows, plain — joystick 0 (held). Shift-agnostic: ShiftLeft is the fire
	// button, so firing while steering must work.
	{ on: { key: "ArrowUp" }, shift: "any", command: "PRESS_JOY0_UP" },
	{ on: { key: "ArrowDown" }, shift: "any", command: "PRESS_JOY0_DOWN" },
	{ on: { key: "ArrowLeft" }, shift: "any", command: "PRESS_JOY0_LEFT" },
	{ on: { key: "ArrowRight" }, shift: "any", command: "PRESS_JOY0_RIGHT" },

	// Ctrl+Arrows — Atari cursor keys (Ctrl exact, so plain/Shift arrows steer).
	{ on: { key: "ArrowUp" }, ctrl: true, command: "PRESS_CONTROL_MINUS" },
	{ on: { key: "ArrowDown" }, ctrl: true, command: "PRESS_CONTROL_EQUALS" },
	{ on: { key: "ArrowLeft" }, ctrl: true, command: "PRESS_CONTROL_PLUS" },
	{ on: { key: "ArrowRight" }, ctrl: true, command: "PRESS_CONTROL_ASTERISK" },

	// Navigation keys → the 1200XL function keys F1–F4 (the universal home for
	// them — reachable on every platform, including Windows where Option+Arrow
	// isn't). Mapped by meaning: the unmodified key gives the Atari Shift+Fn (so
	// host Shift is inverted — see navKey). macOS also gets Option+Arrow (overlay).
	...navKey({ key: "PageUp" }, "F1"), // top-left
	...navKey({ key: "PageDown" }, "F2"), // bottom-left
	...navKey({ key: "Home" }, "F3"), // line start
	...navKey({ key: "End" }, "F4"), // line end
];

// macOS overlay: Cmd+Arrow stands in for the cursor keys (the OS reserves
// Ctrl+Arrow for Mission Control), and Option+Arrow drives the 1200XL function
// keys F1–F4 (cursor up/down/left/right by default), with Ctrl/Shift variants.
const macBindings: Binding[] = [
	{ on: { key: "ArrowUp" }, meta: true, command: "PRESS_CONTROL_MINUS" },
	{ on: { key: "ArrowDown" }, meta: true, command: "PRESS_CONTROL_EQUALS" },
	{ on: { key: "ArrowLeft" }, meta: true, command: "PRESS_CONTROL_PLUS" },
	{ on: { key: "ArrowRight" }, meta: true, command: "PRESS_CONTROL_ASTERISK" },
	// Option+Arrow → F1–F4 (+ Ctrl/Shift). Option (not plain Alt) avoids the
	// Windows snags noted on `base` above — hence mac-only.
	...modVariants({ key: "ArrowUp" }, "F1", { alt: true }),
	...modVariants({ key: "ArrowDown" }, "F2", { alt: true }),
	...modVariants({ key: "ArrowLeft" }, "F3", { alt: true }),
	...modVariants({ key: "ArrowRight" }, "F4", { alt: true }),
];

// --- Positional layer (Positional mode only) -----------------------------
// The raw keyboard: each character-producing host key, by physical `code`, mapped
// to the Atari matrix key at that position. Tagged `mode: "positional"`, so it's
// dropped in Character mode (where these keys belong to the character channel —
// produced char → Atari key). Modifiers are exact here — Ctrl/Shift are part of
// the keycode.

// Host `code` → the Atari matrix base at that physical position.
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
};

// Each position → its four exact-modifier bindings (see modVariants), tagged
// positional-only.
const positional: Binding[] = Object.entries(positionalKeys).flatMap(
	([code, base]) =>
		modVariants({ code }, base).map(
			(b): Binding => ({ ...b, mode: "positional" }),
		),
);

/** A binding's trigger identity (key + modifier states) — overlays replace by
 *  this. Each modifier's state (up / down / any) is part of the identity. */
function triggerKey(b: Binding): string {
	const state = (m: Mod | undefined): string =>
		m === "any" ? "any" : m ? "down" : "up";
	const id = "code" in b.on ? `code:${b.on.code}` : `key:${b.on.key}`;
	return `${id}|s:${state(b.shift)}|c:${state(b.ctrl)}|a:${state(b.alt)}|m:${state(b.meta)}`;
}

// Overlay `ext` onto `acc`: a binding with the same trigger replaces, else adds.
function overlay(acc: Binding[], ext: Binding[]): Binding[] {
	const byTrigger = new Map(acc.map((b) => [triggerKey(b), b]));
	for (const b of ext) byTrigger.set(triggerKey(b), b);
	return [...byTrigger.values()];
}

/**
 * The effective default bindings for a mode + platform: every binding active in
 * `mode` (its `mode` matches, or is absent = both), then the macOS overlay on
 * macOS. The positional layer drops out in Character mode via its `mode` tag.
 */
export function defaultBindings(mac: boolean, mode: KeyboardMode): Binding[] {
	const active = [...base, ...positional].filter(
		(b) => b.mode === undefined || b.mode === mode,
	);
	return mac ? overlay(active, macBindings) : active;
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
	const id = "code" in b.on ? event.code === b.on.code : event.key === b.on.key;
	return (
		id &&
		modMatches(b.shift, event.shift) &&
		modMatches(b.ctrl, event.ctrl) &&
		modMatches(b.alt, event.alt) &&
		modMatches(b.meta, event.meta)
	);
}

/**
 * The binding `event` triggers in `bindings`, or null. A code-based binding (the
 * more specific identity) wins over a key-based one for the same event.
 */
export function resolveBinding(
	bindings: Binding[],
	event: KeyEventLike,
): Binding | null {
	let keyMatch: Binding | null = null;
	for (const b of bindings) {
		if (!matches(b, event)) continue;
		if ("code" in b.on) return b; // code beats key
		keyMatch ??= b;
	}
	return keyMatch;
}

// --- Display labels ------------------------------------------------------
// A binding's human label is layout-dependent, so it's resolved at display time
// (not stored): the user's physical layout via getLayoutMap(), else QWERTY.

// US-QWERTY legends for keys the layout map doesn't cover (symbols by `code`, the
// Shift keys, and named keys by `key`). Letters/digits derive from the code, so
// they need no entry here.
const QWERTY_LABELS: Record<string, string> = {
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
	ShiftLeft: "Left Shift",
	ShiftRight: "Right Shift",
	Escape: "Esc",
	ArrowUp: "↑",
	ArrowDown: "↓",
	ArrowLeft: "←",
	ArrowRight: "→",
};

// The QWERTY/fallback label for a `code` or named `key`: letters and digits read
// off the identifier, the rest from the table, else the identifier verbatim
// (so "F5", "Tab", "Enter" … display as-is).
function qwertyLabel(id: string): string {
	const letter = /^Key([A-Z])$/.exec(id);
	if (letter) return letter[1]!;
	const digit = /^Digit([0-9])$/.exec(id);
	if (digit) return digit[1]!;
	return QWERTY_LABELS[id] ?? id;
}

interface KeyboardLayoutAPI {
	getLayoutMap?(): Promise<Map<string, string>>;
}

/**
 * The user's physical layout labels (`code` → UPPERCASED key legend) from
 * `navigator.keyboard.getLayoutMap()`. Empty where unsupported (Firefox, Safari)
 * — `labelFor` then falls back to QWERTY. Covers only the writing-system keys
 * (letters/digits/symbols); function/named keys aren't in it.
 */
export async function loadLayoutLabels(): Promise<Map<string, string>> {
	const kb = (navigator as unknown as { keyboard?: KeyboardLayoutAPI })
		.keyboard;
	if (!kb?.getLayoutMap) return new Map();
	try {
		const map = await kb.getLayoutMap();
		return new Map(
			[...map].map(([code, label]) => [code, label.toUpperCase()]),
		);
	} catch {
		return new Map(); // permission/availability hiccup → QWERTY fallback
	}
}

/**
 * A binding's display label: the live layout map (for `code` keys), else its
 * frozen `label`, else the QWERTY legend / key name. Modifier prefixes
 * (Ctrl+/Shift+) are the caller's to add.
 */
export function labelFor(b: Binding, layout: Map<string, string>): string {
	if ("code" in b.on) {
		return layout.get(b.on.code) ?? b.label ?? qwertyLabel(b.on.code);
	}
	return b.label ?? qwertyLabel(b.on.key);
}
