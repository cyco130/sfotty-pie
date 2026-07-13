import { useState } from "preact/hooks";
import type { Command } from "./commands.ts";
import type { EmulatorHost } from "./host.ts";
import { Icon } from "./icon.tsx";
import { primaryChords, type Binding } from "./key-bindings.ts";
import {
	anticPolicy,
	MODELS,
	MODEL_LABELS,
	RAM_SIZES,
	ramTotal,
	type AtariModel,
} from "./machine-config.ts";
import { messages } from "./messages.ts";
import {
	GroupHeading,
	LabeledSelect,
	OnOff,
	Segmented,
} from "./settings-controls.tsx";
import { favoriteIds, toggleFavorite } from "./favorites.ts";
import { recentsView } from "./recents.ts";
import { TypePill } from "./type-pill.tsx";

/** A row in the key-mappings help. */
function KeyRow({ keys, action }: { keys: string; action: string }) {
	return (
		<>
			<dt class="whitespace-nowrap text-neutral-500">{keys}</dt>
			<dd>{action}</dd>
		</>
	);
}

/**
 * The recents list: images you've booted (newest first), then the built-in
 * software you haven't, so it's never empty. Click to boot; a transient
 * (file-booted) item can be kept in the library, and any history item removed.
 */
function RecentsSection({ host }: { host: EmulatorHost }) {
	const items = recentsView.value;
	const favorites = favoriteIds.value;
	if (items.length === 0) return null;
	return (
		<section>
			<h2 class="mb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
				{messages.recents.title}
			</h2>
			<ul class="flex flex-col gap-1">
				{items.map(({ entry, recent }) => (
					<li
						key={entry.id}
						class="flex items-center gap-2 rounded-sm px-1.5 py-1 transition-colors duration-150 hover:bg-neutral-100"
					>
						<TypePill type={entry.derived.type} />
						<button
							type="button"
							class="min-w-0 flex-1 truncate text-left text-sm hover:underline"
							title={entry.user.displayName}
							onClick={() => void host.bootImage(entry.id)}
						>
							{entry.user.displayName}
						</button>
						<button
							type="button"
							class={`shrink-0 ${
								favorites.includes(entry.id)
									? "text-amber-500 hover:text-amber-600"
									: "text-neutral-300 hover:text-neutral-500"
							}`}
							title={
								favorites.includes(entry.id)
									? messages.recents.unfavorite
									: messages.recents.favorite
							}
							aria-label={
								favorites.includes(entry.id)
									? messages.recents.unfavorite
									: messages.recents.favorite
							}
							onClick={() => toggleFavorite(entry.id)}
						>
							<Icon name="star" class="size-4" />
						</button>
						{entry.transient && (
							<button
								type="button"
								class="shrink-0 text-neutral-400 hover:text-neutral-700"
								title={messages.recents.keepTitle}
								aria-label={messages.recents.keepTitle}
								onClick={() => host.keepRecent(entry.id)}
							>
								<Icon name="bookmark" class="size-4" />
							</button>
						)}
						{recent && (
							<button
								type="button"
								class="shrink-0 text-neutral-400 hover:text-neutral-700"
								title={messages.recents.remove}
								aria-label={messages.recents.remove}
								onClick={() => host.removeFromRecents(entry.id)}
							>
								<Icon name="close" class="size-4" />
							</button>
						)}
					</li>
				))}
			</ul>
		</section>
	);
}

// The disk SIO speed presets: the divisor each real device advertised via
// the $3F poll (drive names and rates are hardware tokens, kept inline).
// "standard" = a stock drive that answers no $3F at all.
const SPEED_PRESETS = [
	{ value: "standard", label: messages.sidebar.speedStandard },
	{ value: "15", label: "~38400 (divisor 15)" },
	{ value: "10", label: "US Doubler (52.6k)" },
	{ value: "9", label: "Speedy 1050 (55.9k)" },
	{ value: "8", label: "57600 (59.7k)" },
	{ value: "6", label: "1050 Turbo (68.8k)" },
	{ value: "1", label: "115200 (111.9k)" },
	{ value: "0", label: messages.sidebar.speedMaximum },
];

/**
 * The machine-configuration form (its own panel): model, RAM, optional separate
 * ANTIC RAM, TV standard, and BASIC. Edits are staged and applied with a reboot.
 * Below the staged block: the live-applied Serial I/O group - a temporary
 * tenant until a disks view exists (keyboard settings live on the keys
 * pages' keyboard-settings panel).
 */
export function ConfigView({ host }: { host: EmulatorHost }) {
	const staged = host.staged.value;
	const dirty = host.dirty.value;

	return (
		<div class="flex shrink-0 flex-col gap-2">
			<LabeledSelect
				label={messages.sidebar.model}
				value={staged.model}
				options={MODELS.map((model) => ({
					value: model,
					label: MODEL_LABELS[model],
				}))}
				onSelect={(value) => host.stageModel(value as AtariModel)}
			/>
			<LabeledSelect
				label={messages.sidebar.ram}
				value={String(ramTotal(staged))}
				options={RAM_SIZES[staged.model].map((kb) => ({
					value: String(kb),
					label: `${kb}K`,
				}))}
				onSelect={(value) => host.stageRam(Number(value))}
			/>
			{staged.portbExtendedRam && (
				<label class="flex items-center justify-between gap-3">
					<span class="text-sm text-neutral-600">
						{messages.sidebar.separateAntic}
					</span>
					<input
						type="checkbox"
						checked={staged.portbExtendedRam.antic}
						disabled={anticPolicy(staged.portbExtendedRam.size) !== "optional"}
						onChange={(event) => host.stageAntic(event.currentTarget.checked)}
					/>
				</label>
			)}
			<Segmented
				label={messages.sidebar.tv}
				value={staged.tv}
				options={[
					{
						value: "ntsc",
						label: "NTSC",
						onSelect: () => host.stageTv("ntsc"),
					},
					{ value: "pal", label: "PAL", onSelect: () => host.stageTv("pal") },
				]}
			/>
			<Segmented
				label={messages.sidebar.videoChip}
				value={staged.tvAdapter}
				options={[
					{
						value: "ctia",
						label: "CTIA",
						onSelect: () => host.stageTvAdapter("ctia"),
					},
					{
						value: "gtia",
						label: "GTIA",
						onSelect: () => host.stageTvAdapter("gtia"),
					},
				]}
			/>
			<Segmented
				label={messages.sidebar.basic}
				value={staged.basicDisabled ? "off" : "on"}
				options={[
					{
						value: "on",
						label: messages.sidebar.on,
						onSelect: () => host.stageBasicDisabled(false),
					},
					{
						value: "off",
						label: messages.sidebar.off,
						onSelect: () => host.stageBasicDisabled(true),
					},
				]}
			/>
			{dirty && (
				<button
					type="button"
					class="mt-3 w-full rounded-sm bg-neutral-800 px-2 py-1 text-sm text-white hover:bg-neutral-700"
					onClick={() => host.applyConfig()}
				>
					{messages.sidebar.rebootToApply}
				</button>
			)}
			<GroupHeading label={messages.sidebar.serialIo} />
			<OnOff
				label={messages.sidebar.trapSiov}
				value={host.sioTrap.value}
				onSet={(on) => host.setSioTrap(on)}
			/>
			<OnOff
				label={messages.sidebar.accelerateSio}
				value={host.sioAcceleration.value}
				onSet={(on) => host.setSioAcceleration(on)}
			/>
			<SpeedSelect host={host} />
		</div>
	);
}

// The SIO speed picker: the named presets plus a custom divisor entry.
// A persisted non-preset value opens as custom; picking a preset closes it.
function SpeedSelect({ host }: { host: EmulatorHost }) {
	const speed = host.diskSpeed.value;
	const presetValue = speed === undefined ? "standard" : String(speed);
	const isPreset = SPEED_PRESETS.some((p) => p.value === presetValue);
	const [customOpen, setCustomOpen] = useState(false);
	const custom = customOpen || !isPreset;

	return (
		<>
			<LabeledSelect
				label={messages.sidebar.sioSpeed}
				value={custom ? "custom" : presetValue}
				options={[
					...SPEED_PRESETS,
					{ value: "custom", label: messages.sidebar.speedCustom },
				]}
				onSelect={(value) => {
					if (value === "custom") {
						setCustomOpen(true);
						return;
					}
					setCustomOpen(false);
					host.setDiskSpeed(value === "standard" ? undefined : Number(value));
				}}
			/>
			{custom && (
				<label class="flex items-center justify-between gap-3">
					<span class="text-sm text-neutral-600">
						{messages.sidebar.customDivisor}
					</span>
					<input
						type="number"
						min={0}
						max={40}
						class="w-20 rounded-sm border border-neutral-300 bg-white px-2 py-0.5 text-sm text-neutral-700"
						value={speed ?? 9}
						onChange={(event) => {
							const raw = Math.floor(Number(event.currentTarget.value));
							if (!Number.isFinite(raw)) return;
							host.setDiskSpeed(Math.max(0, Math.min(40, raw)));
						}}
					/>
				</label>
			)}
		</>
	);
}

// The main menu is a set of commands: each row shows a launcher-context label
// (messages.menu, not the palette's "Category: verb") and the command's primary
// shortcut, and clicking dispatches it - so the chords never drift from the
// palette and keys pages. Order is settings first, then the launchers, then
// the palette; the settings entry fans out into its own tabbed view.
const MENU_COMMANDS = [
	{ command: "OPEN_SETTINGS", label: messages.menu.settings },
	{ command: "BOOT_IMAGE", label: messages.menu.boot },
	{ command: "OPEN_LIBRARY", label: messages.menu.library },
	{ command: "OPEN_PALETTE", label: messages.menu.palette },
] as const satisfies readonly { command: Command; label: string }[];

// The four arrows that drive joystick 0 as shipped. The key-mappings help shows
// its "Arrow keys -> Joystick" line only when all four still map that way - a
// rebind makes the shorthand a lie, so we drop the line rather than guess.
const JOYSTICK_ARROWS = [
	["ArrowUp", "PRESS_JOY0_UP"],
	["ArrowDown", "PRESS_JOY0_DOWN"],
	["ArrowLeft", "PRESS_JOY0_LEFT"],
	["ArrowRight", "PRESS_JOY0_RIGHT"],
] as const satisfies readonly (readonly [string, Command])[];

function joystickOnArrows(bindings: Binding[]): boolean {
	return JOYSTICK_ARROWS.every(([on, command]) =>
		bindings.some((b) => b.on === on && b.command === command),
	);
}

// The Atari console keys, in row order. Each line appears only if the command is
// bound; Option/Select/Start collapse into one row of whichever are bound. The
// key caps (Option/Select/Start/Reset/Break) are hardware tokens, kept inline.
const CONSOLE_KEYS = [
	["PRESS_OPTION", "Option"],
	["PRESS_SELECT", "Select"],
	["PRESS_START", "Start"],
] as const satisfies readonly (readonly [Command, string])[];

/**
 * The menu panel: a launcher of the main commands (machine config, boot, library,
 * ROM preferences, the palette, keys) with their shortcuts, the recents list, and
 * a short key-mappings reference. The machine-config form lives on its own panel
 * ({@link ConfigView}).
 */
export function MenuView({
	host,
	onOpenPalette,
}: {
	host: EmulatorHost;
	onOpenPalette: () => void;
}) {
	// Each command's primary chord, shown beside it (irrelevant without a
	// keyboard, so hidden on touch-only). Opening the palette keeps its own
	// handler - it primes the iOS soft keyboard within the tap gesture.
	const chords = primaryChords(
		host.keyBindings.value,
		host.isMac,
		host.layoutLabels.value,
	);

	// Live key-mappings help: each row appears only if its command is bound, so
	// the reference never drifts from the actual bindings. Reset and cold reset
	// (power cycle) get their own lines.
	const km = messages.keyHelp;
	const keyRows: { keys: string; action: string }[] = [];
	if (joystickOnArrows(host.keyBindings.value))
		keyRows.push({ keys: km.arrowKeys, action: km.joystick });
	const trigger = chords.get("PRESS_JOY0_TRIGGER");
	if (trigger) keyRows.push({ keys: trigger, action: km.trigger });
	const consoleBound = CONSOLE_KEYS.filter(([command]) => chords.has(command));
	if (consoleBound.length > 0)
		keyRows.push({
			keys: consoleBound.map(([command]) => chords.get(command)!).join("/"),
			action: consoleBound.map(([, token]) => token).join("/"),
		});
	const reset = chords.get("PRESS_RESET");
	if (reset) keyRows.push({ keys: reset, action: "Reset" });
	const coldReset = chords.get("POWER_CYCLE");
	if (coldReset) keyRows.push({ keys: coldReset, action: km.coldReset });

	return (
		<div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
			<section class="flex flex-col gap-1">
				{/* Docs link, as the first menu entry. Opens in a new tab: this
				    layout owns the live machine, so navigating away in-place
				    would tear the running program down. */}
				<a
					href="/a8/docs"
					target="_blank"
					rel="noreferrer"
					class="flex items-center gap-1.5 text-left text-sm hover:underline"
				>
					{messages.menu.docs}
					<span aria-hidden="true" class="text-neutral-400">
						↗
					</span>
				</a>
				{MENU_COMMANDS.map(({ command, label }) => {
					const chord = chords.get(command);
					return (
						<div key={command} class="flex items-center justify-between gap-3">
							<button
								type="button"
								class="text-left text-sm hover:underline"
								onClick={() =>
									command === "OPEN_PALETTE"
										? onOpenPalette()
										: host.dispatch(command)
								}
							>
								{label}
							</button>
							{chord && (
								<span class="hidden text-xs text-neutral-400 any-pointer-fine:block">
									{chord}
								</span>
							)}
						</div>
					);
				})}
			</section>

			<RecentsSection host={host} />

			{/* The key-mappings help is moot without a physical keyboard. Gate
			    on pointer capability, not width: a phone in landscape is wide
			    enough to trip `sm:`, but `any-pointer: fine` (a mouse/trackpad,
			    which travels with a keyboard) stays false on touch-only. */}
			{keyRows.length > 0 && (
				<section class="hidden any-pointer-fine:block">
					<h2 class="mb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
						{messages.sidebar.keys}
					</h2>
					<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
						{keyRows.map((row) => (
							<KeyRow key={row.action} keys={row.keys} action={row.action} />
						))}
					</dl>
				</section>
			)}

			<section>
				<h2 class="mb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
					{messages.sidebar.about}
				</h2>
				<p class="text-sm text-neutral-600">
					{messages.sidebar.aboutBlurb}{" "}
					<a
						class="text-neutral-800 underline hover:text-black"
						href="https://github.com/cyco130/sfotty-pie"
						target="_blank"
						rel="noreferrer"
					>
						{messages.sidebar.sourceOnGitHub}
					</a>
					.
				</p>
				<p class="mt-1 text-sm text-neutral-600">
					{messages.sidebar.firmwareNotice}{" "}
					<a
						class="text-neutral-800 underline hover:text-black"
						href="/legal/THIRD-PARTY-LICENSES.md"
						target="_blank"
						rel="noreferrer"
					>
						{messages.sidebar.thirdPartyLicenses}
					</a>
					.
				</p>
				<p class="mt-1 font-mono text-xs text-neutral-400">
					{messages.sidebar.build} {import.meta.env.GIT_HASH}
				</p>
			</section>
		</div>
	);
}

// The panel chrome (frame, title, close), the palette chord, Esc-to-close, and
// the iOS keyboard primer now live with the emulator layout; the panel content
// (MenuView / PaletteView) is rendered by the /a8/emu/* panel routes.
