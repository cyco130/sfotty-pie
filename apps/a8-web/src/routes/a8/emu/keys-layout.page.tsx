import { LAYOUT_OPTIONS } from "../../../keyboard-layouts.ts";
import { LAYOUT_AUTO } from "../../../key-bindings-store.ts";
import { layoutLabelsAvailable } from "../../../key-bindings.ts";
import { messages } from "../../../messages.ts";
import { navigate } from "../../../navigate.ts";
import { useEmu } from "./emu-context.ts";
import { PanelFrame } from "./panel-frame.tsx";

const KEYS = "/a8/emu/keys";

// The manual keyboard-layout picker (route /a8/emu/keys/layout). A pick overrides
// getLayoutMap and regenerates the default bindings from that layout - the
// fallback for browsers that don't expose the layout, and an override elsewhere.
export default function KeyboardLayoutPanel() {
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
		<PanelFrame title={messages.shortcuts.layoutTitle}>
			<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
				<button
					type="button"
					class="self-start text-xs text-neutral-500 hover:underline"
					onClick={() => navigate(KEYS, { replace: true })}
				>
					‹ {messages.shortcuts.back}
				</button>

				<p class="text-sm text-neutral-600">{messages.shortcuts.layoutIntro}</p>

				<select
					class="w-full rounded-sm border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-800"
					value={current}
					onChange={(e) => void host.setLayoutPreference(e.currentTarget.value)}
				>
					<option value={LAYOUT_AUTO} disabled={!autoAvailable}>
						{messages.shortcuts.layoutAuto}
						{!autoAvailable && ` - ${messages.shortcuts.layoutAutoUnavailable}`}
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
		</PanelFrame>
	);
}
