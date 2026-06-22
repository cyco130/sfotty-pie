import { useEffect } from "preact/hooks";
import type { EmulatorHost } from "./host.ts";
import { builtinLibrary } from "./library.ts";

// The bootable software in the library (the firmware/ items are auto-selected
// by the host, not listed here).
const software = builtinLibrary.filter((entry) => entry.category === "other");

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
 * The left menu: a light panel that pushes the screen aside (not a modal),
 * holding the machine configuration (staged, applied with a reboot), the
 * boot-image action, and a short key-mappings reference. Closed by the ✕ or
 * Esc.
 */
export function Sidebar({ host }: { host: EmulatorHost }) {
	const open = host.menuOpen.value;

	// Esc closes the menu. Capture-phase + stopPropagation so the keystroke
	// doesn't also reach the emulator's offscreen input.
	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			host.closeMenu();
		};
		document.addEventListener("keydown", onKey, true);
		return () => document.removeEventListener("keydown", onKey, true);
	}, [open, host]);

	if (!open) return null;

	const staged = host.staged.value;
	const dirty = host.dirty.value;

	return (
		<aside class="flex max-h-[60vh] w-full shrink-0 flex-col gap-6 overflow-y-auto bg-white p-4 text-neutral-800 sm:h-full sm:max-h-none sm:w-72">
			<div class="flex items-center justify-between">
				<span class="text-lg font-semibold">Sfotty Pie A8 Web</span>
				<button
					type="button"
					class="px-1 text-neutral-500 hover:text-neutral-900"
					aria-label="Close menu"
					onClick={() => host.closeMenu()}
				>
					✕
				</button>
			</div>

			<section>
				<h2 class="mb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
					Machine
				</h2>
				<div class="flex flex-col gap-2">
					<Segmented
						label="Type"
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
						label="TV"
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
						label="BASIC"
						value={staged.basicDisabled ? "off" : "on"}
						options={[
							{
								value: "on",
								label: "On",
								onSelect: () => host.stageBasicDisabled(false),
							},
							{
								value: "off",
								label: "Off",
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
						Reboot to apply
					</button>
				)}
			</section>

			<section>
				<button
					type="button"
					class="text-left text-sm hover:underline"
					onClick={() => host.dispatch("BOOT_IMAGE")}
				>
					Boot image…
				</button>
			</section>

			{software.length > 0 && (
				<section>
					<h2 class="mb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
						Software
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
					Keys
				</h2>
				<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
					<KeyRow keys="Arrow keys" action="Joystick" />
					<KeyRow keys="Left Shift" action="Trigger" />
					<KeyRow keys="F2 / F3 / F4" action="Option / Select / Start" />
					<KeyRow keys="F5" action="Reset (Ctrl: cold reset)" />
					<KeyRow keys="F9" action="Break" />
				</dl>
			</section>

			<section>
				<h2 class="mb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
					About
				</h2>
				<p class="text-sm text-neutral-600">
					Sfotty Pie A8 Web — an Atari 8-bit emulator. MIT-licensed.{" "}
					<a
						class="text-neutral-800 underline hover:text-black"
						href="https://github.com/cyco130/sfotty-pie"
						target="_blank"
						rel="noreferrer"
					>
						Source on GitHub
					</a>
					.
				</p>
				<p class="mt-1 text-sm text-neutral-600">
					Bundled firmware (AltirraOS, Altirra BASIC, Atari++) is used under its
					own license.{" "}
					<a
						class="text-neutral-800 underline hover:text-black"
						href="/legal/THIRD-PARTY-LICENSES.md"
						target="_blank"
						rel="noreferrer"
					>
						Third-party licenses
					</a>
					.
				</p>
			</section>
		</aside>
	);
}
