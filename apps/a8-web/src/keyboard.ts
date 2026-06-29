import { charCommand } from "./char-keys.ts";
import { type Command, MATRIX_COMMANDS } from "./commands.ts";
import {
	type Binding,
	defaultBindings,
	type KeyboardMode,
	type KeyEventLike,
	resolveBinding,
} from "./key-bindings.ts";

/**
 * How the keyboard actuates commands. A physical key is sustained: `press` on
 * key-down, `release` on key-up. `tap` is momentary (a composed character) — it
 * presses and schedules its own release. `releaseMatrix` lets up the shared POKEY
 * matrix register once the last held matrix key is up.
 */
export interface KeyboardActions {
	press(command: Command): void;
	release(command: Command): void;
	tap(command: Command): void;
	releaseMatrix(): void;
}

/**
 * Translates host keyboard events into Atari key actions by resolving them
 * against the binding table ({@link defaultBindings}) for the active mode, with
 * the character channel ({@link charKeys}) as the Character-mode fallback for
 * printable characters. The mode is read live per keystroke.
 *
 * Keystrokes are observed on an (offscreen) input element rather than the window
 * so that dead-key composition works — the composed glyph arrives via
 * `compositionend`.
 */
export class Keyboard {
	#actions: KeyboardActions;
	#getMode: () => KeyboardMode;
	#isMac = navigator.userAgent.includes("Mac");

	// The binding set per mode, precomputed (platform is fixed for the session).
	#bindings: Record<KeyboardMode, Binding[]>;

	// Physical keys (event.code) currently holding a POKEY matrix key (one shared
	// register, released only when the set empties).
	#matrixHeld = new Set<string>();
	// Physical keys holding a non-matrix sustained command (its own key-up releases
	// it): console buttons, Reset, joystick, the Shift keys.
	#held = new Map<string, Command>();

	constructor(actions: KeyboardActions, getMode: () => KeyboardMode) {
		this.#actions = actions;
		this.#getMode = getMode;
		this.#bindings = {
			character: defaultBindings(this.#isMac, "character"),
			positional: defaultBindings(this.#isMac, "positional"),
		};
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

		// The function keys the emulator maps (F1–F12) collide with browser
		// shortcuts — most damagingly F5 (reload → a cold boot). The input's own
		// handler preventDefaults them when focused, but a window-level guard stops
		// the browser action even when focus has drifted onto a menu button.
		window.addEventListener(
			"keydown",
			(event) => {
				if (/^F([1-9]|1[0-2])$/.test(event.key)) event.preventDefault();
			},
			true,
		);
	}

	/** Release everything held — call when the window loses focus. */
	releaseAll(): void {
		if (this.#matrixHeld.size > 0) {
			this.#matrixHeld.clear();
			this.#actions.releaseMatrix();
		}
		for (const command of this.#held.values()) this.#actions.release(command);
		this.#held.clear();
	}

	// A keyboard event reduced to identity + modifier states. AltGr's false Ctrl
	// (Windows reports it as Ctrl+Alt) is excluded so it stays character input.
	#normalize(event: KeyboardEvent): KeyEventLike {
		const altGraph = event.getModifierState("AltGraph");
		return {
			code: event.code,
			key: event.key,
			shift: event.shiftKey,
			ctrl: event.ctrlKey && !altGraph,
			alt: event.altKey && !altGraph,
			meta: event.metaKey,
		};
	}

	#keyDown(event: KeyboardEvent): void {
		// The emulated OS does its own key repeat off the held-key senses; host
		// auto-repeat would stack a second repeat on top of it.
		if (event.repeat) {
			event.preventDefault();
			return;
		}

		const e = this.#normalize(event);
		const mode = this.#getMode();
		const command =
			resolveBinding(this.#bindings[mode], e)?.command ??
			(mode === "character" ? this.#typeCommand(event, e) : undefined);
		if (command) {
			event.preventDefault();
			this.#press(event.code, command);
		}
	}

	// The Atari command for a Character-mode keystroke that isn't a discrete
	// binding. Plain/Shift typing goes through the character channel (layout-aware,
	// by produced character); Ctrl combos — and any key whose character has no
	// ATASCII equivalent (e.g. Turkish ş) — resolve positionally by physical code.
	// Undefined for dead keys (composition handles them) and non-typing combos.
	#typeCommand(event: KeyboardEvent, e: KeyEventLike): Command | undefined {
		// Meta is the browser's; Alt is the (deferred) Mod layer — neither types.
		if (e.meta || e.alt) return undefined;
		// Ctrl resolves by code: the produced character is unreliable under Ctrl
		// (on some layouts different physical keys report the same one — Turkish
		// Ctrl+\ and Ctrl+, both report ","), whereas the code is stable.
		if (e.ctrl) return resolveBinding(this.#bindings.positional, e)?.command;
		if (event.key === "Dead") return undefined; // composition delivers the glyph
		if (event.key.length === 1) {
			const command = charCommand(event.key, e.shift);
			if (command) return command; // layout-aware ATASCII character
		}
		// No ATASCII equivalent (ş, ı, …) → the positional key at this location.
		return resolveBinding(this.#bindings.positional, e)?.command;
	}

	#keyUp(event: KeyboardEvent): void {
		// macOS browsers swallow keyups for other keys while Cmd is held, so a
		// Cmd+<key> matrix press (cursor arrows, the Cmd+-/= editing keys) may never
		// see its own keyup — release any held matrix key when Cmd itself is released.
		if (event.key === "Meta") {
			if (this.#matrixHeld.size > 0) {
				this.#matrixHeld.clear();
				this.#actions.releaseMatrix();
			}
			return;
		}

		const code = event.code;
		const held = this.#held.get(code);
		if (held) {
			this.#held.delete(code);
			this.#actions.release(held);
		}
		if (this.#matrixHeld.delete(code) && this.#matrixHeld.size === 0) {
			this.#actions.releaseMatrix();
		}
	}

	// Press a command, tracking the physical key so its key-up releases it. Matrix
	// keys share one register (released when the last is up); everything else
	// carries its own release.
	#press(code: string, command: Command): void {
		this.#actions.press(command);
		if (MATRIX_COMMANDS.has(command)) this.#matrixHeld.add(code);
		else this.#held.set(code, command);
	}

	// Characters delivered by dead-key composition (e.g. `^` then space). There's
	// no key-up to correlate, so each is a momentary tap (press + auto-release).
	#composedText(data: string): void {
		for (const char of data) {
			const command = charCommand(char, false);
			if (command) this.#actions.tap(command);
		}
	}
}
