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

/** A connected pad and its Atari-port assignment, for the controllers UI. */
export interface PadInfo {
	index: number; // the browser's gamepad.index (its getGamepads() slot)
	id: string;
	mapping: string;
	port: number | null; // assigned Atari port (0-3), or null when off
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
 * drives its assigned Atari port (D-pad + left stick → directions, button 0 →
 * trigger), and the port-0 pad also drives the console/meta buttons (see
 * {@link CONSOLE_BUTTONS}). Which pad drives which port is an explicit assignment
 * ({@link setPort}), defaulting to lowest-free-on-connect. A binding layer and
 * per-device calibration come later.
 */
export class Gamepads {
	#actions: GamepadActions;
	// Last-polled joystick state per port, so a poll emits only the changed edges.
	#state: PortState[] = PORT_COMMANDS.map(() => CENTERED);
	// Last-polled state of the port-0 console/meta buttons, parallel to
	// CONSOLE_BUTTONS.
	#consoleState: boolean[] = CONSOLE_BUTTONS.map(() => false);
	// Connected pads by gamepad.index → id/mapping, from the connect events.
	#pads = new Map<number, { id: string; mapping: string }>();
	// Atari port → the gamepad.index driving it (or null). The source of truth for
	// who's which player; the UI edits it via setPort. Assignment is stable — a
	// disconnect frees a port without reshuffling the survivors.
	#portToIndex: (number | null)[] = PORT_COMMANDS.map(() => null);

	/** Fired whenever the connected set or the assignment changes, so the host can
	 *  mirror {@link pads} into a signal. */
	onChange: (() => void) | undefined;

	constructor(actions: GamepadActions) {
		this.#actions = actions;
	}

	/** Track pad connect/disconnect. Returns a teardown. Until a pad connects
	 *  {@link poll} is a cheap no-op, so neither poll site touches the Gamepad API
	 *  in a keyboard-only session. */
	attach(): () => void {
		const onConnect = (e: GamepadEvent): void => {
			const { index, id, mapping } = e.gamepad;
			this.#pads.set(index, { id, mapping });
			// Lowest free port; existing pads keep theirs.
			if (!this.#portToIndex.includes(index)) {
				const free = this.#portToIndex.indexOf(null);
				if (free >= 0) this.#portToIndex[free] = index;
			}
			this.onChange?.();
		};
		const onDisconnect = (e: GamepadEvent): void => {
			const { index } = e.gamepad;
			this.#pads.delete(index);
			const port = this.#portToIndex.indexOf(index);
			if (port >= 0) this.#portToIndex[port] = null;
			this.poll(true); // release whatever the departing pad held
			this.onChange?.();
		};
		window.addEventListener("gamepadconnected", onConnect);
		window.addEventListener("gamepaddisconnected", onDisconnect);
		return () => {
			window.removeEventListener("gamepadconnected", onConnect);
			window.removeEventListener("gamepaddisconnected", onDisconnect);
		};
	}

	/** The connected pads with their port assignments — assigned pads first (by
	 *  port), then the unassigned (by index). */
	pads(): PadInfo[] {
		const list: PadInfo[] = [];
		for (const [index, meta] of this.#pads) {
			const port = this.#portToIndex.indexOf(index);
			list.push({ ...meta, index, port: port >= 0 ? port : null });
		}
		return list.sort(
			(a, b) => (a.port ?? 99) - (b.port ?? 99) || a.index - b.index,
		);
	}

	/** Assign pad `index` to `port` (0-3) or `null` (off). Swaps with whatever pad
	 *  held the target port so no two pads share it. */
	setPort(index: number, port: number | null): void {
		const oldPort = this.#portToIndex.indexOf(index);
		if (oldPort >= 0) this.#portToIndex[oldPort] = null;
		if (port !== null) {
			const occupant = this.#portToIndex[port];
			this.#portToIndex[port] = index;
			// Move the displaced pad to the vacated port (a swap); else it goes off.
			if (occupant != null && occupant !== index && oldPort >= 0) {
				this.#portToIndex[oldPort] = occupant;
			}
		}
		this.poll(true); // re-home held inputs to the new ports
		this.onChange?.();
	}

	/** Sample the pad on each port and emit the joystick + console-button edges.
	 *  Unassigned/absent ports read as released, so a disconnect frees whatever was
	 *  held. A no-op when nothing is connected, unless `force` (the disconnect and
	 *  reassign paths run once to release/re-home). */
	poll(force = false): void {
		if (!force && this.#pads.size === 0) return;
		const pads = navigator.getGamepads();
		for (let port = 0; port < PORT_COMMANDS.length; port++) {
			const index = this.#portToIndex[port];
			const pad = index != null ? pads[index] : null;
			this.#apply(port, pad ? readPad(pad) : CENTERED);
		}
		const p0 = this.#portToIndex[0];
		this.#applyConsole(p0 != null ? (pads[p0] ?? undefined) : undefined);
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
