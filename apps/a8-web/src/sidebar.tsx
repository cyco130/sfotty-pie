import type { EmulatorHost } from "./host.ts";
import { Icon } from "./icon.tsx";
import {
	anticPolicy,
	MODELS,
	MODEL_LABELS,
	RAM_SIZES,
	ramTotal,
	type AtariModel,
} from "./machine-config.ts";
import { messages } from "./messages.ts";
import { recentsView } from "./recents.ts";
import { TypePill } from "./type-pill.tsx";

/**
 * The chord that opens the command palette: Cmd+K on macOS, Alt+K elsewhere.
 * Keyed by physical position (`KeyK`) so it's layout-independent, and rejecting
 * AltGraph (which reports as Ctrl+Alt on Windows) so it stays character input.
 * Alt+K is otherwise the emulator's Mod-layer `K`, a no-op stub today.
 */
export function onMac(): boolean {
	return navigator.userAgent.includes("Mac");
}

export function isToggleChord(event: KeyboardEvent): boolean {
	if (event.code !== "KeyK") return false;
	if (event.getModifierState("AltGraph")) return false;
	return onMac()
		? event.metaKey && !event.ctrlKey && !event.altKey
		: event.altKey && !event.ctrlKey && !event.metaKey;
}

/** A labelled segmented control; each option stages its value via `onSelect`. */
function Segmented({
	label,
	value,
	options,
}: {
	label: string;
	value: string;
	options: { value: string; label: string; onSelect: () => void }[];
}) {
	return (
		<div class="flex items-center justify-between gap-3">
			<span class="text-sm text-neutral-600">{label}</span>
			<div class="flex overflow-hidden rounded border border-neutral-300">
				{options.map((option) => (
					<button
						key={option.value}
						type="button"
						class={
							option.value === value
								? "bg-neutral-800 px-2 py-0.5 text-sm text-white"
								: "bg-white px-2 py-0.5 text-sm text-neutral-700 hover:bg-neutral-100"
						}
						onClick={option.onSelect}
					>
						{option.label}
					</button>
				))}
			</div>
		</div>
	);
}

/** A labelled dropdown; selecting a value calls `onSelect`. */
function LabeledSelect({
	label,
	value,
	options,
	onSelect,
}: {
	label: string;
	value: string;
	options: { value: string; label: string }[];
	onSelect: (value: string) => void;
}) {
	return (
		<div class="flex items-center justify-between gap-3">
			<span class="text-sm text-neutral-600">{label}</span>
			<select
				class="rounded border border-neutral-300 bg-white px-2 py-0.5 text-sm text-neutral-700"
				value={value}
				onChange={(event) => onSelect(event.currentTarget.value)}
			>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</div>
	);
}

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
						class="flex items-center gap-2 rounded px-1.5 py-1 transition-colors duration-150 hover:bg-neutral-100"
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

/**
 * The machine-configuration form (its own panel): model, RAM, optional separate
 * ANTIC RAM, TV standard, and BASIC. Edits are staged and applied with a reboot.
 */
export function ConfigView({ host }: { host: EmulatorHost }) {
	const staged = host.staged.value;
	const dirty = host.dirty.value;

	return (
		<div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
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
					class="mt-3 w-full rounded bg-neutral-800 px-2 py-1 text-sm text-white hover:bg-neutral-700"
					onClick={() => host.applyConfig()}
				>
					{messages.sidebar.rebootToApply}
				</button>
			)}
		</div>
	);
}

/**
 * The menu panel: a launcher of navigation links (machine config, boot, library,
 * ROM preferences, the palette), the recents list, and a short key-mappings
 * reference. The machine-config form lives on its own panel ({@link ConfigView}).
 */
export function MenuView({
	host,
	onOpenPalette,
}: {
	host: EmulatorHost;
	onOpenPalette: () => void;
}) {
	return (
		<div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
			<section class="flex flex-col gap-1">
				<button
					type="button"
					class="text-left text-sm hover:underline"
					onClick={() => host.showPanel("config")}
				>
					{messages.sidebar.machineConfig}
				</button>
				<button
					type="button"
					class="text-left text-sm hover:underline"
					onClick={() => host.dispatch("BOOT_IMAGE")}
				>
					{messages.sidebar.bootImage}
				</button>
				<button
					type="button"
					class="text-left text-sm hover:underline"
					onClick={() => host.showPanel("library")}
				>
					{messages.library.title}…
				</button>
				<button
					type="button"
					class="text-left text-sm hover:underline"
					onClick={() => host.showPanel("roms")}
				>
					{messages.roms.title}…
				</button>
				<div class="flex items-center justify-between gap-3">
					<button
						type="button"
						class="text-left text-sm hover:underline"
						onClick={onOpenPalette}
					>
						{messages.sidebar.commandPalette}
					</button>
					<span class="any-pointer-fine:block hidden text-xs text-neutral-400">
						{onMac() ? "⌘K" : "Alt+K"}
					</span>
				</div>
			</section>

			<RecentsSection host={host} />

			{/* The key-mappings help is moot without a physical keyboard. Gate
			    on pointer capability, not width: a phone in landscape is wide
			    enough to trip `sm:`, but `any-pointer: fine` (a mouse/trackpad,
			    which travels with a keyboard) stays false on touch-only. */}
			<section class="hidden any-pointer-fine:block">
				<h2 class="mb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
					{messages.sidebar.keys}
				</h2>
				<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
					<KeyRow
						keys={messages.keyHelp.arrowKeys}
						action={messages.keyHelp.joystick}
					/>
					<KeyRow
						keys={messages.keyHelp.leftShift}
						action={messages.keyHelp.trigger}
					/>
					<KeyRow
						keys={messages.keyHelp.consoleKeys}
						action={messages.keyHelp.consoleActions}
					/>
					<KeyRow
						keys={messages.keyHelp.resetKey}
						action={messages.keyHelp.resetAction}
					/>
					<KeyRow
						keys={messages.keyHelp.breakKey}
						action={messages.keyHelp.breakAction}
					/>
				</dl>
			</section>

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
