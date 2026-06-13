import type { TargetedTouchEvent } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Command } from "./commands.ts";
import type { EmulatorHost } from "./host.ts";

const LEFTY_KEY = "a8.osd.lefty";

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
	press,
	release,
	label,
}: {
	host: EmulatorHost;
	press: Command;
	release: Command;
	label: string;
}) {
	return (
		<button
			type="button"
			class="flex-1 touch-none rounded bg-neutral-700/70 px-1 py-2 text-xs text-white select-none active:bg-neutral-500"
			onTouchStart={(e) => {
				e.preventDefault();
				host.dispatch(press);
			}}
			onTouchEnd={(e) => {
				e.preventDefault();
				host.dispatch(release);
			}}
			onTouchCancel={() => host.dispatch(release)}
		>
			{label}
		</button>
	);
}

/** The fire button — holds the joystick-0 trigger while touched. */
function TriggerButton({ host }: { host: EmulatorHost }) {
	return (
		<button
			type="button"
			aria-label="Fire"
			class="aspect-square w-[22vw] touch-none rounded-full bg-red-600/40 select-none active:bg-red-600/70"
			onTouchStart={(e) => {
				e.preventDefault();
				host.dispatch("PRESS_JOY0_TRIGGER");
			}}
			onTouchEnd={(e) => {
				e.preventDefault();
				host.dispatch("RELEASE_JOY0_TRIGGER");
			}}
			onTouchCancel={() => host.dispatch("RELEASE_JOY0_TRIGGER")}
		/>
	);
}

/**
 * The analog touch stick: a knob inside a ring. The touch point picks one of
 * nine positions (centre + eight compass directions) by its angle from the
 * centre, with a dead zone near the middle; the knob shows the choice and the
 * host's joystick-0 direction follows. Geometry carried over from the old
 * React build.
 */
function JoystickStick({ host }: { host: EmulatorHost }) {
	const [knob, setKnob] = useState({ x: 0, y: 0 });
	const d = Math.SQRT1_2;

	function move(e: TargetedTouchEvent<HTMLDivElement>) {
		const touch = e.touches[0];
		if (!touch) return;
		e.preventDefault();
		e.stopPropagation();
		const rect = e.currentTarget.getBoundingClientRect();
		const x = 2 * ((touch.clientX - rect.left) / rect.width - 0.5);
		const y = 2 * ((touch.clientY - rect.top) / rect.height - 0.5);

		if (Math.hypot(x, y) < 0.25) {
			host.setJoystickDirection(0);
			setKnob({ x: 0, y: 0 });
			return;
		}

		// Direction-bit masks: 1 = up, 2 = down, 4 = left, 8 = right. `y` grows
		// downward, so a positive angle points down the screen.
		const a = Math.atan2(y, x) / Math.PI;
		if (a > -0.125 && a <= 0.125) {
			host.setJoystickDirection(0x8); // E
			setKnob({ x: 1, y: 0 });
		} else if (a > 0.125 && a <= 0.375) {
			host.setJoystickDirection(0xa); // SE
			setKnob({ x: d, y: d });
		} else if (a > 0.375 && a <= 0.625) {
			host.setJoystickDirection(0x2); // S
			setKnob({ x: 0, y: 1 });
		} else if (a > 0.625 && a <= 0.875) {
			host.setJoystickDirection(0x6); // SW
			setKnob({ x: -d, y: d });
		} else if (a > 0.875 || a <= -0.875) {
			host.setJoystickDirection(0x4); // W
			setKnob({ x: -1, y: 0 });
		} else if (a > -0.875 && a <= -0.625) {
			host.setJoystickDirection(0x5); // NW
			setKnob({ x: -d, y: -d });
		} else if (a > -0.625 && a <= -0.375) {
			host.setJoystickDirection(0x1); // N
			setKnob({ x: 0, y: -1 });
		} else {
			host.setJoystickDirection(0x9); // NE
			setKnob({ x: d, y: -d });
		}
	}

	function recenter() {
		host.setJoystickDirection(0);
		setKnob({ x: 0, y: 0 });
	}

	return (
		<div class="relative aspect-square w-[40vw]">
			<div
				class="pointer-events-none absolute top-[10vw] left-[10vw] h-[20vw] w-[20vw] rounded-full bg-slate-200/50"
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
 * The on-screen controls for touch devices: a row of console/key buttons over
 * a fire button and an analog stick. Shown only when the primary pointer is
 * coarse and the menu is closed (the menu becomes a top bar on mobile and
 * needs the room). A swap button flips the stick/fire sides for left-handers.
 */
export function Osd({ host }: { host: EmulatorHost }) {
	const coarse = useCoarsePointer();
	const menuOpen = host.menuOpen.value;
	const [lefty, setLefty] = useState(
		() => localStorage.getItem(LEFTY_KEY) === "1",
	);

	if (!coarse || menuOpen) return null;

	const fire = <TriggerButton host={host} />;
	const stick = <JoystickStick host={host} />;

	return (
		<div class="flex shrink-0 flex-col gap-2 bg-neutral-900/80 p-2 select-none">
			<div class="flex gap-1">
				<HoldButton
					host={host}
					press="PRESS_OPTION"
					release="RELEASE_OPTION"
					label="Option"
				/>
				<HoldButton
					host={host}
					press="PRESS_SELECT"
					release="RELEASE_SELECT"
					label="Select"
				/>
				<HoldButton
					host={host}
					press="PRESS_START"
					release="RELEASE_START"
					label="Start"
				/>
				<HoldButton
					host={host}
					press="PRESS_RESET"
					release="RELEASE_RESET"
					label="Reset"
				/>
				<HoldButton
					host={host}
					press="PRESS_SPACE"
					release="RELEASE_POKEY_KEY"
					label="Space"
				/>
				<HoldButton
					host={host}
					press="PRESS_ESC"
					release="RELEASE_POKEY_KEY"
					label="Esc"
				/>
			</div>

			<div class="flex items-center justify-between py-4">
				{lefty ? stick : fire}
				<button
					type="button"
					aria-label="Swap stick and fire sides"
					class="rounded bg-neutral-700/70 px-3 py-2 text-lg text-white active:bg-neutral-500"
					onClick={() => {
						const next = !lefty;
						localStorage.setItem(LEFTY_KEY, next ? "1" : "0");
						setLefty(next);
					}}
				>
					⇄
				</button>
				{lefty ? fire : stick}
			</div>
		</div>
	);
}
