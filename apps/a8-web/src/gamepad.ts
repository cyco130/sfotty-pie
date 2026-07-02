import type { Command } from "./commands.ts";

// How the poller actuates the machine — the same command press/release the
// keyboard drives (see host.ts). A held direction/trigger sustains until the
// poller sees it released.
export interface GamepadActions {
	press(command: Command): void;
	release(command: Command): void;
}

// Past this magnitude an axis counts as pushed. Set a bit high so a released
// stick clears it early on the passive spring-back (snappier release), but below
// ~0.707 — a round-gated stick caps each axis near sin(45°) at the corners, so a
// higher bar would swallow diagonals. No hysteresis or per-device deadzone yet.
const AXIS_THRESHOLD = 0.6;

// The commands one joystick port actuates, indexed by Atari port (0-3). Ports
// are filled in connection order — the first connected pad drives port 0, the
// next port 1, and so on. (Not by gamepad.index: Chrome doesn't guarantee it
// starts at 0, so getGamepads() can return a null slot ahead of the pad.)
interface PortCommands {
	up: Command;
	down: Command;
	left: Command;
	right: Command;
	trigger: Command;
}

const PORT_COMMANDS: readonly PortCommands[] = [
	{
		up: "PRESS_JOY0_UP",
		down: "PRESS_JOY0_DOWN",
		left: "PRESS_JOY0_LEFT",
		right: "PRESS_JOY0_RIGHT",
		trigger: "PRESS_JOY0_TRIGGER",
	},
	{
		up: "PRESS_JOY1_UP",
		down: "PRESS_JOY1_DOWN",
		left: "PRESS_JOY1_LEFT",
		right: "PRESS_JOY1_RIGHT",
		trigger: "PRESS_JOY1_TRIGGER",
	},
	{
		up: "PRESS_JOY2_UP",
		down: "PRESS_JOY2_DOWN",
		left: "PRESS_JOY2_LEFT",
		right: "PRESS_JOY2_RIGHT",
		trigger: "PRESS_JOY2_TRIGGER",
	},
	{
		up: "PRESS_JOY3_UP",
		down: "PRESS_JOY3_DOWN",
		left: "PRESS_JOY3_LEFT",
		right: "PRESS_JOY3_RIGHT",
		trigger: "PRESS_JOY3_TRIGGER",
	},
];

// Buttons on the player-1 pad (Standard Gamepad layout) mapped to global machine
// and emulator commands: the three console keys, plus pause and turbo-hold. Only
// the first pad drives these — the others are joystick-only. Each is sustained
// (press on down, release on up), which suits the held console keys and turbo;
// pause is a press-only toggle, so its release half is a harmless no-op.
const CONSOLE_BUTTONS: readonly { index: number; command: Command }[] = [
	{ index: 9, command: "PRESS_START" }, // Start / ＋ / Menu
	{ index: 8, command: "PRESS_SELECT" }, // Select / − / View
	{ index: 3, command: "PRESS_OPTION" }, // north face (Y / △)
	{ index: 4, command: "TOGGLE_PAUSE" }, // L1
	{ index: 7, command: "TURBO_HOLD" }, // R2 — hold to fast-forward
];

// A port's digital state — the five senses we drive, as booleans.
interface PortState {
	up: boolean;
	down: boolean;
	left: boolean;
	right: boolean;
	trigger: boolean;
}

const CENTERED: PortState = {
	up: false,
	down: false,
	left: false,
	right: false,
	trigger: false,
};

// Reduce a live pad to its digital port state (Standard Gamepad layout): the
// D-pad is buttons 12-15, the left stick is axes 0/1 (negative is up/left), and
// button 0 is the trigger. The D-pad wins whenever any of its buttons is down —
// a thumb on the D-pad overrides a resting or drifting stick — otherwise the
// stick drives the directions past AXIS_THRESHOLD.
function readPad(pad: Gamepad): PortState {
	const b = pad.buttons;
	const trigger = b[0]?.pressed ?? false;
	const up = b[12]?.pressed ?? false;
	const down = b[13]?.pressed ?? false;
	const left = b[14]?.pressed ?? false;
	const right = b[15]?.pressed ?? false;
	if (up || down || left || right) {
		return { up, down, left, right, trigger };
	}

	const x = pad.axes[0] ?? 0;
	const y = pad.axes[1] ?? 0;
	return {
		up: y < -AXIS_THRESHOLD,
		down: y > AXIS_THRESHOLD,
		left: x < -AXIS_THRESHOLD,
		right: x > AXIS_THRESHOLD,
		trigger,
	};
}

/**
 * Polls the Gamepad API and drives the joystick commands. The Gamepad API has no
 * button/axis events — state is read by polling — so the emulation loop calls
 * {@link poll} after each yield to the event loop (see `Emulator.afterYield`),
 * where getGamepads() is freshly updated and the read lands just before the next
 * scanlines. We diff each poll against the last to synthesize the press/release
 * edges the commands want.
 *
 * The mapping is hardcoded to the Standard Gamepad layout for now: every pad
 * drives its Atari port (D-pad + left stick → directions, button 0 → trigger),
 * and the player-1 pad also drives the console/meta buttons (see
 * {@link CONSOLE_BUTTONS}). A binding layer and per-device calibration come later.
 */
export class Gamepads {
	#actions: GamepadActions;
	// Last-polled joystick state per port, so a poll emits only the changed edges.
	#state: PortState[] = PORT_COMMANDS.map(() => CENTERED);
	// Last-polled state of the player-1 console/meta buttons, parallel to
	// CONSOLE_BUTTONS.
	#consoleState: boolean[] = CONSOLE_BUTTONS.map(() => false);
	// Connected-pad count. Polling no-ops at zero, so a keyboard-only session
	// costs nothing; the connect/disconnect events keep it current (see attach).
	#connected = 0;

	constructor(actions: GamepadActions) {
		this.#actions = actions;
	}

	/** Track pad connect/disconnect. Returns a teardown. Until a pad connects
	 *  {@link poll} is a cheap no-op, so neither poll site touches the Gamepad API
	 *  in a keyboard-only session. */
	attach(): () => void {
		const onConnect = (): void => {
			this.#connected++;
		};
		const onDisconnect = (): void => {
			this.#connected = Math.max(0, this.#connected - 1);
			this.poll(true); // force one poll to release whatever the departing pad held
		};
		window.addEventListener("gamepadconnected", onConnect);
		window.addEventListener("gamepaddisconnected", onDisconnect);
		return () => {
			window.removeEventListener("gamepadconnected", onConnect);
			window.removeEventListener("gamepaddisconnected", onDisconnect);
		};
	}

	/** Sample every connected pad and emit the joystick + console-button edges.
	 *  Present pads fill ports in connection order; the first pad also drives the
	 *  console/meta buttons. Absent ports/buttons read as released, so a disconnect
	 *  frees whatever was held. A no-op when nothing is connected, unless `force`
	 *  (the disconnect path needs to run once at zero to release). */
	poll(force = false): void {
		if (!force && this.#connected === 0) return;
		const present: Gamepad[] = [];
		for (const pad of navigator.getGamepads()) if (pad) present.push(pad);
		for (let port = 0; port < PORT_COMMANDS.length; port++) {
			const pad = present[port];
			this.#apply(port, pad ? readPad(pad) : CENTERED);
		}
		this.#applyConsole(present[0]);
	}

	// Diff a port's new joystick state against the last poll, pressing/releasing on
	// each changed sense, then store it for next time.
	#apply(port: number, next: PortState): void {
		const prev = this.#state[port]!;
		const cmd = PORT_COMMANDS[port]!;
		this.#edge(prev.up, next.up, cmd.up);
		this.#edge(prev.down, next.down, cmd.down);
		this.#edge(prev.left, next.left, cmd.left);
		this.#edge(prev.right, next.right, cmd.right);
		this.#edge(prev.trigger, next.trigger, cmd.trigger);
		this.#state[port] = next;
	}

	// Diff the player-1 console/meta buttons; an absent pad releases them all.
	#applyConsole(pad: Gamepad | undefined): void {
		const state = this.#consoleState;
		for (let i = 0; i < CONSOLE_BUTTONS.length; i++) {
			const { index, command } = CONSOLE_BUTTONS[i]!;
			const now = pad?.buttons[index]?.pressed ?? false;
			this.#edge(state[i]!, now, command);
			state[i] = now;
		}
	}

	#edge(was: boolean, now: boolean, command: Command): void {
		if (now === was) return;
		if (now) this.#actions.press(command);
		else this.#actions.release(command);
	}
}
