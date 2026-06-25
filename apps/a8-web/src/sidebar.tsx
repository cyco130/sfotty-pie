import type { EmulatorHost } from "./host.ts";
import { builtinLibrary } from "./library.ts";
import { messages } from "./messages.ts";

// The bootable software in the library (the firmware/ items are auto-selected
// by the host, not listed here).
const software = builtinLibrary.filter((entry) => entry.category === "other");

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
 * The menu panel: machine configuration (staged, applied with a reboot), the
 * boot-image action, the software library, and a short key-mappings reference.
 */
export function MenuView({
	host,
	onOpenPalette,
}: {
	host: EmulatorHost;
	onOpenPalette: () => void;
}) {
	const staged = host.staged.value;
	const dirty = host.dirty.value;

	return (
		<div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
			<section>
				<h2 class="mb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
					{messages.sidebar.machine}
				</h2>
				<div class="flex flex-col gap-2">
					<Segmented
						label={messages.sidebar.type}
						value={staged.model}
						options={[
							{
								value: "800",
								label: "800",
								onSelect: () => host.stageModel("800"),
							},
							{
								value: "800XL",
								label: "XL",
								onSelect: () => host.stageModel("800XL"),
							},
							{
								value: "130XE",
								label: "130XE",
								onSelect: () => host.stageModel("130XE"),
							},
						]}
					/>
					<Segmented
						label={messages.sidebar.tv}
						value={staged.tv}
						options={[
							{
								value: "ntsc",
								label: "NTSC",
								onSelect: () => host.stageTv("ntsc"),
							},
							{
								value: "pal",
								label: "PAL",
								onSelect: () => host.stageTv("pal"),
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
				</div>
				{dirty && (
					<button
						type="button"
						class="mt-3 w-full rounded bg-neutral-800 px-2 py-1 text-sm text-white hover:bg-neutral-700"
						onClick={() => host.applyConfig()}
					>
						{messages.sidebar.rebootToApply}
					</button>
				)}
			</section>

			<section class="flex flex-col gap-1">
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
				<button
					type="button"
					class="text-left text-sm hover:underline"
					onClick={() => host.dispatch("BOOT_IMAGE")}
				>
					{messages.sidebar.bootImage}
				</button>
			</section>

			{software.length > 0 && (
				<section>
					<h2 class="mb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
						{messages.sidebar.software}
					</h2>
					<ul class="flex flex-col gap-1">
						{software.map((entry) => (
							<li key={entry.id}>
								<button
									type="button"
									class="text-left text-sm hover:underline"
									onClick={() => void host.bootLibraryEntry(entry)}
								>
									{entry.displayName}
								</button>
							</li>
						))}
					</ul>
				</section>
			)}

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
