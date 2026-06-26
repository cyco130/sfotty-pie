import {
	preferredBasicKeys,
	preferredOsKeys,
	type AtariModel,
	type FirmwareKey,
} from "@sfotty-pie/a8";
import { useEffect } from "preact/hooks";
import {
	builtinFirmware,
	type FirmwareLibraryEntry,
} from "virtual:firmware-library";
import { osSlotFor } from "../../../firmware-slots.ts";
import type {
	EmulatorHost,
	MachineSettings,
	RomOverrides,
} from "../../../host.ts";
import { hasBuiltinBasic } from "../../../machine-config.ts";
import { messages } from "../../../messages.ts";
import { useEmu } from "./emu-context.ts";
import { PanelFrame } from "./panel-frame.tsx";

// /a8/emu/roms — the firmware selector, populated from `virtual:firmware-library`
// (the build-time library scan). Each slot lists qualifying manifest entries
// best-first, with the running machine's auto-pick as the default. The slot(s)
// feeding the running machine are marked "in use"; unsaved picks get a dot.
//
// Picks are staged like the machine config and committed by the apply button —
// which reboots only when the change touches the running machine, else just
// saves. In-memory only (not persisted). The combined XEGS ROM never appears as
// a unit; the plugin slices it.

interface SlotDef {
	label: string;
	accepts: string;
	/** Which manifest entries qualify for this slot. */
	match: (entry: FirmwareLibraryEntry) => boolean;
	/** Firmware keys best-first; entries off the list sort last, then by name. */
	ranking: readonly FirmwareKey[];
	/** Whether this slot feeds the currently-running machine. */
	active: (config: MachineSettings) => boolean;
	/** This slot's override within a set (null = automatic). */
	read: (roms: RomOverrides) => FirmwareKey | null;
	/** Stage a pick (null clears the override, back to automatic). */
	set: (host: EmulatorHost, key: FirmwareKey | null) => void;
}

// XL/XE-class slots ignore tv in the ranking; "ntsc" is just a filler there.
const osRanking = (model: AtariModel): readonly FirmwareKey[] =>
	preferredOsKeys({ model, tv: "ntsc" });

const OS_SLOTS: SlotDef[] = [
	{
		label: "400/800 NTSC",
		accepts: "10K OS ROM",
		match: (e) => e.format === "os-rom-10k",
		ranking: preferredOsKeys({ model: "400/800", tv: "ntsc" }),
		active: (c) => osSlotFor(c.model, c.tv) === "800-ntsc",
		read: (r) => r.os["800-ntsc"] ?? null,
		set: (h, k) => h.stageOsRom("800-ntsc", k),
	},
	{
		label: "400/800 PAL",
		accepts: "10K OS ROM",
		match: (e) => e.format === "os-rom-10k",
		ranking: preferredOsKeys({ model: "400/800", tv: "pal" }),
		active: (c) => osSlotFor(c.model, c.tv) === "800-pal",
		read: (r) => r.os["800-pal"] ?? null,
		set: (h, k) => h.stageOsRom("800-pal", k),
	},
	{
		label: "XL/XE",
		accepts: "16K OS ROM",
		match: (e) => e.format === "os-rom-16k",
		ranking: osRanking("xl/xe"),
		active: (c) => osSlotFor(c.model, c.tv) === "xlxe",
		read: (r) => r.os.xlxe ?? null,
		set: (h, k) => h.stageOsRom("xlxe", k),
	},
	{
		label: "1200XL",
		accepts: "16K OS ROM",
		match: (e) => e.format === "os-rom-16k",
		ranking: osRanking("1200xl"),
		active: (c) => osSlotFor(c.model, c.tv) === "1200xl",
		read: (r) => r.os["1200xl"] ?? null,
		set: (h, k) => h.stageOsRom("1200xl", k),
	},
	{
		label: "XEGS",
		accepts: "16K OS ROM",
		match: (e) => e.format === "os-rom-16k",
		ranking: osRanking("xegs"),
		active: (c) => osSlotFor(c.model, c.tv) === "xegs",
		read: (r) => r.os.xegs ?? null,
		set: (h, k) => h.stageOsRom("xegs", k),
	},
];

const CART_SLOTS: SlotDef[] = [
	{
		label: "BASIC",
		accepts: "8K cartridge",
		match: (e) => e.firmwareType === "basic",
		ranking: preferredBasicKeys(),
		// Built-in BASIC (xl/xe, xegs) is always loaded; cart BASIC (400/800,
		// 1200xl) only when enabled.
		active: (c) => hasBuiltinBasic(c.model) || !c.basicDisabled,
		read: (r) => r.basic,
		set: (h, k) => h.stageBasicRom(k),
	},
	{
		label: "XEGS built-in game",
		accepts: "8K cartridge",
		match: (e) => e.firmwareType === "game",
		ranking: [],
		active: (c) => c.model === "xegs",
		read: (r) => r.game,
		set: (h, k) => h.stageGameRom(k),
	},
];

/** A slot's qualifying entries, best-first (preference rank, then name). */
function candidatesFor(slot: SlotDef): FirmwareLibraryEntry[] {
	const rank = new Map(slot.ranking.map((key, index) => [key, index]));
	const rankOf = (entry: FirmwareLibraryEntry): number =>
		entry.firmwareKey != null
			? (rank.get(entry.firmwareKey) ?? Infinity)
			: Infinity;
	return builtinFirmware
		.filter(slot.match)
		.sort((a, b) => rankOf(a) - rankOf(b) || a.name.localeCompare(b.name));
}

/** One slot: label + format hint over a full-width picker (long ROM names). */
function Slot({ slot, host }: { slot: SlotDef; host: EmulatorHost }) {
	const entries = candidatesFor(slot);
	const best = entries[0];
	const empty = best === undefined;
	const stagedKey = slot.read(host.stagedRoms.value);
	const appliedKey = slot.read(host.appliedRoms.value);
	const staged = stagedKey !== appliedKey; // unapplied change for this slot
	const active = slot.active(host.config.value);
	// Show the staged pick; falling back to the best-fit (the automatic default).
	const value = stagedKey ?? best?.firmwareKey ?? "";
	return (
		<div class="flex flex-col gap-1">
			<div class="flex items-baseline justify-between gap-2">
				<span
					class={`flex items-center gap-1.5 text-sm font-medium ${empty ? "text-neutral-400" : "text-neutral-800"}`}
				>
					{staged && (
						<span
							class="size-1.5 shrink-0 rounded-full bg-amber-500"
							title={messages.roms.unsaved}
						/>
					)}
					{slot.label}
					{active && (
						<span class="rounded bg-emerald-100 px-1.5 text-[10px] font-medium tracking-wide text-emerald-700 uppercase">
							{messages.roms.inUse}
						</span>
					)}
				</span>
				<span class="text-xs text-neutral-400">{slot.accepts}</span>
			</div>
			<select
				aria-label={slot.label}
				disabled={empty}
				value={value}
				class={
					empty
						? "w-full cursor-not-allowed rounded border border-neutral-200 bg-neutral-100 px-2 py-1 text-sm text-neutral-400"
						: `w-full rounded border bg-white px-2 py-1 text-sm text-neutral-800 ${active ? "border-emerald-400" : "border-neutral-300"}`
				}
				onChange={(event) => {
					// Picking the best-fit clears the override (no spurious staged change).
					const key = event.currentTarget.value as FirmwareKey;
					slot.set(host, key === best?.firmwareKey ? null : key);
				}}
			>
				{empty ? (
					<option>{messages.roms.noSuitable}</option>
				) : (
					entries.map((entry) => (
						<option key={entry.id} value={entry.firmwareKey ?? ""}>
							{entry.name}
						</option>
					))
				)}
			</select>
		</div>
	);
}

function Section({
	title,
	slots,
	host,
}: {
	title: string;
	slots: SlotDef[];
	host: EmulatorHost;
}) {
	return (
		<section>
			<h2 class="mb-3 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
				{title}
			</h2>
			<div class="flex flex-col gap-4">
				{slots.map((slot) => (
					<Slot key={slot.label} slot={slot} host={host} />
				))}
			</div>
		</section>
	);
}

export default function RomsPage() {
	const { host } = useEmu();
	// Open with the working copy matching what's applied (discard prior staging).
	useEffect(() => host.syncStagedRoms(), [host]);
	const dirty = host.romsDirty.value;
	return (
		<PanelFrame title={messages.roms.title}>
			<div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
				<Section title={messages.roms.osRoms} slots={OS_SLOTS} host={host} />
				<Section
					title={messages.roms.cartRoms}
					slots={CART_SLOTS}
					host={host}
				/>
				{dirty && (
					<button
						type="button"
						class="w-full rounded bg-neutral-800 px-2 py-1 text-sm text-white hover:bg-neutral-700"
						onClick={() => host.applyRoms()}
					>
						{host.romsReboot.value
							? messages.sidebar.rebootToApply
							: messages.roms.save}
					</button>
				)}
				<div class="flex items-baseline justify-between gap-2">
					<p class="text-xs text-neutral-400">{messages.roms.picksReset}</p>
					<button
						type="button"
						class="shrink-0 text-xs text-neutral-500 hover:underline"
						onClick={() => host.showPanel("library")}
					>
						{messages.roms.manageLibrary} →
					</button>
				</div>
			</div>
		</PanelFrame>
	);
}
