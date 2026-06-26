import {
	preferredBasicKeys,
	preferredOsKeys,
	type AtariModel,
	type FirmwareKey,
} from "@sfotty-pie/a8";
import { useEffect } from "preact/hooks";
import { osSlotFor } from "../../../firmware-slots.ts";
import type {
	EmulatorHost,
	MachineSettings,
	RomOverrides,
} from "../../../host.ts";
import { libraryEntries, readyLibrary } from "../../../images/library.ts";
import type { ImageEntry } from "../../../images/metadata.ts";
import { hasBuiltinBasic } from "../../../machine-config.ts";
import { messages } from "../../../messages.ts";
import { useEmu } from "./emu-context.ts";
import { PanelFrame } from "./panel-frame.tsx";

// /a8/emu/roms — the firmware selector, populated from the unified image
// library (built-ins ∪ your uploads). Each slot lists qualifying images
// best-first (built-ins by preference rank, then your ROMs by name), with the
// running machine's auto-pick as the default. The slot(s) feeding the running
// machine are marked "in use"; unsaved picks get a dot. Uploads happen in the
// separate library panel — this only selects.
//
// Picks are staged like the machine config and committed by the apply button —
// which reboots only when the change touches the running machine, else just
// saves. In-memory only (not persisted). Overrides reference image ids.

interface SlotDef {
	label: string;
	accepts: string;
	/** Which library images qualify for this slot. */
	match: (entry: ImageEntry) => boolean;
	/** Firmware keys best-first; built-ins off the list (and user ROMs) sort last. */
	ranking: readonly FirmwareKey[];
	/** Whether this slot feeds the currently-running machine. */
	active: (config: MachineSettings) => boolean;
	/** This slot's override within a set (null = automatic). */
	read: (roms: RomOverrides) => string | null;
	/** Stage a pick (null clears the override, back to automatic). */
	set: (host: EmulatorHost, id: string | null) => void;
}

// XL/XE-class slots ignore tv in the ranking; "ntsc" is just a filler there.
const osRanking = (model: AtariModel): readonly FirmwareKey[] =>
	preferredOsKeys({ model, tv: "ntsc" });

// OS slots qualify by size class (10K → 400/800, 16K → XL/XE-class); a user OS
// ROM joins the slots whose size it matches.
const isOs =
	(sizeClass: 10 | 16) =>
	(entry: ImageEntry): boolean =>
		entry.derived.type === "os" && entry.derived.sizeClass === sizeClass;

const OS_SLOTS: SlotDef[] = [
	{
		label: "400/800 NTSC",
		accepts: "10K OS ROM",
		match: isOs(10),
		ranking: preferredOsKeys({ model: "400/800", tv: "ntsc" }),
		active: (c) => osSlotFor(c.model, c.tv) === "800-ntsc",
		read: (r) => r.os["800-ntsc"] ?? null,
		set: (h, id) => h.stageOsRom("800-ntsc", id),
	},
	{
		label: "400/800 PAL",
		accepts: "10K OS ROM",
		match: isOs(10),
		ranking: preferredOsKeys({ model: "400/800", tv: "pal" }),
		active: (c) => osSlotFor(c.model, c.tv) === "800-pal",
		read: (r) => r.os["800-pal"] ?? null,
		set: (h, id) => h.stageOsRom("800-pal", id),
	},
	{
		label: "XL/XE",
		accepts: "16K OS ROM",
		match: isOs(16),
		ranking: osRanking("xl/xe"),
		active: (c) => osSlotFor(c.model, c.tv) === "xlxe",
		read: (r) => r.os.xlxe ?? null,
		set: (h, id) => h.stageOsRom("xlxe", id),
	},
	{
		label: "1200XL",
		accepts: "16K OS ROM",
		match: isOs(16),
		ranking: osRanking("1200xl"),
		active: (c) => osSlotFor(c.model, c.tv) === "1200xl",
		read: (r) => r.os["1200xl"] ?? null,
		set: (h, id) => h.stageOsRom("1200xl", id),
	},
	{
		label: "XEGS",
		accepts: "16K OS ROM",
		match: isOs(16),
		ranking: osRanking("xegs"),
		active: (c) => osSlotFor(c.model, c.tv) === "xegs",
		read: (r) => r.os.xegs ?? null,
		set: (h, id) => h.stageOsRom("xegs", id),
	},
];

const CART_SLOTS: SlotDef[] = [
	{
		label: "BASIC",
		accepts: "8K cartridge",
		// Known BASICs only — the slot flag is primed solely from detected firmware.
		match: (e) => e.user.slots?.includes("basic") ?? false,
		ranking: preferredBasicKeys(),
		// Built-in BASIC (xl/xe, xegs) is always loaded; cart BASIC (400/800,
		// 1200xl) only when enabled.
		active: (c) => hasBuiltinBasic(c.model) || !c.basicDisabled,
		read: (r) => r.basic,
		set: (h, id) => h.stageBasicRom(id),
	},
	{
		label: "XEGS built-in game",
		accepts: "8K cartridge",
		match: (e) => e.user.slots?.includes("game") ?? false,
		ranking: [],
		active: (c) => c.model === "xegs",
		read: (r) => r.game,
		set: (h, id) => h.stageGameRom(id),
	},
];

/** A slot's qualifying images: built-ins first (by rank), then your ROMs by name. */
function candidatesFor(slot: SlotDef): ImageEntry[] {
	const rank = new Map<string, number>(
		slot.ranking.map((key, index) => [key, index]),
	);
	// A built-in's id is its firmware key; user ROMs have no rank.
	const rankOf = (e: ImageEntry): number =>
		e.source === "builtin" ? (rank.get(e.id) ?? Infinity) : Infinity;
	return libraryEntries.value
		.filter(slot.match)
		.sort(
			(a, b) =>
				(a.source === "builtin" ? 0 : 1) - (b.source === "builtin" ? 0 : 1) ||
				rankOf(a) - rankOf(b) ||
				a.user.displayName.localeCompare(b.user.displayName),
		);
}

/** One slot: label + format hint over a full-width picker grouped built-in / yours. */
function Slot({ slot, host }: { slot: SlotDef; host: EmulatorHost }) {
	const entries = candidatesFor(slot);
	const builtins = entries.filter((e) => e.source === "builtin");
	const yours = entries.filter((e) => e.source === "user");
	// The automatic default is the top-ranked built-in — what the host auto-picks.
	const best = builtins[0];
	const empty = entries.length === 0;
	const stagedId = slot.read(host.stagedRoms.value);
	const appliedId = slot.read(host.appliedRoms.value);
	const staged = stagedId !== appliedId; // unapplied change for this slot
	const active = slot.active(host.config.value);
	// Show the staged pick, falling back to the auto-pick default.
	const value = stagedId ?? best?.id ?? "";
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
					// Picking the auto-pick default clears the override (no staged change).
					const id = event.currentTarget.value;
					slot.set(host, id === best?.id ? null : id);
				}}
			>
				{empty ? (
					<option>{messages.roms.noSuitable}</option>
				) : (
					<>
						{builtins.length > 0 && (
							<optgroup label={messages.roms.builtin}>
								{builtins.map((entry) => (
									<option key={entry.id} value={entry.id}>
										{entry.user.displayName}
									</option>
								))}
							</optgroup>
						)}
						{yours.length > 0 && (
							<optgroup label={messages.roms.yourRoms}>
								{yours.map((entry) => (
									<option key={entry.id} value={entry.id}>
										{entry.user.displayName}
									</option>
								))}
							</optgroup>
						)}
					</>
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
	// Pull the user's uploads into the merged candidate lists.
	useEffect(() => void readyLibrary(), []);
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
