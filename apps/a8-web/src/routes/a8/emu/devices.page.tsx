import { useEffect, useState } from "preact/hooks";
import type { DriveBankEntry, EmulatorHost } from "../../../host.ts";
import { Icon, type IconName } from "../../../icon.tsx";
import { messages } from "../../../messages.ts";
import { navigate } from "../../../navigate.ts";
import { OnOff } from "../../../settings-controls.tsx";
import { DevicesFrame } from "./devices-frame.tsx";
import { useEmu } from "./emu-context.ts";

// /a8/emu/devices - the devices view's D: tab: the bus-wide Serial bus group
// (the SIOV trap, acceleration, and the advertised-speed slider - bus-wide
// behavior above the devices it governs), then the drive bank.
export default function DevicesPage() {
	const { host } = useEmu();
	// Poll the drive bank while the tab is open: a guest write flips a disk's
	// modified flag with no host action to piggyback a refresh on.
	useEffect(() => {
		const timer = setInterval(() => host.refreshDriveBank(), 500);
		return () => clearInterval(timer);
	}, [host]);
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
// The drive bank: all eight drives, always (no add/remove - familiar
// emulators and AspeQt show the full bank). Three states per drive: Empty
// (no disk - no power control, on-but-empty isn't modeled), Active (disk +
// on, answers the bus), Parked (disk + off - the disk is kept, the bus
// hears nothing). Single-line rows with icon actions for compactness.

function DriveBank({ host }: { host: EmulatorHost }) {
	const m = messages.devices;
	return (
		<div class="mt-3 flex flex-col gap-0.5">
			{/* The bank toolbar: rotate up (D2: becomes D1:, D1: wraps to D8:,
			    the multi-disk "next disk" gesture) and its inverse on the left;
			    the other door to disks - the library, pre-filtered - on the
			    right. */}
			<div class="flex items-center gap-1.5 pl-1">
				<DriveAction
					name="arrow-up"
					title={m.rotateUp}
					onClick={() => host.rotateDrives("up")}
				/>
				<DriveAction
					name="arrow-down"
					title={m.rotateDown}
					onClick={() => host.rotateDrives("down")}
				/>
				<button
					type="button"
					class="ml-auto text-sm text-neutral-500 hover:underline"
					onClick={() => navigate("/a8/emu/library?type=disk")}
				>
					{m.library}
				</button>
			</div>
			{host.driveBank.value.map((info, index) => (
				<DriveRow key={index} host={host} unit={index + 1} info={info} />
			))}
		</div>
	);
}

// An icon action in a drive row. `hidden` renders it invisible but
// space-holding, so the icon columns stay aligned across rows; `disabled`
// grays it out (e.g. save with nothing modified).
function DriveAction({
	name,
	title,
	tone = "text-neutral-400 hover:text-neutral-700",
	hidden = false,
	disabled = false,
	onClick,
}: {
	name: IconName;
	title: string;
	tone?: string;
	hidden?: boolean;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			class={`shrink-0 ${disabled ? "text-neutral-200" : tone} ${
				hidden ? "invisible" : ""
			}`}
			title={title}
			aria-label={title}
			disabled={disabled}
			onClick={onClick}
		>
			<Icon name={name} class="size-4" />
		</button>
	);
}

function DriveRow({
	host,
	unit,
	info,
}: {
	host: EmulatorHost;
	unit: number;
	info: DriveBankEntry | null;
}) {
	const m = messages.devices;
	// Drop target: a file dropped on the row attaches to THIS drive
	// (stopPropagation keeps the window-level drop from also booting it).
	// The highlight follows dragover, which re-fires continuously.
	const [dragOver, setDragOver] = useState(false);
	return (
		<div
			class={`flex items-center gap-2 rounded-sm p-1 ${
				dragOver ? "bg-neutral-200" : "hover:bg-neutral-50"
			}`}
			onDragOver={(event) => {
				event.preventDefault();
				event.stopPropagation();
				setDragOver(true);
			}}
			onDragLeave={() => setDragOver(false)}
			onDrop={(event) => {
				event.preventDefault();
				event.stopPropagation();
				setDragOver(false);
				const file = event.dataTransfer?.files[0];
				if (file) void host.attachDiskFile(file, unit, { keepPanel: true });
			}}
		>
			{/* The leading controls: move chevrons (reorder-handle style),
			    write-protect, and drive power. Empty drives have none of the
			    three - invisible placeholders keep the columns aligned. */}
			<div class="flex shrink-0 items-center gap-1.5">
				<DriveAction
					name="chevron-up"
					title={m.moveUp}
					hidden={!info || unit === 1}
					onClick={() => host.moveDrive(unit, "up")}
				/>
				<DriveAction
					name="chevron-down"
					title={m.moveDown}
					hidden={!info || unit === 8}
					onClick={() => host.moveDrive(unit, "down")}
				/>
				{/* Write-protect indicator only - the notch is edited on the
				    disk's library page (it's a property of the medium). */}
				<span
					class={`shrink-0 text-amber-500 ${
						info?.writeProtected ? "" : "invisible"
					}`}
					title={m.writeProtect}
				>
					<Icon name="lock" class="size-4" />
				</span>
				<button
					type="button"
					class={`shrink-0 p-0.5 ${info ? "" : "invisible"}`}
					title={m.drivePower}
					aria-label={m.drivePower}
					aria-pressed={info?.on ?? false}
					onClick={() => host.toggleDriveOn(unit)}
				>
					<span
						class={`block size-2 rounded-full ${
							info?.on ? "bg-green-500" : "bg-neutral-300"
						}`}
					/>
				</button>
			</div>
			<span class="w-7 shrink-0 text-sm font-medium text-neutral-700">
				D{unit}:
			</span>
			{info ? (
				<>
					<span class="shrink-0 rounded-sm bg-neutral-100 px-1 py-px font-mono text-[10px] text-neutral-500">
						{info.density}
					</span>
					{/* The name links to the disk's library page (id-less mounts
					    have none - plain text). */}
					{info.sourceId ? (
						<button
							type="button"
							class={`min-w-0 flex-1 truncate text-left text-sm hover:underline ${
								info.on ? "text-neutral-800" : "text-neutral-400"
							}`}
							title={info.name}
							onClick={() =>
								navigate(
									`/a8/emu/library/${encodeURIComponent(info.sourceId!)}` +
										`?back=${encodeURIComponent("/a8/emu/devices")}`,
								)
							}
						>
							{info.name}
						</button>
					) : (
						<span
							class={`min-w-0 flex-1 truncate text-sm ${
								info.on ? "text-neutral-800" : "text-neutral-400"
							}`}
							title={info.name}
						>
							{info.name}
						</span>
					)}
					<div class="flex shrink-0 items-center gap-1.5">
						<DriveAction
							name="save"
							title={m.saveToLibrary}
							disabled={!info.modified}
							onClick={() => void host.saveDiskToLibrary(unit)}
						/>
						<DriveAction
							name="save-all"
							title={m.saveAsNew}
							disabled={!info.modified}
							onClick={() => void host.saveDiskAsNew(unit)}
						/>
						<DriveAction
							name="folder-open"
							title={m.openFromComputer}
							onClick={() => host.pickAttachDisk(unit)}
						/>
						<DriveAction
							name="close"
							title={m.eject}
							onClick={() => host.detachDisk(unit)}
						/>
					</div>
				</>
			) : (
				<>
					<button
						type="button"
						class="flex-1 truncate text-left text-sm text-neutral-400 hover:text-neutral-600 hover:underline"
						title={m.openFromComputer}
						onClick={() => host.pickAttachDisk(unit)}
					>
						{m.driveEmpty}
					</button>
					<DriveAction
						name="folder-open"
						title={m.openFromComputer}
						onClick={() => host.pickAttachDisk(unit)}
					/>
				</>
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
