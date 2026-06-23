import { useState } from "preact/hooks";
import { commands, type Command } from "./commands.ts";
import type { EmulatorHost } from "./host.ts";

/**
 * The on-screen keyboard view — a phone-style layout tuned for typing Atari
 * BASIC. Two layers (letters and numbers/symbols) plus a slim function strip
 * for the Atari-specific keys and a cursor cluster. Sticky Shift/Control
 * modifiers compose the right matrix command via the `PRESS_[CONTROL_][SHIFT_]
 * <BASE>` naming the command table already uses, so no new emulator input path
 * is needed — every key is the same momentary POKEY press the console buttons
 * already do.
 */

/** A sticky modifier: off, armed for the next key, or locked until tapped off. */
type Mod = "off" | "once" | "lock";

interface KeyBase {
	label: string;
	/** Flex weight within its row; defaults to 1. */
	flex?: number;
	/**
	 * Secondary legends shown while Shift / Control is armed — the Atari editing
	 * functions a key gains under those modifiers (e.g. `<` becomes Clear). The
	 * matrix command is composed from the modifiers regardless; these just label
	 * it.
	 */
	shiftLabel?: string;
	controlLabel?: string;
}

/**
 * A key in the layout. `char` keys carry a base token (matching the command
 * suffix, e.g. `A`, `1`, `SEMICOLON`) and recompose under Shift/Control. `lit`
 * keys are a fixed momentary POKEY command (a shifted glyph like `"` whose
 * meaning shouldn't shift again). `tap` fires once with no release (Break).
 * `mod`/`layer` drive the keyboard's own state.
 */
type Key =
	| (KeyBase & { t: "char"; base: string })
	| (KeyBase & { t: "lit"; cmd: Command })
	| (KeyBase & { t: "tap"; cmd: Command })
	| (KeyBase & { t: "mod"; mod: "shift" | "control" })
	| (KeyBase & { t: "layer" });

/** Backspace doubles as Delete-line (Shift) / Delete-char (Control). */
const BACKSPACE: Key = {
	t: "char",
	base: "BACKSPACE",
	label: "⌫",
	flex: 1.5,
	shiftLabel: "Del",
	controlLabel: "Del",
};

// Two slim strips above the main rows: the 1200XL function keys and Help, then
// the editing/cursor keys. Shown on every layer.
const FN_ROW_A: Key[] = [
	{ t: "char", base: "F1", label: "F1" },
	{ t: "char", base: "F2", label: "F2" },
	{ t: "char", base: "F3", label: "F3" },
	{ t: "char", base: "F4", label: "F4" },
	{ t: "char", base: "HELP", label: "Help" },
	{ t: "tap", cmd: "PRESS_BREAK", label: "Break" },
];

const FN_ROW_B: Key[] = [
	{ t: "char", base: "ESC", label: "Esc" },
	{ t: "char", base: "TAB", label: "Tab" },
	{ t: "char", base: "INVERSE_VIDEO", label: "Inv" },
	{ t: "lit", cmd: "PRESS_CONTROL_PLUS", label: "◀" },
	{ t: "lit", cmd: "PRESS_CONTROL_MINUS", label: "▲" },
	{ t: "lit", cmd: "PRESS_CONTROL_EQUALS", label: "▼" },
	{ t: "lit", cmd: "PRESS_CONTROL_ASTERISK", label: "▶" },
];

// The Atari shifted glyph for each digit, shown as a corner legend so it's
// discoverable. Only digits whose shifted symbol has no one-tap key of its own
// appear here — `"$()` live on the symbol row, so 2/4/9/0 are left blank to
// avoid showing the same glyph twice.
const DIGIT_SHIFT: Record<string, string> = {
	"1": "!",
	"3": "#",
	"5": "%",
	"6": "&",
	"7": "'",
	"8": "@",
};

const ABC_ROWS: Key[][] = [
	"QWERTYUIOP".split("").map((c) => ({ t: "char", base: c, label: c })),
	"ASDFGHJKL".split("").map((c) => ({ t: "char", base: c, label: c })),
	[
		{ t: "mod", mod: "shift", label: "⇧", flex: 1.5 },
		...["Z", "X", "C", "V", "B", "N", "M"].map(
			(c): Key => ({ t: "char", base: c, label: c }),
		),
		BACKSPACE,
	],
	[
		{ t: "layer", label: "123", flex: 1.5 },
		{ t: "mod", mod: "control", label: "Ctrl", flex: 1.5 },
		{ t: "char", base: "SPACE", label: "space", flex: 5 },
		{ t: "char", base: "RETURN", label: "⏎", flex: 2.5 },
	],
];

const SYM_ROWS: Key[][] = [
	"1234567890"
		.split("")
		.map((c) => ({ t: "char", base: c, label: c, shiftLabel: DIGIT_SHIFT[c] })),
	[
		{ t: "lit", cmd: "PRESS_SHIFT_2", label: '"' },
		{ t: "lit", cmd: "PRESS_SHIFT_4", label: "$" },
		{ t: "lit", cmd: "PRESS_SHIFT_SEMICOLON", label: ":" },
		{ t: "char", base: "SEMICOLON", label: ";" },
		{ t: "lit", cmd: "PRESS_SHIFT_9", label: "(" },
		{ t: "lit", cmd: "PRESS_SHIFT_0", label: ")" },
		{ t: "char", base: "EQUALS", label: "=", shiftLabel: "|" },
		{
			t: "char",
			base: "LESS_THAN",
			label: "<",
			shiftLabel: "Clr",
			controlLabel: "Clr",
		},
		{
			t: "char",
			base: "GREATER_THAN",
			label: ">",
			shiftLabel: "Ins",
			controlLabel: "Ins",
		},
	],
	[
		{ t: "mod", mod: "shift", label: "⇧", flex: 1.5 },
		{ t: "char", base: "PLUS", label: "+", shiftLabel: "\\" },
		{ t: "char", base: "MINUS", label: "-", shiftLabel: "_" },
		{ t: "char", base: "ASTERISK", label: "*", shiftLabel: "^" },
		{ t: "char", base: "SLASH", label: "/" },
		{ t: "char", base: "COMMA", label: ",", shiftLabel: "[" },
		{ t: "char", base: "PERIOD", label: ".", shiftLabel: "]" },
		{ t: "lit", cmd: "PRESS_SHIFT_SLASH", label: "?" },
		BACKSPACE,
	],
	[
		{ t: "layer", label: "ABC", flex: 1.5 },
		{ t: "mod", mod: "control", label: "Ctrl", flex: 1.5 },
		{ t: "char", base: "SPACE", label: "space", flex: 5 },
		{ t: "char", base: "RETURN", label: "⏎", flex: 2.5 },
	],
];

/** Compose the matrix command for a `char` key under the active modifiers. */
function charCommand(base: string, shift: boolean, control: boolean): Command {
	const name = `PRESS_${control ? "CONTROL_" : ""}${shift ? "SHIFT_" : ""}${base}`;
	// Not every base has every modifier combination spelled out; fall back to
	// the bare press so a key never silently does nothing.
	return (name in commands ? name : `PRESS_${base}`) as Command;
}

export function KeyboardView({ host }: { host: EmulatorHost }) {
	const [layer, setLayer] = useState<"abc" | "sym">("abc");
	const [shift, setShift] = useState<Mod>("off");
	const [control, setControl] = useState<Mod>("off");

	const shiftOn = shift !== "off";
	const controlOn = control !== "off";

	// A char/lit key consumes a one-shot modifier; a locked one stays.
	function consumeMods() {
		if (shift === "once") setShift("off");
		if (control === "once") setControl("off");
	}

	function cycle(m: Mod): Mod {
		return m === "off" ? "once" : m === "once" ? "lock" : "off";
	}

	const layerRows = layer === "abc" ? ABC_ROWS : SYM_ROWS;
	const allRows: { keys: Key[]; slim: boolean }[] = [
		{ keys: FN_ROW_A, slim: true },
		{ keys: FN_ROW_B, slim: true },
		...layerRows.map((keys) => ({ keys, slim: false })),
	];

	const onMod = (mod: "shift" | "control") =>
		mod === "shift" ? setShift(cycle) : setControl(cycle);
	const onLayer = () => setLayer((l) => (l === "abc" ? "sym" : "abc"));

	return (
		<div class="flex flex-col gap-1 select-none">
			{allRows.map(({ keys, slim }, i) => (
				<KeyRow
					key={i}
					keys={keys}
					slim={slim}
					host={host}
					shiftOn={shiftOn}
					controlOn={controlOn}
					consumeMods={consumeMods}
					shift={shift}
					control={control}
					onMod={onMod}
					onLayer={onLayer}
				/>
			))}
		</div>
	);
}

function KeyRow({
	keys,
	host,
	slim,
	shiftOn,
	controlOn,
	consumeMods,
	shift,
	control,
	onMod,
	onLayer,
}: {
	keys: Key[];
	host: EmulatorHost;
	slim?: boolean;
	shiftOn: boolean;
	controlOn: boolean;
	consumeMods: () => void;
	shift: Mod;
	control: Mod;
	onMod: (mod: "shift" | "control") => void;
	onLayer: () => void;
}) {
	return (
		<div class="flex gap-1">
			{keys.map((k, i) => (
				<KeyButton
					key={i}
					k={k}
					host={host}
					slim={slim}
					shiftOn={shiftOn}
					controlOn={controlOn}
					consumeMods={consumeMods}
					modState={
						k.t === "mod" ? (k.mod === "shift" ? shift : control) : "off"
					}
					onMod={onMod}
					onLayer={onLayer}
				/>
			))}
		</div>
	);
}

function KeyButton({
	k,
	host,
	slim,
	shiftOn,
	controlOn,
	consumeMods,
	modState,
	onMod,
	onLayer,
}: {
	k: Key;
	host: EmulatorHost;
	slim?: boolean;
	shiftOn: boolean;
	controlOn: boolean;
	consumeMods: () => void;
	modState: Mod;
	onMod: (mod: "shift" | "control") => void;
	onLayer: () => void;
}) {
	const flex = k.flex ?? 1;
	const base =
		"relative min-w-0 touch-none rounded text-white select-none flex items-center justify-center";
	const pad = slim ? "py-1 text-xs" : "py-3 text-sm";

	// Modifier keys carry their armed/locked state in their tint.
	let tint = "bg-neutral-700/70 active:bg-neutral-500";
	if (k.t === "mod") {
		if (modState === "lock") tint = "bg-sky-500/80";
		else if (modState === "once") tint = "bg-sky-700/70 ring-1 ring-sky-300";
	} else if (k.t === "layer") {
		tint = "bg-neutral-600/70 active:bg-neutral-500";
	}

	const label =
		(controlOn && k.controlLabel) || (shiftOn && k.shiftLabel) || k.label;

	// A single-character shifted glyph (e.g. `!` on the `1` key) is shown dim in
	// the corner so it's discoverable — but not while it's already the main
	// label under an armed modifier, and not for word legends like "Clr".
	const corner =
		!shiftOn && !controlOn && k.shiftLabel?.length === 1 ? k.shiftLabel : null;

	function press(e: { preventDefault(): void }) {
		e.preventDefault();
		switch (k.t) {
			case "char":
				host.dispatch(charCommand(k.base, shiftOn, controlOn));
				break;
			case "lit":
				host.dispatch(k.cmd);
				break;
			case "tap":
				host.dispatch(k.cmd);
				consumeMods();
				break;
			case "mod":
				onMod(k.mod);
				break;
			case "layer":
				onLayer();
				break;
		}
	}

	function release(e: { preventDefault(): void }) {
		e.preventDefault();
		if (k.t === "char" || k.t === "lit") {
			host.dispatch("RELEASE_POKEY_KEY");
			consumeMods();
		}
	}

	return (
		<button
			type="button"
			style={{ flexGrow: flex, flexBasis: 0 }}
			class={`${base} ${pad} ${tint}`}
			onTouchStart={press}
			onTouchEnd={release}
			onTouchCancel={release}
		>
			{corner && (
				<span class="absolute top-0.5 right-1 text-[0.6rem] leading-none text-neutral-400">
					{corner}
				</span>
			)}
			{label}
		</button>
	);
}
