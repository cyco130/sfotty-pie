import { useEffect, useState } from "preact/hooks";
import { CommandPicker } from "./command-picker.tsx";
import { type Command, labelOf } from "./commands.ts";
import type { GamepadInput, JoyRole } from "./gamepad.ts";
import { inputLabel } from "./gamepad-labels.ts";
import type { EmulatorHost } from "./host.ts";
import { messages } from "./messages.ts";

// A firm push to capture an axis — higher than the play threshold so a light
// wobble on a resting stick doesn't register as a binding.
const CAPTURE_AXIS = 0.7;

// The joystick roles, in display order.
const ROLES: readonly JoyRole[] = ["up", "down", "left", "right", "trigger"];

// A pad's currently-active inputs as {key, input}: buttons pressed, axes past the
// capture threshold (each side a distinct input).
function activeInputs(pad: Gamepad): { key: string; input: GamepadInput }[] {
	const out: { key: string; input: GamepadInput }[] = [];
	pad.buttons.forEach((b, i) => {
		if (b.pressed) out.push({ key: `b${i}`, input: { button: i } });
	});
	pad.axes.forEach((v, i) => {
		if (v > CAPTURE_AXIS)
			out.push({ key: `a${i}+`, input: { axis: i, dir: 1 } });
		else if (v < -CAPTURE_AXIS)
			out.push({ key: `a${i}-`, input: { axis: i, dir: -1 } });
	});
	return out;
}

// What a pending capture will bind to once an input is pressed.
type Capture =
	| { role: JoyRole } // add an input to a joystick role
	| { consoleIndex: number } // replace an existing console row's input
	| { command: Command }; // add a new console row for this command

// A small removable/rebindable input chip.
function Chip({ label, onClick }: { label: string; onClick?: () => void }) {
	return (
		<button
			type="button"
			class="rounded-sm bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-700 hover:bg-neutral-200"
			onClick={onClick}
		>
			{label}
		</button>
	);
}

/**
 * The gamepad binding editor: the global joystick + console layers, edited by
 * press-to-capture against the live monitor above it. Joystick roles take
 * several inputs (D-pad and stick both, OR'd); console rows bind any command.
 */
export function BindingsEditor({ host }: { host: EmulatorHost }) {
	const bindings = host.gamepadBindings.value;
	const standard = host.gamepads.value.some((p) => p.mapping === "standard");
	const [capture, setCapture] = useState<Capture | null>(null);
	// The console command picker: a row index, "new", or null (closed).
	const [picking, setPicking] = useState<number | "new" | null>(null);

	// While capturing, watch for a newly-pressed input and apply it to the target.
	// Inputs already held when capture starts are baselined out, so you can't
	// self-capture a button you're holding to click.
	useEffect(() => {
		if (!capture) return;
		const baseline = new Set<string>();
		for (const p of navigator.getGamepads()) {
			if (p)
				for (const a of activeInputs(p)) baseline.add(`${p.index}:${a.key}`);
		}
		let raf = 0;
		const tick = () => {
			for (const p of navigator.getGamepads()) {
				if (!p) continue;
				for (const a of activeInputs(p)) {
					if (baseline.has(`${p.index}:${a.key}`)) continue;
					setCapture(null);
					const cur = host.gamepadBindings.peek();
					if ("role" in capture) {
						host.setGamepadBindings({
							...cur,
							joystick: [
								...cur.joystick,
								{ input: a.input, role: capture.role },
							],
						});
					} else if ("consoleIndex" in capture) {
						host.setGamepadBindings({
							...cur,
							console: cur.console.map((b, i) =>
								i === capture.consoleIndex ? { ...b, input: a.input } : b,
							),
						});
					} else {
						host.setGamepadBindings({
							...cur,
							console: [
								...cur.console,
								{ input: a.input, command: capture.command },
							],
						});
					}
					return;
				}
			}
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [capture, host]);

	// Cancel a pending capture on Escape.
	useEffect(() => {
		if (!capture) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setCapture(null);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [capture]);

	// The console command picker replaces the editor body while open.
	if (picking !== null) {
		return (
			<CommandPicker
				onCancel={() => setPicking(null)}
				onPick={(command) => {
					const target = picking;
					setPicking(null);
					if (target === "new") {
						setCapture({ command }); // now capture the input for the new row
					} else {
						const cur = host.gamepadBindings.peek();
						host.setGamepadBindings({
							...cur,
							console: cur.console.map((b, i) =>
								i === target ? { ...b, command } : b,
							),
						});
					}
				}}
			/>
		);
	}

	const removeJoy = (index: number) =>
		host.setGamepadBindings({
			...bindings,
			joystick: bindings.joystick.filter((_, i) => i !== index),
		});
	const removeConsole = (index: number) =>
		host.setGamepadBindings({
			...bindings,
			console: bindings.console.filter((_, i) => i !== index),
		});

	return (
		<div class="flex flex-col gap-3">
			{capture && (
				<p class="rounded-sm bg-amber-50 px-2 py-1 text-xs text-amber-800">
					{messages.controllers.pressInput}
				</p>
			)}

			<div>
				<p class="mb-1 text-xs font-medium text-neutral-500">
					{messages.controllers.joystickSection}
				</p>
				<div class="flex flex-col gap-1">
					{ROLES.map((role) => (
						<div key={role} class="flex items-center gap-2">
							<span class="w-16 shrink-0 text-xs text-neutral-600">
								{messages.controllers.role[role]}
							</span>
							<div class="flex flex-wrap items-center gap-1">
								{bindings.joystick.map((b, i) =>
									b.role === role ? (
										<Chip
											key={i}
											label={`${inputLabel(b.input, standard)} ✕`}
											onClick={() => removeJoy(i)}
										/>
									) : null,
								)}
								<button
									type="button"
									class="rounded-sm border border-dashed border-neutral-300 px-1.5 py-0.5 text-xs text-neutral-500 hover:border-neutral-400"
									onClick={() => setCapture({ role })}
								>
									＋
								</button>
							</div>
						</div>
					))}
				</div>
			</div>

			<div>
				<p class="mb-1 text-xs font-medium text-neutral-500">
					{messages.controllers.consoleSection}
				</p>
				<div class="flex flex-col gap-1">
					{bindings.console.map((b, i) => (
						<div key={i} class="flex items-center gap-2 text-xs">
							<button
								type="button"
								class="flex-1 truncate rounded-sm bg-neutral-100 px-1.5 py-0.5 text-left text-neutral-700 hover:bg-neutral-200"
								onClick={() => setPicking(i)}
							>
								{labelOf(b.command)}
							</button>
							<span class="shrink-0 text-neutral-400">←</span>
							<Chip
								label={inputLabel(b.input, standard)}
								onClick={() => setCapture({ consoleIndex: i })}
							/>
							<button
								type="button"
								class="shrink-0 px-1 text-neutral-400 hover:text-neutral-700"
								onClick={() => removeConsole(i)}
							>
								✕
							</button>
						</div>
					))}
					<button
						type="button"
						class="mt-1 self-start rounded-sm border border-dashed border-neutral-300 px-2 py-0.5 text-xs text-neutral-500 hover:border-neutral-400"
						onClick={() => setPicking("new")}
					>
						＋ {messages.controllers.addBinding}
					</button>
				</div>
			</div>

			<button
				type="button"
				class="self-start text-xs text-neutral-500 underline hover:text-neutral-700"
				onClick={() => host.resetGamepadBindings()}
			>
				{messages.controllers.reset}
			</button>
		</div>
	);
}
