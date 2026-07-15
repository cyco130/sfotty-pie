import { LAYOUT_AUTO } from "../../../key-bindings-store.ts";
import { layoutLabelsAvailable } from "../../../key-bindings.ts";
import { LAYOUT_OPTIONS } from "../../../keyboard-layouts.ts";
import { messages } from "../../../messages.ts";
import { OnOff, Segmented } from "../../../settings-controls.tsx";
import { DevicesFrame } from "./devices-frame.tsx";
import { useEmu } from "./emu-context.ts";

// /a8/emu/devices/keyboard - the devices view's K: tab, the one keyboard
// page (the Shortcuts panel's "Keyboard settings" link lands here too):
// the layout picker on top, then typing mode, paste delivery, and the
// hardware-side switches (attach, realistic scan). A layout pick overrides
// getLayoutMap and regenerates the default bindings from that layout - the
// fallback for browsers that don't expose the layout, and an override
// elsewhere.
export default function DevicesKeyboardPage() {
	const { host } = useEmu();
	const current = host.layoutPref.value;
	// Nothing to auto-detect from where getLayoutMap is absent - gray it out.
	const autoAvailable = layoutLabelsAvailable();

	// Flat, alphabetical by display name. Several options can share a map id, so
	// picking one stores that id; on reload the first option with it (its
	// canonical name) shows as selected.
	const options = [...LAYOUT_OPTIONS].sort((a, b) =>
		a.name.localeCompare(b.name),
	);

	return (
		<DevicesFrame active="keyboard">
			{/* Blocks are spaced wider (gap-3) than a control and its help text
			    (gap-1), so each hint reads as belonging to the control above it. */}
			<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
				<div class="flex flex-col gap-2">
					<p class="text-sm text-neutral-600">
						{messages.shortcuts.layoutIntro}
					</p>
					<select
						class="w-full rounded-sm border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-800"
						value={current}
						onChange={(e) =>
							void host.setLayoutPreference(e.currentTarget.value)
						}
					>
						<option value={LAYOUT_AUTO} disabled={!autoAvailable}>
							{messages.shortcuts.layoutAuto}
							{!autoAvailable &&
								` - ${messages.shortcuts.layoutAutoUnavailable}`}
						</option>
						{options.map((option) => (
							<option key={option.name} value={option.id}>
								{option.name}
							</option>
						))}
					</select>
					<p class="text-xs text-neutral-500">
						{messages.shortcuts.layoutRegenerates}
					</p>
				</div>
				<div class="flex flex-col gap-1">
					<Segmented
						label={messages.shortcuts.mode}
						value={host.keyboardMode.value}
						options={[
							{
								value: "character",
								label: messages.shortcuts.modeCharacter,
								onSelect: () => host.setKeyboardMode("character"),
							},
							{
								value: "positional",
								label: messages.shortcuts.modePositional,
								onSelect: () => host.setKeyboardMode("positional"),
							},
						]}
					/>
					<p class="text-xs text-neutral-500">{messages.shortcuts.modeHint}</p>
				</div>
				<div class="flex flex-col gap-1">
					<Segmented
						label={messages.shortcuts.pasteMode}
						value={host.pasteChMode.value ? "ch" : "k"}
						options={[
							{
								value: "k",
								label: messages.shortcuts.pasteModeK,
								onSelect: () => host.setPasteChMode(false),
							},
							{
								value: "ch",
								label: messages.shortcuts.pasteModeCh,
								onSelect: () => host.setPasteChMode(true),
							},
						]}
					/>
					<p class="text-xs text-neutral-500">
						{messages.shortcuts.pasteModeHint}
					</p>
				</div>
				{/* The plug: one toggle button. Detached it goes loud (amber, like
				    the warnings) and reads as the state; clicking replugs. */}
				<div class="flex flex-col gap-1">
					{host.keyboardAttached.value ? (
						<button
							type="button"
							class="w-full rounded-sm bg-neutral-800 px-2 py-1 text-sm text-white hover:bg-neutral-700"
							onClick={() => host.setKeyboardAttached(false)}
						>
							{messages.shortcuts.detachKeyboard}
						</button>
					) : (
						<button
							type="button"
							class="w-full rounded-sm bg-amber-600 px-2 py-1 text-sm font-medium text-white hover:bg-amber-700"
							onClick={() => host.setKeyboardAttached(true)}
						>
							{messages.shortcuts.keyboardIsDetached}
						</button>
					)}
					<p class="text-xs text-neutral-500">
						{messages.shortcuts.keyboardPlugHint}
					</p>
				</div>
				<OnOff
					label={messages.shortcuts.realisticScan}
					value={host.realisticScan.value}
					onSet={(on) => host.setRealisticScan(on)}
				/>
			</div>
		</DevicesFrame>
	);
}
