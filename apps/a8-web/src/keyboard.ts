import { commands } from "./commands.ts";

type Command = keyof typeof commands;

// How long a composed character (arriving without a correlatable keydown)
// stays pressed before the synthetic release. ~3 frames is plenty for the OS
// keyboard IRQ handler.
const TAP_MS = 50;

/**
 * Layout-aware keyboard handling: host keystrokes are mapped by the character
 * they produce, so the user's native layout works; special keys and the `Mod`
 * (Alt/Option) Ctrl layer are resolved from keydown events.
 *
 * Keystrokes are observed on an (offscreen) input element rather than the
 * window so that dead-key composition works — the composed character arrives
 * via `compositionend`.
 */
export class Keyboard {
	#dispatch: (command: Command) => void;
	#isMac = navigator.userAgent.includes("Mac");

	// Physical keys (event.code) currently holding the POKEY matrix key.
	#matrixHeld = new Set<string>();
	// Physical keys holding a key with a dedicated release command.
	#held = new Map<string, Command>();
	// Bumped on every matrix press so composition taps can tell whether the
	// matrix is still theirs to release.
	#pressGeneration = 0;

	constructor(dispatch: (command: Command) => void) {
		this.#dispatch = dispatch;
	}

	attach(input: HTMLInputElement): void {
		input.addEventListener("keydown", (event) => this.#keyDown(event));
		input.addEventListener("keyup", (event) => this.#keyUp(event));
		input.addEventListener("compositionend", (event) => {
			this.#composedText(event.data);
			input.value = "";
		});
		input.addEventListener("input", (event) => {
			if (!(event as InputEvent).isComposing) input.value = "";
		});
	}

	/** Release everything held — call when the window loses focus. */
	releaseAll(): void {
		if (this.#matrixHeld.size > 0) {
			this.#matrixHeld.clear();
			this.#dispatch("RELEASE_POKEY_KEY");
		}
		for (const release of this.#held.values()) {
			this.#dispatch(release);
		}
		this.#held.clear();
		this.#dispatch("RELEASE_SHIFT");
	}

	#keyDown(event: KeyboardEvent): void {
		// Cmd combos belong to the browser/OS; the emulator never binds Meta.
		if (event.metaKey) return;

		// The emulated OS does its own key repeat off the held-key senses;
		// host auto-repeat would stack a second repeat on top of it.
		if (event.repeat) {
			event.preventDefault();
			return;
		}

		if (event.key === "Shift") {
			this.#dispatch("PRESS_SHIFT");
			return;
		}
		if (event.key === "Control" || event.key === "Alt") return;

		// AltGr is character input, never the Mod layer (it reports as
		// Ctrl+Alt on Windows).
		const altGraph = event.getModifierState("AltGraph");
		const ctrl = event.ctrlKey && !altGraph;
		const mod = event.altKey && !altGraph;
		const shift = event.shiftKey;

		if (this.#specialKey(event, ctrl, shift, mod)) return;

		if (mod) {
			// macOS character-first rule: an Option combo that types a
			// character the Atari has is typing, not a shortcut.
			if (this.#isMac && event.key.length === 1) {
				const command = DEFAULT_LAYOUT_AWARE_MAPPINGS[event.key];
				if (command) {
					this.#pressMatrix(event, command);
					return;
				}
			}
			this.#modCombo(event, shift);
			return;
		}

		// Let dead keys start a composition in the input element; the result
		// arrives via compositionend.
		if (event.key === "Dead") return;

		if (event.key.length !== 1) return;

		if (ctrl) {
			this.#ctrlCombo(event, shift);
			return;
		}

		// Plain typing, resolved by the composed character.
		const command =
			(shift
				? DEFAULT_LAYOUT_AWARE_MAPPINGS[`Shift+${event.key}`]
				: undefined) ?? DEFAULT_LAYOUT_AWARE_MAPPINGS[event.key];
		if (command) this.#pressMatrix(event, command);
	}

	#keyUp(event: KeyboardEvent): void {
		if (event.key === "Shift" && !event.getModifierState("Shift")) {
			this.#dispatch("RELEASE_SHIFT");
			return;
		}

		const release = this.#held.get(event.code);
		if (release) {
			this.#held.delete(event.code);
			this.#dispatch(release);
		}

		if (this.#matrixHeld.delete(event.code) && this.#matrixHeld.size === 0) {
			this.#dispatch("RELEASE_POKEY_KEY");
		}
	}

	/** Special keys: console keys, Reset, Break, and the matrix specials. */
	#specialKey(
		event: KeyboardEvent,
		ctrl: boolean,
		shift: boolean,
		mod: boolean,
	): boolean {
		switch (event.key) {
			case "F5":
				if (ctrl) {
					this.#instant(event, "POWER_CYCLE");
				} else {
					// Plain F5 is Reset. With physical Shift held the machine
					// sees Shift+Reset, which OS ROM replacements can sense.
					this.#pressHeld(event, "PRESS_RESET", "RELEASE_RESET");
				}
				return true;
			case "F2":
				this.#pressHeld(event, "PRESS_OPTION", "RELEASE_OPTION");
				return true;
			case "F3":
				this.#pressHeld(event, "PRESS_SELECT", "RELEASE_SELECT");
				return true;
			case "F4":
				this.#pressHeld(event, "PRESS_START", "RELEASE_START");
				return true;
			case "F9":
			case "Pause":
				// A Break release is not observable by software: no key-up.
				this.#instant(event, "PRESS_BREAK");
				return true;
			case "F1":
				return this.#pressComposed(event, "HELP", ctrl, shift);
			case "F6":
				return this.#pressComposed(event, "INVERSE_VIDEO", ctrl, shift);
			case "F7":
				return this.#pressComposed(event, "CAPS", ctrl, shift);
			case "F8":
			case "Escape":
				return this.#pressComposed(event, "ESC", ctrl, shift);
			case "Tab":
				return this.#pressComposed(event, "TAB", ctrl, shift);
			case "Enter":
				return this.#pressComposed(event, "RETURN", ctrl, shift);
			case "Backspace":
				return this.#pressComposed(event, "BACKSPACE", ctrl, shift);
			case "Delete":
				// Delete character (Ctrl+Backspace); with Shift it's the
				// Delete Line combo (Shift+Backspace) instead.
				return this.#pressComposed(event, "BACKSPACE", !shift, shift);
			case "Insert":
				// Insert character (Ctrl+>); with Shift, Insert Line (Shift+>).
				return this.#pressComposed(event, "GREATER_THAN", !shift, shift);
			case "Home":
				return this.#pressComposed(event, "LESS_THAN", true, false); // Clear
			case "ArrowUp":
				return mod
					? this.#pressComposed(event, "F1", ctrl, shift)
					: this.#pressComposed(event, "MINUS", true, shift);
			case "ArrowDown":
				return mod
					? this.#pressComposed(event, "F2", ctrl, shift)
					: this.#pressComposed(event, "EQUALS", true, shift);
			case "ArrowLeft":
				return mod
					? this.#pressComposed(event, "F3", ctrl, shift)
					: this.#pressComposed(event, "PLUS", true, shift);
			case "ArrowRight":
				return mod
					? this.#pressComposed(event, "F4", ctrl, shift)
					: this.#pressComposed(event, "ASTERISK", true, shift);
		}
		return false;
	}

	/**
	 * The Mod (Alt/Option) Ctrl layer: `Mod+<letter>` is `Ctrl+<letter>`
	 * except for the remapped slots (see keyboard.md). Physical Ctrl adds
	 * nothing — Mod already means Ctrl.
	 */
	#modCombo(event: KeyboardEvent, shift: boolean): void {
		const letter = this.#baseLetter(event);
		if (!letter) return; // Mod+digit and friends are deliberately unbound

		switch (letter) {
			case "K":
				// TODO: TOGGLE_KEYBOARD_LAYOUT_MODE once raw mode exists.
				event.preventDefault();
				return;
			case "L":
				this.#pressComposed(event, "LESS_THAN", true, shift); // Clear
				return;
			case "I":
				// Insert character; with Shift, the Insert Line combo.
				this.#pressComposed(event, "GREATER_THAN", !shift, shift);
				return;
			case "D":
				this.#pressComposed(event, "FULL_STOP", true, shift); // Diamond
				return;
			case "E":
				this.#pressComposed(event, "SEMICOLON", true, shift); // Spade
				return;
			case "H":
				this.#pressComposed(event, "COMMA", true, shift); // Heart
				return;
			case "U":
				this.#pressComposed(event, "SLASH", true, shift);
				return;
			default:
				this.#pressComposed(event, letter, true, shift);
		}
	}

	#ctrlCombo(event: KeyboardEvent, shift: boolean): void {
		const candidates: string[] = [];
		if (shift) candidates.push(`Control+Shift+${event.key}`);
		candidates.push(`Control+${event.key}`);

		// Shifted keys report the shifted character (Ctrl+Shift+2 → "@");
		// retry with the physical base for letters and digits.
		const base = this.#baseChar(event);
		if (base && base !== event.key) {
			if (shift) candidates.push(`Control+Shift+${base}`);
			candidates.push(`Control+${base}`);
		}

		for (const candidate of candidates) {
			const command = DEFAULT_LAYOUT_AWARE_MAPPINGS[candidate];
			if (command) {
				this.#pressMatrix(event, command);
				return;
			}
		}
	}

	/**
	 * Press the matrix key composed from a base command suffix and modifiers
	 * (`PRESS_[CONTROL_][SHIFT_]<base>`). Always consumes the event.
	 */
	#pressComposed(
		event: KeyboardEvent,
		base: string,
		ctrl: boolean,
		shift: boolean,
	): boolean {
		const name = `PRESS_${ctrl ? "CONTROL_" : ""}${shift ? "SHIFT_" : ""}${base}`;
		if (name in commands) {
			this.#pressMatrix(event, name as Command);
		} else {
			event.preventDefault();
		}
		return true;
	}

	#pressMatrix(event: KeyboardEvent, command: Command): void {
		event.preventDefault();
		this.#pressGeneration++;
		this.#dispatch(command);
		this.#matrixHeld.add(event.code);
	}

	#pressHeld(event: KeyboardEvent, press: Command, release: Command): void {
		event.preventDefault();
		this.#dispatch(press);
		this.#held.set(event.code, release);
	}

	#instant(event: KeyboardEvent, command: Command): void {
		event.preventDefault();
		this.#dispatch(command);
	}

	/** Characters delivered by dead-key composition (e.g. `^` + space). */
	#composedText(data: string): void {
		for (const char of data) {
			const command = DEFAULT_LAYOUT_AWARE_MAPPINGS[char];
			if (command) this.#tap(command);
		}
	}

	/** Press with a synthetic release — there is no keyup to correlate. */
	#tap(command: Command): void {
		this.#pressGeneration++;
		const generation = this.#pressGeneration;
		this.#dispatch(command);
		setTimeout(() => {
			if (generation === this.#pressGeneration && this.#matrixHeld.size === 0) {
				this.#dispatch("RELEASE_POKEY_KEY");
			}
		}, TAP_MS);
	}

	/** The letter for the Mod Ctrl layer: from `key`, or the physical key on
	 * macOS where Option composes `key` into special characters. */
	#baseLetter(event: KeyboardEvent): string | null {
		if (/^[a-z]$/i.test(event.key)) return event.key.toUpperCase();
		const match = /^Key([A-Z])$/.exec(event.code);
		return match ? match[1]! : null;
	}

	#baseChar(event: KeyboardEvent): string | null {
		const key = /^Key([A-Z])$/.exec(event.code);
		if (key) return key[1]!.toLowerCase();
		const digit = /^Digit([0-9])$/.exec(event.code);
		return digit ? digit[1]! : null;
	}
}

/**
 * The character → command map for layout-aware mode. Keyed by the character
 * the host keystroke produces (optionally prefixed by `Shift+`/`Control+`
 * when those modifiers are physically held), so it works on any host layout.
 */
const DEFAULT_LAYOUT_AWARE_MAPPINGS: Record<string, Command> = {
	"!": "PRESS_SHIFT_1",
	'"': "PRESS_SHIFT_2",
	"#": "PRESS_SHIFT_3",
	$: "PRESS_SHIFT_4",
	"%": "PRESS_SHIFT_5",
	"&": "PRESS_SHIFT_6",
	"'": "PRESS_SHIFT_7",
	"(": "PRESS_SHIFT_9",
	")": "PRESS_SHIFT_0",
	"*": "PRESS_ASTERISK",
	"+": "PRESS_PLUS",
	",": "PRESS_COMMA",
	"-": "PRESS_MINUS",
	".": "PRESS_FULL_STOP",
	"/": "PRESS_SLASH",
	"0": "PRESS_0",
	"1": "PRESS_1",
	"2": "PRESS_2",
	"3": "PRESS_3",
	"4": "PRESS_4",
	"5": "PRESS_5",
	"6": "PRESS_6",
	"7": "PRESS_7",
	"8": "PRESS_8",
	"9": "PRESS_9",
	":": "PRESS_SHIFT_SEMICOLON",
	";": "PRESS_SEMICOLON",
	"<": "PRESS_LESS_THAN",
	"=": "PRESS_EQUALS",
	">": "PRESS_GREATER_THAN",
	"?": "PRESS_SHIFT_SLASH",
	"@": "PRESS_SHIFT_8",
	A: "PRESS_A",
	B: "PRESS_B",
	C: "PRESS_C",
	D: "PRESS_D",
	E: "PRESS_E",
	F: "PRESS_F",
	G: "PRESS_G",
	H: "PRESS_H",
	I: "PRESS_I",
	J: "PRESS_J",
	K: "PRESS_K",
	L: "PRESS_L",
	M: "PRESS_M",
	N: "PRESS_N",
	O: "PRESS_O",
	P: "PRESS_P",
	Q: "PRESS_Q",
	R: "PRESS_R",
	S: "PRESS_S",
	T: "PRESS_T",
	U: "PRESS_U",
	V: "PRESS_V",
	W: "PRESS_W",
	X: "PRESS_X",
	Y: "PRESS_Y",
	Z: "PRESS_Z",
	"[": "PRESS_SHIFT_COMMA",
	"\\": "PRESS_SHIFT_PLUS",
	"]": "PRESS_SHIFT_FULL_STOP",
	"^": "PRESS_SHIFT_ASTERISK",
	_: "PRESS_SHIFT_MINUS",
	a: "PRESS_A",
	b: "PRESS_B",
	c: "PRESS_C",
	d: "PRESS_D",
	e: "PRESS_E",
	f: "PRESS_F",
	g: "PRESS_G",
	h: "PRESS_H",
	i: "PRESS_I",
	j: "PRESS_J",
	k: "PRESS_K",
	l: "PRESS_L",
	m: "PRESS_M",
	n: "PRESS_N",
	o: "PRESS_O",
	p: "PRESS_P",
	q: "PRESS_Q",
	r: "PRESS_R",
	s: "PRESS_S",
	t: "PRESS_T",
	u: "PRESS_U",
	v: "PRESS_V",
	w: "PRESS_W",
	x: "PRESS_X",
	y: "PRESS_Y",
	z: "PRESS_Z",
	"|": "PRESS_SHIFT_EQUALS",
	" ": "PRESS_SPACE",

	"Shift+A": "PRESS_SHIFT_A",
	"Shift+a": "PRESS_SHIFT_A",
	"Shift+B": "PRESS_SHIFT_B",
	"Shift+b": "PRESS_SHIFT_B",
	"Shift+C": "PRESS_SHIFT_C",
	"Shift+c": "PRESS_SHIFT_C",
	"Shift+D": "PRESS_SHIFT_D",
	"Shift+d": "PRESS_SHIFT_D",
	"Shift+E": "PRESS_SHIFT_E",
	"Shift+e": "PRESS_SHIFT_E",
	"Shift+F": "PRESS_SHIFT_F",
	"Shift+f": "PRESS_SHIFT_F",
	"Shift+G": "PRESS_SHIFT_G",
	"Shift+g": "PRESS_SHIFT_G",
	"Shift+H": "PRESS_SHIFT_H",
	"Shift+h": "PRESS_SHIFT_H",
	"Shift+I": "PRESS_SHIFT_I",
	"Shift+i": "PRESS_SHIFT_I",
	"Shift+J": "PRESS_SHIFT_J",
	"Shift+j": "PRESS_SHIFT_J",
	"Shift+K": "PRESS_SHIFT_K",
	"Shift+k": "PRESS_SHIFT_K",
	"Shift+L": "PRESS_SHIFT_L",
	"Shift+l": "PRESS_SHIFT_L",
	"Shift+M": "PRESS_SHIFT_M",
	"Shift+m": "PRESS_SHIFT_M",
	"Shift+N": "PRESS_SHIFT_N",
	"Shift+n": "PRESS_SHIFT_N",
	"Shift+O": "PRESS_SHIFT_O",
	"Shift+o": "PRESS_SHIFT_O",
	"Shift+P": "PRESS_SHIFT_P",
	"Shift+p": "PRESS_SHIFT_P",
	"Shift+Q": "PRESS_SHIFT_Q",
	"Shift+q": "PRESS_SHIFT_Q",
	"Shift+R": "PRESS_SHIFT_R",
	"Shift+r": "PRESS_SHIFT_R",
	"Shift+S": "PRESS_SHIFT_S",
	"Shift+s": "PRESS_SHIFT_S",
	"Shift+T": "PRESS_SHIFT_T",
	"Shift+t": "PRESS_SHIFT_T",
	"Shift+U": "PRESS_SHIFT_U",
	"Shift+u": "PRESS_SHIFT_U",
	"Shift+V": "PRESS_SHIFT_V",
	"Shift+v": "PRESS_SHIFT_V",
	"Shift+W": "PRESS_SHIFT_W",
	"Shift+w": "PRESS_SHIFT_W",
	"Shift+X": "PRESS_SHIFT_X",
	"Shift+x": "PRESS_SHIFT_X",
	"Shift+Y": "PRESS_SHIFT_Y",
	"Shift+y": "PRESS_SHIFT_Y",
	"Shift+Z": "PRESS_SHIFT_Z",
	"Shift+z": "PRESS_SHIFT_Z",
	"Shift+ ": "PRESS_SHIFT_SPACE",

	"Control+A": "PRESS_CONTROL_A",
	"Control+a": "PRESS_CONTROL_A",
	"Control+B": "PRESS_CONTROL_B",
	"Control+b": "PRESS_CONTROL_B",
	"Control+C": "PRESS_CONTROL_C",
	"Control+c": "PRESS_CONTROL_C",
	"Control+D": "PRESS_CONTROL_D",
	"Control+d": "PRESS_CONTROL_D",
	"Control+E": "PRESS_CONTROL_E",
	"Control+e": "PRESS_CONTROL_E",
	"Control+F": "PRESS_CONTROL_F",
	"Control+f": "PRESS_CONTROL_F",
	"Control+G": "PRESS_CONTROL_G",
	"Control+g": "PRESS_CONTROL_G",
	"Control+H": "PRESS_CONTROL_H",
	"Control+h": "PRESS_CONTROL_H",
	"Control+I": "PRESS_CONTROL_I",
	"Control+i": "PRESS_CONTROL_I",
	"Control+J": "PRESS_CONTROL_J",
	"Control+j": "PRESS_CONTROL_J",
	"Control+K": "PRESS_CONTROL_K",
	"Control+k": "PRESS_CONTROL_K",
	"Control+L": "PRESS_CONTROL_L",
	"Control+l": "PRESS_CONTROL_L",
	"Control+M": "PRESS_CONTROL_M",
	"Control+m": "PRESS_CONTROL_M",
	"Control+N": "PRESS_CONTROL_N",
	"Control+n": "PRESS_CONTROL_N",
	"Control+O": "PRESS_CONTROL_O",
	"Control+o": "PRESS_CONTROL_O",
	"Control+P": "PRESS_CONTROL_P",
	"Control+p": "PRESS_CONTROL_P",
	"Control+Q": "PRESS_CONTROL_Q",
	"Control+q": "PRESS_CONTROL_Q",
	"Control+R": "PRESS_CONTROL_R",
	"Control+r": "PRESS_CONTROL_R",
	"Control+S": "PRESS_CONTROL_S",
	"Control+s": "PRESS_CONTROL_S",
	"Control+T": "PRESS_CONTROL_T",
	"Control+t": "PRESS_CONTROL_T",
	"Control+U": "PRESS_CONTROL_U",
	"Control+u": "PRESS_CONTROL_U",
	"Control+V": "PRESS_CONTROL_V",
	"Control+v": "PRESS_CONTROL_V",
	"Control+W": "PRESS_CONTROL_W",
	"Control+w": "PRESS_CONTROL_W",
	"Control+X": "PRESS_CONTROL_X",
	"Control+x": "PRESS_CONTROL_X",
	"Control+Y": "PRESS_CONTROL_Y",
	"Control+y": "PRESS_CONTROL_Y",
	"Control+Z": "PRESS_CONTROL_Z",
	"Control+z": "PRESS_CONTROL_Z",

	"Control+0": "PRESS_CONTROL_0",
	"Control+1": "PRESS_CONTROL_1",
	"Control+2": "PRESS_CONTROL_2",
	"Control+3": "PRESS_CONTROL_3",
	"Control+4": "PRESS_CONTROL_4",
	"Control+5": "PRESS_CONTROL_5",
	"Control+6": "PRESS_CONTROL_6",
	"Control+7": "PRESS_CONTROL_7",
	"Control+8": "PRESS_CONTROL_8",
	"Control+9": "PRESS_CONTROL_9",

	"Control+;": "PRESS_CONTROL_SEMICOLON",
	"Control+:": "PRESS_CONTROL_SEMICOLON",

	"Control+,": "PRESS_CONTROL_COMMA",
	"Control+[": "PRESS_CONTROL_COMMA",

	"Control+.": "PRESS_CONTROL_FULL_STOP",
	"Control+]": "PRESS_CONTROL_FULL_STOP",

	"Control+/": "PRESS_CONTROL_SLASH",
	"Control+?": "PRESS_CONTROL_SLASH",

	"Control++": "PRESS_CONTROL_PLUS",
	"Control+\\": "PRESS_CONTROL_PLUS",
	"Control+*": "PRESS_CONTROL_ASTERISK",
	"Control+^": "PRESS_CONTROL_ASTERISK",
	"Control+-": "PRESS_CONTROL_MINUS",
	"Control+_": "PRESS_CONTROL_MINUS",
	"Control+=": "PRESS_CONTROL_EQUALS",
	"Control+|": "PRESS_CONTROL_EQUALS",
	"Control+ ": "PRESS_CONTROL_SPACE",

	"Control+Shift+A": "PRESS_CONTROL_SHIFT_A",
	"Control+Shift+a": "PRESS_CONTROL_SHIFT_A",
	"Control+Shift+B": "PRESS_CONTROL_SHIFT_B",
	"Control+Shift+b": "PRESS_CONTROL_SHIFT_B",
	"Control+Shift+C": "PRESS_CONTROL_SHIFT_C",
	"Control+Shift+c": "PRESS_CONTROL_SHIFT_C",
	"Control+Shift+D": "PRESS_CONTROL_SHIFT_D",
	"Control+Shift+d": "PRESS_CONTROL_SHIFT_D",
	"Control+Shift+E": "PRESS_CONTROL_SHIFT_E",
	"Control+Shift+e": "PRESS_CONTROL_SHIFT_E",
	"Control+Shift+F": "PRESS_CONTROL_SHIFT_F",
	"Control+Shift+f": "PRESS_CONTROL_SHIFT_F",
	"Control+Shift+G": "PRESS_CONTROL_SHIFT_G",
	"Control+Shift+g": "PRESS_CONTROL_SHIFT_G",
	"Control+Shift+H": "PRESS_CONTROL_SHIFT_H",
	"Control+Shift+h": "PRESS_CONTROL_SHIFT_H",
	"Control+Shift+I": "PRESS_CONTROL_SHIFT_I",
	"Control+Shift+i": "PRESS_CONTROL_SHIFT_I",
	"Control+Shift+J": "PRESS_CONTROL_SHIFT_J",
	"Control+Shift+j": "PRESS_CONTROL_SHIFT_J",
	"Control+Shift+K": "PRESS_CONTROL_SHIFT_K",
	"Control+Shift+k": "PRESS_CONTROL_SHIFT_K",
	"Control+Shift+L": "PRESS_CONTROL_SHIFT_L",
	"Control+Shift+l": "PRESS_CONTROL_SHIFT_L",
	"Control+Shift+M": "PRESS_CONTROL_SHIFT_M",
	"Control+Shift+m": "PRESS_CONTROL_SHIFT_M",
	"Control+Shift+N": "PRESS_CONTROL_SHIFT_N",
	"Control+Shift+n": "PRESS_CONTROL_SHIFT_N",
	"Control+Shift+O": "PRESS_CONTROL_SHIFT_O",
	"Control+Shift+o": "PRESS_CONTROL_SHIFT_O",
	"Control+Shift+P": "PRESS_CONTROL_SHIFT_P",
	"Control+Shift+p": "PRESS_CONTROL_SHIFT_P",
	"Control+Shift+Q": "PRESS_CONTROL_SHIFT_Q",
	"Control+Shift+q": "PRESS_CONTROL_SHIFT_Q",
	"Control+Shift+R": "PRESS_CONTROL_SHIFT_R",
	"Control+Shift+r": "PRESS_CONTROL_SHIFT_R",
	"Control+Shift+S": "PRESS_CONTROL_SHIFT_S",
	"Control+Shift+s": "PRESS_CONTROL_SHIFT_S",
	"Control+Shift+T": "PRESS_CONTROL_SHIFT_T",
	"Control+Shift+t": "PRESS_CONTROL_SHIFT_T",
	"Control+Shift+U": "PRESS_CONTROL_SHIFT_U",
	"Control+Shift+u": "PRESS_CONTROL_SHIFT_U",
	"Control+Shift+V": "PRESS_CONTROL_SHIFT_V",
	"Control+Shift+v": "PRESS_CONTROL_SHIFT_V",
	"Control+Shift+W": "PRESS_CONTROL_SHIFT_W",
	"Control+Shift+w": "PRESS_CONTROL_SHIFT_W",
	"Control+Shift+X": "PRESS_CONTROL_SHIFT_X",
	"Control+Shift+x": "PRESS_CONTROL_SHIFT_X",
	"Control+Shift+Y": "PRESS_CONTROL_SHIFT_Y",
	"Control+Shift+y": "PRESS_CONTROL_SHIFT_Y",
	"Control+Shift+Z": "PRESS_CONTROL_SHIFT_Z",
	"Control+Shift+z": "PRESS_CONTROL_SHIFT_Z",

	"Control+Shift+0": "PRESS_CONTROL_SHIFT_0",
	"Control+Shift+1": "PRESS_CONTROL_SHIFT_1",
	"Control+Shift+2": "PRESS_CONTROL_SHIFT_2",
	"Control+Shift+3": "PRESS_CONTROL_SHIFT_3",
	"Control+Shift+4": "PRESS_CONTROL_SHIFT_4",
	"Control+Shift+5": "PRESS_CONTROL_SHIFT_5",
	"Control+Shift+6": "PRESS_CONTROL_SHIFT_6",
	"Control+Shift+7": "PRESS_CONTROL_SHIFT_7",
	"Control+Shift+8": "PRESS_CONTROL_SHIFT_8",
	"Control+Shift+9": "PRESS_CONTROL_SHIFT_9",
	"Control+Shift+ ": "PRESS_CONTROL_SHIFT_SPACE",
};
