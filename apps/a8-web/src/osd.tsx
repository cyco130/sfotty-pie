import type { TargetedTouchEvent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Command } from "./commands.ts";
import type { EmulatorHost } from "./host.ts";
import { Icon, type IconName } from "./icon.tsx";
import { messages } from "./messages.ts";
import { KeyboardView } from "./osd-keyboard.tsx";
import { PasteView } from "./osd-paste.tsx";
import {
	initialStickState,
	readRadialStick,
	type RadialStickConfig,
} from "./radial-stick.ts";
import { storageName } from "./storage.ts";

const LEFTY_KEY = storageName("osd", "lefty");

type OsdView = "stick" | "keyboard" | "paste" | "off";

/** True while the primary pointer is touch (a phone/tablet, not a mouse). */
function useCoarsePointer(): boolean {
	const [coarse, setCoarse] = useState(
		() => !matchMedia("(pointer: fine)").matches,
	);
	useEffect(() => {
		const mq = matchMedia("(pointer: fine)");
		const update = () => setCoarse(!mq.matches);
		mq.addEventListener("change", update);
		return () => mq.removeEventListener("change", update);
	}, []);
	return coarse;
}

/** A momentary control: presses on touch-down, releases on touch-up. */
function HoldButton({
	host,
	command,
	label,
}: {
	host: EmulatorHost;
	command: Command;
	label: string;
}) {
	return (
		<button
			type="button"
			class="flex-1 touch-none rounded-sm bg-neutral-700/70 px-1 py-2 text-xs text-white select-none active:bg-neutral-500"
			onTouchStart={(e) => {
				e.preventDefault();
				host.press(command);
			}}
			onTouchEnd={(e) => {
				e.preventDefault();
				host.release(command);
			}}
			onTouchCancel={() => host.release(command)}
		>
			{label}
		</button>
	);
}

/** The fire button - holds the joystick-0 trigger while touched. */
function TriggerButton({ host }: { host: EmulatorHost }) {
	return (
		<button
			type="button"
			aria-label="Fire"
			class="aspect-square w-[22vw] touch-none rounded-full bg-red-600/40 select-none active:bg-red-600/70"
			onTouchStart={(e) => {
				e.preventDefault();
				host.press("PRESS_JOY0_TRIGGER");
			}}
			onTouchEnd={(e) => {
				e.preventDefault();
				host.release("PRESS_JOY0_TRIGGER");
			}}
			onTouchCancel={() => host.release("PRESS_JOY0_TRIGGER")}
		/>
	);
}

// Radial-reader thresholds for the touch stick. Much slighter hysteresis than
// the gamepad's: a finger doesn't idle at the deadzone edge (touchmove only
// fires while it moves) and doesn't wobble like a sprung stick at a sector
// boundary - its angular jitter is positional jitter over radius, tiny out
// near the ring. So the thresholds stay close to the raw geometry, with just a
// sliver of margin as anti-chatter insurance. Tuned by feel.
const TOUCH_STICK: RadialStickConfig = {
	engage: 0.25,
	release: 0.2,
	sectorMargin: 0.05, // radians (~2.9 deg)
};

// Per-octant joystick direction bitmask (1 = up, 2 = down, 4 = left,
// 8 = right) and knob offset, in the radial reader's octant order: 0 = +x
// (east), counting towards +y, which grows down the screen - so 1 = SE.
const OCTANT_DIRECTION = [0x8, 0xa, 0x2, 0x6, 0x4, 0x5, 0x1, 0x9] as const;
const D = Math.SQRT1_2;
const OCTANT_KNOB = [
	{ x: 1, y: 0 },
	{ x: D, y: D },
	{ x: 0, y: 1 },
	{ x: -D, y: D },
	{ x: -1, y: 0 },
	{ x: -D, y: -D },
	{ x: 0, y: -1 },
	{ x: D, y: -D },
] as const;

/**
 * The analog touch stick: a knob inside a ring. The touch point runs through
 * the shared radial reader (deadzone + octant snapping + hysteresis, see
 * radial-stick.ts); the knob shows the chosen octant and the host's joystick-0
 * direction follows.
 */
function JoystickStick({ host }: { host: EmulatorHost }) {
	const [knob, setKnob] = useState({ x: 0, y: 0 });
	const stickRef = useRef(initialStickState());

	function move(e: TargetedTouchEvent<HTMLDivElement>) {
		// targetTouches, not touches: with the fire button held by the other
		// thumb, touches[0] would be that finger and the stick would read its
		// position. targetTouches[0] is the finger actually on the stick.
		const touch = e.targetTouches[0];
		if (!touch) return;
		e.preventDefault();
		e.stopPropagation();
		const rect = e.currentTarget.getBoundingClientRect();
		const x = 2 * ((touch.clientX - rect.left) / rect.width - 0.5);
		const y = 2 * ((touch.clientY - rect.top) / rect.height - 0.5);

		const octant = readRadialStick(x, y, stickRef.current, TOUCH_STICK);
		if (octant < 0) {
			host.setJoystickDirection(0);
			setKnob({ x: 0, y: 0 });
		} else {
			host.setJoystickDirection(OCTANT_DIRECTION[octant]!);
			setKnob(OCTANT_KNOB[octant]!);
		}
	}

	function recenter() {
		stickRef.current = initialStickState();
		host.setJoystickDirection(0);
		setKnob({ x: 0, y: 0 });
	}

	return (
		<div class="relative aspect-square w-[40vw]">
			<div
				class="pointer-events-none absolute top-[10vw] left-[10vw] size-[20vw] rounded-full bg-slate-200/50"
				style={{
					transform: `translate(${knob.x * 10}vw, ${knob.y * 10}vw)`,
				}}
			/>
			<div
				class="absolute inset-0 touch-none rounded-full bg-slate-200/25"
				onTouchStart={move}
				onTouchMove={move}
				onTouchEnd={recenter}
				onTouchCancel={recenter}
			/>
		</div>
	);
}

/**
 * Power (cold start) - a one-shot tap, styled recessed so it isn't
 * fat-fingered mid-game. Lives in the persistent top bar beside Reset.
 */
function PowerButton({ host }: { host: EmulatorHost }) {
	return (
		<button
			type="button"
			class="touch-none rounded-sm bg-neutral-800 px-3 py-1 text-xs text-neutral-400 select-none active:bg-neutral-600"
			onTouchStart={(e) => {
				e.preventDefault();
				host.dispatch("POWER_CYCLE");
			}}
		>
			Power
		</button>
	);
}

/** Reset (hardware line) - momentary hold, in the persistent top bar. */
function ResetButton({ host }: { host: EmulatorHost }) {
	return (
		<button
			type="button"
			class="touch-none rounded-sm bg-neutral-700/70 px-3 py-1 text-xs text-white select-none active:bg-neutral-500"
			onTouchStart={(e) => {
				e.preventDefault();
				host.press("PRESS_RESET");
			}}
			onTouchEnd={(e) => {
				e.preventDefault();
				host.release("PRESS_RESET");
			}}
			onTouchCancel={() => host.release("PRESS_RESET")}
		>
			Reset
		</button>
	);
}

/** The joystick / keyboard segmented control that swaps the OSD body. */
function ViewToggle({
	view,
	onChange,
}: {
	view: OsdView;
	onChange: (view: OsdView) => void;
}) {
	const tab = (v: OsdView, icon: IconName, aria: string) => (
		<button
			type="button"
			aria-label={aria}
			title={aria}
			aria-pressed={view === v}
			class={`rounded-sm px-3 py-1 text-lg select-none ${
				view === v ? "bg-neutral-500 text-white" : "text-neutral-400"
			}`}
			onClick={() => onChange(v)}
		>
			<Icon name={icon} />
		</button>
	);
	return (
		<div class="flex gap-1 rounded-sm bg-neutral-800 p-0.5">
			{tab("stick", "joystick", messages.osd.joystickControls)}
			{tab("keyboard", "keyboard", messages.osd.keyboard)}
			{tab("paste", "clipboard", messages.osd.pasteText)}
			{tab("off", "chevron-down", messages.osd.hideControls)}
		</div>
	);
}

/**
 * The on-screen controls for touch devices. A persistent top bar (Power + a
 * view toggle) sits over a body that swaps between the joystick view (a row
 * of console keys over a fire button and analog stick, with a left-hander
 * swap), the on-screen keyboard, and the paste editor. Shown only when the
 * primary pointer is coarse and the menu is closed (the menu becomes a top
 * bar on mobile and needs the room).
 */
export function Osd({ host }: { host: EmulatorHost }) {
	const coarse = useCoarsePointer();
	const panelOpen = host.sidebar.value !== null;
	const [lefty, setLefty] = useState(
		() => localStorage.getItem(LEFTY_KEY) === "1",
	);
	const [view, setView] = useState<OsdView>("stick");

	if (!coarse || panelOpen) return null;

	const fire = <TriggerButton host={host} />;
	const stick = <JoystickStick host={host} />;

	return (
		<div class="flex shrink-0 flex-col gap-2 bg-neutral-900/80 p-2 select-none">
			<div class="flex items-center justify-between">
				<div class="flex gap-1">
					<PowerButton host={host} />
					<ResetButton host={host} />
				</div>
				<ViewToggle view={view} onChange={setView} />
			</div>

			{view === "keyboard" && <KeyboardView host={host} />}

			{view === "paste" && <PasteView host={host} />}

			{view === "stick" && (
				<>
					<div class="flex gap-1">
						<HoldButton host={host} command="PRESS_OPTION" label="Option" />
						<HoldButton host={host} command="PRESS_SELECT" label="Select" />
						<HoldButton host={host} command="PRESS_START" label="Start" />
						<HoldButton host={host} command="PRESS_SPACE" label="Space" />
						<HoldButton host={host} command="PRESS_ESC" label="Esc" />
					</div>

					<div class="flex items-center justify-between py-4">
						{lefty ? stick : fire}
						<button
							type="button"
							aria-label={messages.osd.swapSides}
							title={messages.osd.swapSides}
							class="rounded-sm bg-neutral-700/70 px-3 py-2 text-lg text-white active:bg-neutral-500"
							onClick={() => {
								const next = !lefty;
								localStorage.setItem(LEFTY_KEY, next ? "1" : "0");
								setLefty(next);
							}}
						>
							<Icon name="swap" />
						</button>
						{lefty ? fire : stick}
					</div>
				</>
			)}
		</div>
	);
}
