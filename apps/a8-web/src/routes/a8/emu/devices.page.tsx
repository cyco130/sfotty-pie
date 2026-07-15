import { useState } from "preact/hooks";
import type { EmulatorHost } from "../../../host.ts";
import { messages } from "../../../messages.ts";
import { OnOff } from "../../../settings-controls.tsx";
import { DevicesFrame } from "./devices-frame.tsx";
import { useEmu } from "./emu-context.ts";

// /a8/emu/devices - the devices view's D: tab. Drive cards come later; for
// now it hosts the bus-wide Serial bus group (moved from the Hardware tab):
// the SIOV trap, acceleration, and the advertised-speed slider. Bus-wide
// behavior sits above the devices it governs.
export default function DevicesPage() {
	const { host } = useEmu();
	return (
		<DevicesFrame active="disks">
			<div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
				<OnOff
					label={messages.devices.trapSiov}
					value={host.sioTrap.value}
					onSet={(on) => host.setSioTrap(on)}
				/>
				<OnOff
					label={messages.devices.accelerateSio}
					value={host.sioAcceleration.value}
					onSet={(on) => host.setSioAcceleration(on)}
				/>
				<SpeedSlider host={host} />
			</div>
		</DevicesFrame>
	);
}

// A stock drive answers no $3F poll at all; that's the slider's left end,
// stored as an undefined divisor. Every other position advertises its
// divisor via the poll.
const STANDARD = 40;

// The drive names real hardware shipped for a divisor (AHRM table 45),
// shown in the readout when the slider lands on one. Hardware tokens,
// kept inline.
const DRIVE_NAMES: Record<number, string> = {
	10: "US Doubler",
	9: "Speedy 1050",
	6: "1050 Turbo",
};

// The tick legend under the slider: the conventional nominal rates, each at
// the divisor it corresponds to. The right end (divisor 0) is just "max" -
// its ~128k has no household name.
const TICKS = [
	{ divisor: 40, label: "~19.2k" },
	{ divisor: 15, label: "~38.4k" },
	{ divisor: 8, label: "~57.6k" },
	{ divisor: 0, label: messages.devices.sioSpeedMax },
];

// The actual NTSC receive rate for a POKEY divisor (async serial:
// 1.79 MHz / (2 * (divisor + 7))), shown in the live readout. PAL differs
// by under one percent - not worth a second figure.
function rateLabel(divisor: number): string {
	return `${(1789772.5 / (2 * (divisor + 7)) / 1000).toFixed(1)}k`;
}

/**
 * The SIO speed slider: the advertised high-speed divisor, slow (40 =
 * standard, no $3F answer) to fast (0) left to right, with the nominal-rate
 * legend below and a live readout of the actual rate above.
 */
function SpeedSlider({ host }: { host: EmulatorHost }) {
	// Track the thumb during a drag so the readout follows it live; the host
	// (and its toast) only hears the final value on release.
	const [dragging, setDragging] = useState<number | null>(null);
	const divisor = dragging ?? host.diskSpeed.value ?? STANDARD;
	const driveName = DRIVE_NAMES[divisor];

	// The slider runs slow-to-fast, so its position is the divisor mirrored
	// (40 - divisor).
	return (
		<div class="flex flex-col gap-1">
			<div class="flex items-center justify-between gap-3">
				<span class="text-sm text-neutral-600">
					{messages.devices.sioSpeed}
				</span>
				<span class="text-sm text-neutral-700">
					{rateLabel(divisor)} ·{" "}
					{divisor === STANDARD
						? messages.devices.sioSpeedStandard
						: messages.devices.divisorValue(divisor)}
					{driveName && ` (${driveName})`}
				</span>
			</div>
			<input
				type="range"
				min={0}
				max={STANDARD}
				step={1}
				value={STANDARD - divisor}
				aria-label={messages.devices.sioSpeed}
				onInput={(event) =>
					setDragging(STANDARD - Number(event.currentTarget.value))
				}
				onChange={(event) => {
					const value = STANDARD - Number(event.currentTarget.value);
					setDragging(null);
					host.setDiskSpeed(value === STANDARD ? undefined : value);
				}}
			/>
			<div class="relative h-4 text-xs text-neutral-400">
				{/* End labels anchor to the edges (centering would spill out of
				    the panel); the middle ones center on their track position. */}
				{TICKS.map((tick, index) => (
					<span
						key={tick.divisor}
						class={
							index === 0
								? "absolute left-0"
								: index === TICKS.length - 1
									? "absolute right-0"
									: "absolute -translate-x-1/2"
						}
						style={
							index > 0 && index < TICKS.length - 1
								? {
										left: `${((STANDARD - tick.divisor) / STANDARD) * 100}%`,
									}
								: undefined
						}
					>
						{tick.label}
					</span>
				))}
			</div>
		</div>
	);
}
