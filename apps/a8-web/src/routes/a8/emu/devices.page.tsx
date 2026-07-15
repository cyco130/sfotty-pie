import { useState } from "preact/hooks";
import type { EmulatorHost } from "../../../host.ts";
import { messages } from "../../../messages.ts";
import { OnOff } from "../../../settings-controls.tsx";
import { DevicesFrame } from "./devices-frame.tsx";
import { useEmu } from "./emu-context.ts";

// /a8/emu/devices - the devices view's D: tab: the bus-wide Serial bus group
// (the SIOV trap, acceleration, and the advertised-speed slider - bus-wide
// behavior above the devices it governs), then the drive bank.
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
				<DriveBank host={host} />
			</div>
		</DevicesFrame>
	);
}

// ---------------------------------------------------------------------------
// The drive bank - MOCK, nothing is wired up. A non-functional pass so the
// layout can be judged in context; all eight drives are always visible (no
// add/remove - familiar emulators and AspeQt show the full bank). Three
// states per drive: Empty (no disk - no power control, on-but-empty isn't
// modeled), Active (disk + on, answers the bus), Parked (disk + off - keeps
// its media like the favorites shelf keeps games; the bus hears nothing).
// D1: mirrors the live attachment for realism; D2:/D3: are staged samples
// (an active write-protected disk, a parked disk), the rest empty.

interface MockDisk {
	name: string;
	density: string; // ATR density tag (SD/ED/DD) - hardware tokens
	writeProtected: boolean;
}

interface MockDrive {
	unit: number;
	on: boolean; // meaningful only with a disk in: on = attached to the bus
	disk: MockDisk | null;
}

function DriveBank({ host }: { host: EmulatorHost }) {
	const d1Name = host.attachments.value.drives[0] ?? null;
	const drives: MockDrive[] = [
		{
			unit: 1,
			on: true,
			disk: d1Name
				? { name: d1Name, density: "SD", writeProtected: false }
				: null,
		},
		{
			unit: 2,
			on: true,
			disk: { name: "sample.atr", density: "DD", writeProtected: true },
		},
		{
			unit: 3,
			on: false,
			disk: { name: "parked.atr", density: "SD", writeProtected: false },
		},
		...[4, 5, 6, 7, 8].map((unit) => ({ unit, on: false, disk: null })),
	];
	return (
		<div class="mt-3 flex flex-col gap-1">
			{drives.map((drive) => (
				<DriveRow key={drive.unit} drive={drive} />
			))}
		</div>
	);
}

// A small text action in a drive card (mock: no onClick yet).
function DriveAction({ label }: { label: string }) {
	return (
		<button
			type="button"
			class="text-xs text-neutral-500 underline-offset-2 hover:text-neutral-800 hover:underline"
		>
			{label}
		</button>
	);
}

function DriveRow({ drive }: { drive: MockDrive }) {
	const m = messages.devices;
	return (
		<div class="rounded-sm border border-neutral-200 px-2 py-1.5">
			<div class="flex items-center gap-2">
				{/* Drive power - only with a disk in (an empty drive has no
				    on-state to toggle). Off keeps the disk but leaves the bus
				    silent. */}
				{drive.disk && (
					<button
						type="button"
						class="shrink-0 p-0.5"
						title={m.drivePower}
						aria-label={m.drivePower}
						aria-pressed={drive.on}
					>
						<span
							class={`block size-2 rounded-full ${
								drive.on ? "bg-green-500" : "bg-neutral-300"
							}`}
						/>
					</button>
				)}
				{/* The slot-label column is the alignment grid the other tabs'
				    cards will reuse; empty drives (no power dot) indent to it. */}
				<span
					class={`w-7 shrink-0 text-sm font-medium text-neutral-700 ${
						drive.disk ? "" : "ml-5"
					}`}
				>
					D{drive.unit}:
				</span>
				{drive.disk ? (
					<>
						<span class="shrink-0 rounded-sm bg-neutral-100 px-1 py-px font-mono text-[10px] text-neutral-500">
							{drive.disk.density}
						</span>
						<span
							class={`min-w-0 flex-1 truncate text-sm ${
								drive.on ? "text-neutral-800" : "text-neutral-400"
							}`}
							title={drive.disk.name}
						>
							{drive.disk.name}
						</span>
					</>
				) : (
					<>
						<span class="flex-1 text-sm text-neutral-400">{m.driveEmpty}</span>
						<DriveAction label={m.insert} />
					</>
				)}
			</div>
			{drive.disk && (
				<div class="mt-1 flex items-center gap-3 pl-7">
					<DriveAction label={m.swap} />
					<DriveAction label={m.eject} />
					<DriveAction label={m.saveAs} />
					<label class="ml-auto flex items-center gap-1 text-xs text-neutral-500">
						<input type="checkbox" checked={drive.disk.writeProtected} />
						{m.writeProtect}
					</label>
				</div>
			)}
		</div>
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
