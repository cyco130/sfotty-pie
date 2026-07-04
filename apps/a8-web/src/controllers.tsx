import { useEffect, useState } from "preact/hooks";
import { BindingsEditor } from "./gamepad-bindings.tsx";
import { STANDARD_AXES, STANDARD_BUTTONS } from "./gamepad-labels.ts";
import type { EmulatorHost } from "./host.ts";
import { messages } from "./messages.ts";

// A poll's-worth of one pad's state, copied out of the live Gamepad object (which
// is a snapshot that goes stale) so it survives into render.
interface PadSnapshot {
	index: number;
	id: string;
	mapping: string;
	buttons: { pressed: boolean; value: number }[];
	axes: number[];
}

function snapshot(): PadSnapshot[] {
	const out: PadSnapshot[] = [];
	for (const p of navigator.getGamepads()) {
		if (!p) continue;
		out.push({
			index: p.index,
			id: p.id,
			mapping: p.mapping,
			buttons: p.buttons.map((b) => ({ pressed: b.pressed, value: b.value })),
			axes: [...p.axes],
		});
	}
	// Lowest index first, matching the poller's connection-order ports.
	return out.sort((a, b) => a.index - b.index);
}

// Mirror the live pad state on animation frames while mounted. Independent of the
// emulator's own poll — this view just reflects raw input for diagnosis (and,
// later, binding capture).
function useLivePads(): PadSnapshot[] {
	const [pads, setPads] = useState<PadSnapshot[]>(snapshot);
	useEffect(() => {
		let raf = requestAnimationFrame(function tick() {
			setPads(snapshot());
			raf = requestAnimationFrame(tick);
		});
		return () => cancelAnimationFrame(raf);
	}, []);
	return pads;
}

// One axis as a centre-anchored bar (−1 left, +1 right) plus its value.
function AxisBar({ label, value }: { label: string; value: number }) {
	const pct = (value / 2) * 100; // −50…50, measured from the centre
	return (
		<div class="flex items-center gap-2 text-xs">
			<span class="w-8 shrink-0 text-neutral-500">{label}</span>
			<div class="relative h-2 flex-1 rounded-sm bg-neutral-100">
				<div class="absolute top-0 left-1/2 h-full w-px bg-neutral-300" />
				<div
					class="absolute top-0 h-full rounded-sm bg-sky-500"
					style={{
						left: `${pct < 0 ? 50 + pct : 50}%`,
						width: `${Math.abs(pct)}%`,
					}}
				/>
			</div>
			<span class="w-10 shrink-0 text-right text-neutral-500 tabular-nums">
				{value.toFixed(2)}
			</span>
		</div>
	);
}

// The port picker for one pad: Off / Player 1-4. Reassigning is live.
function PortSelect({
	port,
	onSelect,
}: {
	port: number | null;
	onSelect: (port: number | null) => void;
}) {
	return (
		<select
			class="shrink-0 rounded-sm border border-neutral-200 bg-white px-1 py-0.5 text-xs text-neutral-700"
			value={port === null ? "off" : String(port)}
			onChange={(e) => {
				const v = (e.target as HTMLSelectElement).value;
				onSelect(v === "off" ? null : Number(v));
			}}
		>
			<option value="off">{messages.controllers.off}</option>
			{[0, 1, 2, 3].map((p) => (
				<option key={p} value={String(p)}>
					{messages.controllers.joystick} {p}
				</option>
			))}
		</select>
	);
}

function PadCard({
	pad,
	port,
	onPort,
}: {
	pad: PadSnapshot;
	port: number | null;
	onPort: (port: number | null) => void;
}) {
	const standard = pad.mapping === "standard";
	return (
		<div class="rounded-sm border border-neutral-200 p-3">
			<div class="mb-1 flex items-center justify-between gap-2">
				<span class="truncate text-sm font-medium" title={pad.id}>
					{pad.id}
				</span>
				<span class="shrink-0 rounded-sm bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">
					{standard
						? messages.controllers.standard
						: messages.controllers.nonStandard}
				</span>
			</div>
			<div class="mb-3">
				<PortSelect port={port} onSelect={onPort} />
			</div>

			<p class="mb-1 text-xs font-medium text-neutral-500">
				{messages.controllers.buttons}
			</p>
			<div class="mb-3 grid grid-cols-4 gap-1">
				{pad.buttons.map((b, i) => (
					<div
						key={i}
						class={`rounded-sm p-1 text-center text-xs tabular-nums ${
							b.pressed
								? "bg-emerald-500 text-white"
								: "bg-neutral-100 text-neutral-500"
						}`}
						title={standard ? STANDARD_BUTTONS[i] : String(i)}
					>
						{standard ? (STANDARD_BUTTONS[i] ?? i) : i}
					</div>
				))}
			</div>

			<p class="mb-1 text-xs font-medium text-neutral-500">
				{messages.controllers.axes}
			</p>
			<div class="flex flex-col gap-1">
				{pad.axes.map((v, i) => (
					<AxisBar
						key={i}
						label={standard ? (STANDARD_AXES[i] ?? String(i)) : String(i)}
						value={v}
					/>
				))}
			</div>
		</div>
	);
}

/**
 * The controllers panel body: a live monitor of every connected gamepad — button
 * grid (lit when pressed) and axis bars — for diagnosing what a pad reports.
 * Read-only for now; port assignment, binding, and calibration build on top.
 */
export function ControllersView({ host }: { host: EmulatorHost }) {
	const pads = useLivePads();
	// Port assignments, by gamepad.index, from the poller.
	const ports = new Map(host.gamepads.value.map((p) => [p.index, p.port]));
	return (
		<div class="flex flex-col gap-4 overflow-y-auto">
			{pads.length === 0 ? (
				<p class="text-sm text-neutral-500">{messages.controllers.noPad}</p>
			) : (
				<div class="flex flex-col gap-3">
					{pads.map((pad) => (
						<PadCard
							key={pad.index}
							pad={pad}
							port={ports.get(pad.index) ?? null}
							onPort={(port) => host.setGamepadPort(pad.index, port)}
						/>
					))}
				</div>
			)}
			<div>
				<p class="mb-2 text-sm font-semibold text-neutral-700">
					{messages.controllers.bindings}
				</p>
				<BindingsEditor host={host} />
			</div>
		</div>
	);
}
