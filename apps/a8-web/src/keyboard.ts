import { charCommand } from "./char-keys.ts";
import { type Command, MATRIX_COMMANDS } from "./commands.ts";
import {
	type Binding,
	type KeyboardMode,
	type KeyEventLike,
	resolveBinding,
} from "./key-bindings.ts";

// While the key-binding editor is capturing a combo, the window-level global
// resolver stands down so the chord (e.g. Cmd+K) is captured, not dispatched.
let capturingKeys = false;
export function setCapturingKeys(active: boolean): void {
	capturingKeys = active;
}

// A key event's target is a real text field (or other keyboard-driven control)
// whose own key handling - typing, cursor keys, option navigation - we must not
// preempt. The offscreen emulator input is included: while it's focused the input
// handler already owns the key, so the window-level guard stands down.
function isEditable(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	const tag = target.tagName;
	return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * The command a Character-mode key event produces. The character channel wins
 * first: a key that types a printable ATASCII character (no Ctrl/Alt/Cmd) types
 * it - layout-aware, shadowing the bare/Shift character-key bindings. Everything
 * else falls through to `bindings`: modified combos (Ctrl resolves positionally),
 * named keys, and keys with no ATASCII character (ş, €) - which a binding can
 * still claim. Dead keys yield nothing; composition delivers the glyph instead.
 */
export function characterModeCommand(
	bindings: Binding[],
	e: KeyEventLike,
): Command | undefined {
	if (e.ctrl || e.alt || e.meta) return resolveBinding(bindings, e)?.command;
	if (e.key === "Dead") return undefined;
	if (e.key.length === 1) {
		const command = charCommand(e.key, e.shift);
		if (command) return command;
	}
	return resolveBinding(bindings, e)?.command;
}

/**
 * How the keyboard actuates commands. A physical key is sustained: `press` on
 * key-down, `release` on key-up. `tap` is momentary (a composed character) - it
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
 * Translates host keyboard events into Atari key actions. One flat binding set
 * (loaded/persisted by the host) serves both modes: Positional resolves it
 * directly; Character runs the character channel first ({@link
 * characterModeCommand}), with the same bindings as the fall-through. The mode is
 * read live per keystroke.
 *
 * Keystrokes are observed on an (offscreen) input element rather than the window
 * so that dead-key composition works - the composed glyph arrives via
 * `compositionend`.
 */
export class Keyboard {
	#actions: KeyboardActions;
	#getMode: () => KeyboardMode;

	// The active bindings (one flat set), as loaded/persisted by the host.
	#bindings: Binding[] = [];
	// The `scope: "global"` subset, resolved by the window handler (so a global
	// binding is never shadowed by a more-specific machine binding on the same key).
	#globalBindings: Binding[] = [];

	// Physical keys (event.code) currently holding a POKEY matrix key (one shared
	// register, released only when the set empties).
	#matrixHeld = new Set<string>();
	// Physical keys holding a non-matrix sustained command (its own key-up releases
	// it): console buttons, Reset, joystick, the Shift keys.
	#held = new Map<string, Command>();

	constructor(
		actions: KeyboardActions,
		getMode: () => KeyboardMode,
		bindings: Binding[],
	) {
		this.#actions = actions;
		this.#getMode = getMode;
		this.setBindings(bindings);
	}

	/** Replace the active bindings (one flat set). Live - it affects subsequent
	 *  key-downs; anything already held still releases via its own key-up. */
	setBindings(bindings: Binding[]): void {
		this.#bindings = bindings;
		this.#globalBindings = bindings.filter((b) => b.scope === "global");
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

		// Global bindings (app commands - OPEN_PALETTE, etc.) resolve here at the
		// window, in the CAPTURE phase so they fire regardless of focus and preempt
		// the offscreen input; machine keys (scope absent) fall through to the input
		// handler above.
		window.addEventListener(
			"keydown",
			(event) => {
				if (capturingKeys) return; // the editor is recording this keystroke
				// Resolve among the global bindings only - running first, this is what
				// gives global commands precedence over machine keys cross-scope.
				const binding = resolveBinding(
					this.#globalBindings,
					this.#normalize(event),
				);
				if (binding) {
					event.preventDefault();
					event.stopImmediatePropagation();
					this.#actions.tap(binding.command);
				}
			},
			true,
		);

		// Browser-shortcut guard (F5 reload → cold boot is the worst offender): when
		// focus has drifted off the input onto the canvas/body, a bound key would
		// still trigger its browser default. Suppress it here - in the BUBBLE phase,
		// so any focused control had first claim, and skipping editable targets so we
		// never touch typing (or cursor keys) in the palette, dialogs, or the
		// offscreen input itself. Unbound keys (F12 → DevTools) fall through.
		window.addEventListener("keydown", (event) => {
			if (capturingKeys || isEditable(event.target)) return;
			if (resolveBinding(this.#bindings, this.#normalize(event))) {
				event.preventDefault();
			}
		});
	}

	/** Release everything held - call when the window loses focus. */
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
		// Character mode runs the character channel first (layout-aware typing),
		// then falls through to the bindings; Positional resolves them directly.
		const command =
			this.#getMode() === "character"
				? characterModeCommand(this.#bindings, e)
				: resolveBinding(this.#bindings, e)?.command;
		if (command) {
			event.preventDefault();
			this.#press(event.code, command);
		}
	}

	#keyUp(event: KeyboardEvent): void {
		// macOS browsers swallow keyups for other keys while Cmd is held, so a
		// Cmd+<key> matrix press (cursor arrows, the Cmd+-/= editing keys) may never
		// see its own keyup - release any held matrix key when Cmd itself is released.
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
