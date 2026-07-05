import type { Command } from "./commands.ts";
import {
	initialStickState,
	readRadialStick,
	type RadialStickConfig,
	type RadialStickState,
} from "./radial-stick.ts";

// How the poller actuates the machine — the same command press/release the
// keyboard drives (see host.ts). A held direction/trigger sustains until the
// poller sees it released.
export interface GamepadActions {
	press(command: Command): void;
	release(command: Command): void;
}

// Analog stick → digital 8-way: axes are paired in order (0/1, 2/3) and each
// pair goes through the shared radial reader (see radial-stick.ts). Thresholds
// tuned for a spring-centred thumbstick; the OSD touch stick has its own.
const STICK: RadialStickConfig = {
	engage: 0.45,
	release: 0.35,
	sectorMargin: 0.1, // radians (~5.7°)
};

// The axis-halves each octant activates, as [axisOffset (0 = x, 1 = y), dir]. The
// diagonals set both; the cardinals one. atan2(y, x) angle space, so +y is the
// "positive" side of the odd axis (matching how axis-half bindings read).
const OCTANT_HALVES: readonly (readonly (readonly [number, -1 | 1])[])[] = [
	[[0, 1]], // 0: +x
	[
		[0, 1],
		[1, 1],
	], // 1: +x +y
	[[1, 1]], // 2: +y
	[
		[0, -1],
		[1, 1],
	], // 3: −x +y
	[[0, -1]], // 4: −x
	[
		[0, -1],
		[1, -1],
	], // 5: −x −y
	[[1, -1]], // 6: −y
	[
		[0, 1],
		[1, -1],
	], // 7: +x −y
];

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

// A reference to a Standard Gamepad input: a button by index, or one half of an
// axis (dir −1 = the negative side). This is the vocabulary a binding maps from.
export type GamepadInput = { button: number } | { axis: number; dir: -1 | 1 };

// The five joystick senses a per-port binding drives.
export type JoyRole = "up" | "down" | "left" | "right" | "trigger";

// Per-port binding: an input → a joystick role. Applied to every pad on its own
// port (the role resolves to that port's PRESS_JOY{n}_* command).
export interface JoyBinding {
	input: GamepadInput;
	role: JoyRole;
}

// Global binding: an input → a command. Applied to the port-0 pad only.
export interface ConsoleBinding {
	input: GamepadInput;
	command: Command;
}

// Default joystick bindings (Standard Gamepad layout): the D-pad (buttons 12-15)
// and the left stick (axes 0/1) both drive the directions; button 0 is the
// trigger. Several inputs can share a role — they OR together (see readPad).
export const DEFAULT_JOYSTICK: readonly JoyBinding[] = [
	{ input: { button: 12 }, role: "up" },
	{ input: { button: 13 }, role: "down" },
	{ input: { button: 14 }, role: "left" },
	{ input: { button: 15 }, role: "right" },
	{ input: { axis: 1, dir: -1 }, role: "up" },
	{ input: { axis: 1, dir: 1 }, role: "down" },
	{ input: { axis: 0, dir: -1 }, role: "left" },
	{ input: { axis: 0, dir: 1 }, role: "right" },
	{ input: { button: 0 }, role: "trigger" },
];

// Default console/meta bindings (port-0 pad only): the three console keys plus
// pause and turbo-hold. Each is sustained (press on down, release on up); pause
// is a press-only toggle, so its release half is a harmless no-op.
export const DEFAULT_CONSOLE: readonly ConsoleBinding[] = [
	{ input: { button: 9 }, command: "PRESS_START" }, // Start / ＋ / Menu
	{ input: { button: 8 }, command: "PRESS_SELECT" }, // Select / − / View
	{ input: { button: 3 }, command: "PRESS_OPTION" }, // north face (Y / △)
	{ input: { button: 4 }, command: "TOGGLE_PAUSE" }, // L1
	{ input: { button: 7 }, command: "TURBO_HOLD" }, // R2 — hold to fast-forward
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

// Whether a Standard input is active: a pressed button, or an axis-half the
// stick's octant lit up this poll (see `activeHalves`, passed in as a set of
// `${axis}:${dir}` keys).
function inputActive(
	pad: Gamepad,
	input: GamepadInput,
	halves: ReadonlySet<string>,
): boolean {
	if ("button" in input) return pad.buttons[input.button]?.pressed ?? false;
	return halves.has(`${input.axis}:${input.dir}`);
}

// Reduce a live pad to its digital port state by OR-ing every joystick binding
// onto its role — so the D-pad and the stick both drive a direction, either one
// active setting it. (This replaces the old "D-pad overrides the stick" rule; a
// deadzone, not a priority, keeps a resting stick from fighting the D-pad.)
function readPad(
	pad: Gamepad,
	joystick: readonly JoyBinding[],
	halves: ReadonlySet<string>,
): PortState {
	const s: PortState = {
		up: false,
		down: false,
		left: false,
		right: false,
		trigger: false,
	};
	for (const b of joystick) {
		if (inputActive(pad, b.input, halves)) s[b.role] = true;
	}
	return s;
}

const NO_HALVES: ReadonlySet<string> = new Set();

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
 * The mapping targets the Standard Gamepad layout: every pad drives its assigned
 * Atari port (joystick bindings → directions/trigger), and the port-0 pad also
 * drives the console/meta commands. The bindings are data ({@link setBindings}),
 * defaulting to {@link DEFAULT_JOYSTICK} / {@link DEFAULT_CONSOLE}; which pad
 * drives which port is an explicit assignment ({@link setPort}). Per-device
 * normalization (for non-standard pads) comes later, ahead of these bindings.
 */
export class Gamepads {
	#actions: GamepadActions;
	// The active bindings (data-driven; edited via setBindings).
	#joystick: readonly JoyBinding[] = DEFAULT_JOYSTICK;
	#console: readonly ConsoleBinding[] = DEFAULT_CONSOLE;
	// Last-polled joystick state per port, so a poll emits only the changed edges.
	#state: PortState[] = PORT_COMMANDS.map(() => CENTERED);
	// Last-polled state of the port-0 console/meta buttons, parallel to #console.
	#consoleState: boolean[] = DEFAULT_CONSOLE.map(() => false);
	// Connected pads by gamepad.index → id/mapping, from the connect events.
	#pads = new Map<number, { id: string; mapping: string }>();
	// Atari port → the gamepad.index driving it (or null). The source of truth for
	// who's which player; the UI edits it via setPort. Assignment is stable — a
	// disconnect frees a port without reshuffling the survivors.
	#portToIndex: (number | null)[] = PORT_COMMANDS.map(() => null);
	// Per-stick hysteresis state, keyed by `${gamepad.index}:${pairBase}` so it
	// follows the device, not the Atari port.
	#sticks = new Map<string, RadialStickState>();

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
			for (const key of this.#sticks.keys()) {
				if (key.startsWith(`${index}:`)) this.#sticks.delete(key);
			}
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
		let p0Halves = NO_HALVES;
		for (let port = 0; port < PORT_COMMANDS.length; port++) {
			const index = this.#portToIndex[port];
			const pad = index != null ? pads[index] : null;
			const halves = pad ? this.#activeHalves(pad, index!) : NO_HALVES;
			this.#apply(port, pad ? readPad(pad, this.#joystick, halves) : CENTERED);
			if (port === 0) p0Halves = halves;
		}
		const p0 = this.#portToIndex[0];
		const p0pad = p0 != null ? (pads[p0] ?? undefined) : undefined;
		this.#applyConsole(p0pad, p0Halves);
	}

	// The axis-halves the pad's sticks light up this poll: each axis pair (0/1,
	// 2/3, …) through the radial reader. Returns `${axis}:${dir}` keys for
	// inputActive.
	#activeHalves(pad: Gamepad, index: number): ReadonlySet<string> {
		const halves = new Set<string>();
		const axes = pad.axes;
		for (let base = 0; base + 1 < axes.length; base += 2) {
			const x = axes[base] ?? 0;
			const y = axes[base + 1] ?? 0;
			const key = `${index}:${base}`;
			let st = this.#sticks.get(key);
			if (!st) {
				st = initialStickState();
				this.#sticks.set(key, st);
			}
			const k = readRadialStick(x, y, st, STICK);
			if (k < 0) continue;
			for (const [off, dir] of OCTANT_HALVES[k]!) {
				halves.add(`${base + off}:${dir}`);
			}
		}
		return halves;
	}

	/** Replace the joystick + console binding sets (the editor's save path). Live:
	 *  it affects the next poll; anything held releases on its own next edge. */
	setBindings(
		joystick: readonly JoyBinding[],
		console: readonly ConsoleBinding[],
	): void {
		this.#joystick = joystick;
		this.#console = console;
		this.#consoleState = console.map(() => false);
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

	// Diff the port-0 console/meta bindings; an absent pad releases them all.
	#applyConsole(pad: Gamepad | undefined, halves: ReadonlySet<string>): void {
		const state = this.#consoleState;
		for (let i = 0; i < this.#console.length; i++) {
			const { input, command } = this.#console[i]!;
			const now = pad ? inputActive(pad, input, halves) : false;
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
