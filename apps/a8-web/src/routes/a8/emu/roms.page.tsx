import {
	preferredBasicKeys,
	preferredOsKeys,
	type AtariModel,
	type FirmwareKey,
} from "@sfotty-pie/a8";
import {
	builtinFirmware,
	type FirmwareLibraryEntry,
} from "virtual:firmware-library";
import { PanelFrame } from "./panel-frame.tsx";

// /a8/emu/roms — the firmware selector, populated from `virtual:firmware-library`
// (the build-time library scan). Each slot picks the manifest entries whose
// format/identity qualify, best-first per firmware-preferences.
//
// Display-only for now: changing a select doesn't apply yet — that lands with
// the options store. The combined XEGS ROM never appears here as a unit; the
// plugin slices it, so its OS piece shows up as a 16K OS option (and usually
// dedupes against a standalone), etc.

interface SlotDef {
	label: string;
	accepts: string;
	/** Which manifest entries qualify for this slot. */
	match: (entry: FirmwareLibraryEntry) => boolean;
	/** Firmware keys best-first; entries off the list sort last, then by name. */
	ranking: readonly FirmwareKey[];
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
	},
	{
		label: "400/800 PAL",
		accepts: "10K OS ROM",
		match: (e) => e.format === "os-rom-10k",
		ranking: preferredOsKeys({ model: "400/800", tv: "pal" }),
	},
	{
		label: "XL/XE",
		accepts: "16K OS ROM",
		match: (e) => e.format === "os-rom-16k",
		ranking: osRanking("xl/xe"),
	},
	{
		label: "1200XL",
		accepts: "16K OS ROM",
		match: (e) => e.format === "os-rom-16k",
		ranking: osRanking("1200xl"),
	},
	{
		label: "XEGS",
		accepts: "16K OS ROM",
		match: (e) => e.format === "os-rom-16k",
		ranking: osRanking("xegs"),
	},
];

const CART_SLOTS: SlotDef[] = [
	{
		label: "BASIC",
		accepts: "8K cartridge",
		match: (e) => e.firmwareType === "basic",
		ranking: preferredBasicKeys(),
	},
	{
		label: "XEGS built-in game",
		accepts: "8K cartridge",
		match: (e) => e.firmwareType === "game",
		ranking: [],
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
function Slot({ slot }: { slot: SlotDef }) {
	const entries = candidatesFor(slot);
	const best = entries[0];
	// No "(none)": the top candidate is always the default. A slot with no
	// qualifying ROM is disabled with a "no suitable ROMs" placeholder.
	const empty = best === undefined;
	return (
		<div class="flex flex-col gap-1">
			<div class="flex items-baseline justify-between gap-2">
				<span
					class={`text-sm font-medium ${empty ? "text-neutral-400" : "text-neutral-800"}`}
				>
					{slot.label}
				</span>
				<span class="text-xs text-neutral-400">{slot.accepts}</span>
			</div>
			<select
				aria-label={slot.label}
				disabled={empty}
				class={
					empty
						? "w-full cursor-not-allowed rounded border border-neutral-200 bg-neutral-100 px-2 py-1 text-sm text-neutral-400"
						: "w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-800"
				}
			>
				{empty ? (
					<option>No suitable ROMs</option>
				) : (
					entries.map((entry) => (
						<option key={entry.id} selected={entry === best}>
							{entry.name}
						</option>
					))
				)}
			</select>
		</div>
	);
}

function Section({ title, slots }: { title: string; slots: SlotDef[] }) {
	return (
		<section>
			<h2 class="mb-3 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
				{title}
			</h2>
			<div class="flex flex-col gap-4">
				{slots.map((slot) => (
					<Slot key={slot.label} slot={slot} />
				))}
			</div>
		</section>
	);
}

export default function RomsPage() {
	return (
		<PanelFrame title="ROMs">
			<div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
				<Section title="OS ROMs" slots={OS_SLOTS} />
				<Section title="Built-in cartridge ROMs" slots={CART_SLOTS} />
				<p class="text-xs text-neutral-400">
					Selections aren’t applied yet — that comes with the options store.
				</p>
			</div>
		</PanelFrame>
	);
}
