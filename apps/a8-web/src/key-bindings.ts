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
	| "SPACE"
	| "F1"
	| "F2"
	| "F3"
	| "F4";

// Bases whose Ctrl+Shift press can't be scanned on real hardware (base scan code
// $00–$07 / $10–$17), so it does nothing — its `CONTROL_SHIFT` binding is omitted
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
// Shift / Ctrl / Ctrl+Shift → PRESS_[CONTROL_][SHIFT_]<base>. `extra` carries a
// held base modifier onto all of them (e.g. Option for the mac F1–F4). The
// Ctrl+Shift variant is dropped for bases that can't be scanned (see above).
function modVariants(
	on: KeyId,
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

// A 1200XL function key (F1–F4) reached by a host navigation key whose
// unmodified meaning matches the Atari Shift+Fn (PgUp = top-left = Shift+F1, Home
// = line-start = Shift+F3, …). So host Shift is INVERTED — plain → Shift+Fn,
// Shift → plain Fn — while Ctrl stays direct.
function navKey(on: KeyId, base: "F1" | "F2" | "F3" | "F4"): Binding[] {
	// F1–F4's Ctrl+Shift can't be scanned on real hardware, so there's no
	// Ctrl+Shift variant here.
	return [
		{ on, command: `PRESS_SHIFT_${base}` },
		{ on, shift: true, command: `PRESS_${base}` },
		{ on, ctrl: true, command: `PRESS_CONTROL_${base}` },
	];
}

// A Windows/Linux alternate for a browser-grabbed Ctrl combo: Alt+<code> → the
// Atari Ctrl+<base> (and Alt+Shift → Ctrl+Shift when `shift`). Bound only for the
// keys the browser actually eats, so every other Alt+letter stays free for app
// commands.
function altCtrl(code: string, base: MatrixBase, shift = true): Binding[] {
	const out: Binding[] = [
		{ on: { code }, alt: true, command: `PRESS_CONTROL_${base}` },
	];
	if (shift && !DEAD_CTRL_SHIFT.has(base)) {
		out.push({
			on: { code },
			alt: true,
			shift: true,
			command: `PRESS_CONTROL_SHIFT_${base}`,
		});
	}
	return out;
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

	// Named Atari keys — each with all four Ctrl/Shift variants. Caps/Tab/Esc/
	// Inverse have no natural F-key home, so they take F-keys the browser leaves
	// alone (F7/F9/F11/F12); Esc and Tab keep their own keys too, the F-key adding
	// the reliable Ctrl/Shift combos — notably Ctrl+F9 → Atari Ctrl+Tab, which the
	// real Ctrl+Tab can't reach.
	...modVariants({ key: "F7" }, "CAPS"),
	...modVariants({ key: "F9" }, "TAB"),
	// Help's natural home is F1 — F2–F5 are the console keys (Option/Select/Start/
	// Reset), so F1 extends that row as on the XE. Plain F1 is browser Help on
	// Windows, so F10 is bound too as a reliable alternate; and Shift+F1 (clear
	// everywhere) covers Shift+Help, since Windows Shift+F10 is the context menu.
	...modVariants({ key: "F1" }, "HELP"),
	...modVariants({ key: "F10" }, "HELP"),
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
	// (Home was Clear; it's now a navigation key → F3 below. Clear stays reachable
	// as Ctrl+-, since the Atari < key sits at the - position positionally — Ctrl
	// resolves by code, so host Ctrl+< would hit the , key instead.)

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

// Cmd (mac) / Alt (win) on the `-` and `=`/`+` keys → the Atari SHIFT functions of
// the keys that sit there: Shift+Clear (the `<`/Clear key, at `-`) and insert-line
// (Shift on the `>`/Insert key, at `=`/`+`). The Ctrl forms — Clear, insert-char —
// already work as Ctrl+-/Ctrl+=, since Ctrl resolves positionally. But host Shift
// on those keys produces characters (`_`, `+`), so the Shift forms have no
// positional route; Cmd/Alt supply it. These are the browser zoom chords, but
// preventable. Shift-agnostic so the chord lands however `+`/`-` is produced.
function editKeys(mod: Pick<Binding, "meta" | "alt">): Binding[] {
	return [
		{
			on: { code: "Minus" },
			...mod,
			shift: "any",
			command: "PRESS_SHIFT_LESS_THAN",
		},
		{
			on: { code: "Equal" },
			...mod,
			shift: "any",
			command: "PRESS_SHIFT_GREATER_THAN",
		},
	];
}

// macOS overlay: Cmd+Arrow stands in for the cursor keys (the OS reserves
// Ctrl+Arrow for Mission Control), and Option+Arrow drives the 1200XL function
// keys F1–F4 (cursor up/down/left/right by default), with Ctrl/Shift variants.
const macBindings: Binding[] = [
	{ on: { key: "ArrowUp" }, meta: true, command: "PRESS_CONTROL_MINUS" },
	{ on: { key: "ArrowDown" }, meta: true, command: "PRESS_CONTROL_EQUALS" },
	{ on: { key: "ArrowLeft" }, meta: true, command: "PRESS_CONTROL_PLUS" },
	{ on: { key: "ArrowRight" }, meta: true, command: "PRESS_CONTROL_ASTERISK" },
	// Cmd+-/Cmd+= → Shift+Clear / insert-line (see editKeys).
	...editKeys({ meta: true }),
	// Option+Arrow → F1–F4 (+ Ctrl/Shift). Option (not plain Alt) avoids the
	// Windows snags noted on `base` above — hence mac-only.
	...modVariants({ key: "ArrowUp" }, "F1", { alt: true }),
	...modVariants({ key: "ArrowDown" }, "F2", { alt: true }),
	...modVariants({ key: "ArrowLeft" }, "F3", { alt: true }),
	...modVariants({ key: "ArrowRight" }, "F4", { alt: true }),
];

// Windows/Linux overlay: Alt stands in for Ctrl on just the keys the browser
// grabs — Ctrl+digit (tab select / zoom) and Ctrl+N/T/W/L/O (new window / tab /
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
	// Alt+-/Alt+= → Shift+Clear / insert-line (editKeys; Cmd's stand-in on Windows).
	...editKeys({ alt: true }),
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
	Space: "SPACE",
};

// Each position → its four exact-modifier bindings (see modVariants), tagged
// positional-only. Exported so the keyboard can resolve Ctrl (and Windows Alt)
// combos against the character-key layer alone.
export const positional: Binding[] = Object.entries(positionalKeys).flatMap(
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
 * The full default binding set for a platform: the platform-agnostic bindings
 * plus the positional layer, with the platform overlay merged in — macOS
 * (Cmd/Option+Arrow) on Mac, the Windows/Linux Alt-for-Ctrl aliases elsewhere.
 * One flat set tagged by `mode`; {@link bindingsForMode} narrows it for a mode.
 * This is what the binding store persists (and the customization UI edits).
 */
export function defaultBindingSet(mac: boolean): Binding[] {
	return overlay([...base, ...positional], mac ? macBindings : winBindings);
}

/** The bindings in `flat` active in `mode`: those whose `mode` matches, or is
 *  absent (= both). The positional character layer drops out in Character mode. */
export function bindingsForMode(
	flat: Binding[],
	mode: KeyboardMode,
): Binding[] {
	return flat.filter((b) => b.mode === undefined || b.mode === mode);
}

/** The effective default bindings for a mode + platform — the per-mode view of
 *  {@link defaultBindingSet}. */
export function defaultBindings(mac: boolean, mode: KeyboardMode): Binding[] {
	return bindingsForMode(defaultBindingSet(mac), mode);
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
 * A binding's display label: its committed `label` if set (the persisted,
 * user-editable legend), else — for `code` keys — the live layout map, else the
 * QWERTY legend / key name. Modifier prefixes (Ctrl+/Shift+) are the caller's to
 * add. Used both to bake labels into the defaults (no `label` yet → resolves
 * from the layout) and to read them back for display.
 */
export function labelFor(b: Binding, layout: Map<string, string>): string {
	if ("code" in b.on) {
		return b.label ?? layout.get(b.on.code) ?? qwertyLabel(b.on.code);
	}
	return b.label ?? qwertyLabel(b.on.key);
}

// Committed bindings carry their `label`, so chord display needs no layout map.
const NO_LAYOUT = new Map<string, string>();

/**
 * A binding's full chord for display: the required-modifier prefixes (in a fixed
 * order; `"any"` modifiers are device-agnostic so omitted) + the key legend.
 * `mac` picks Cmd/Opt over Meta/Alt.
 */
export function chordLabel(b: Binding, mac: boolean): string {
	const parts: string[] = [];
	if (b.ctrl === true) parts.push("Ctrl");
	if (b.meta === true) parts.push(mac ? "Cmd" : "Meta");
	if (b.alt === true) parts.push(mac ? "Opt" : "Alt");
	if (b.shift === true) parts.push("Shift");
	parts.push(labelFor(b, NO_LAYOUT));
	return parts.join("+");
}

/**
 * Each command's primary (first-listed) trigger chord, for showing the shortcut
 * next to a command. Commands with no binding are absent.
 */
export function primaryChords(
	flat: Binding[],
	mac: boolean,
): Map<Command, string> {
	const chords = new Map<Command, string>();
	for (const b of flat) {
		if (!chords.has(b.command)) chords.set(b.command, chordLabel(b, mac));
	}
	return chords;
}
