import { KEYBOARD_LAYOUTS } from "../../../keyboard-layouts.ts";
import { LAYOUT_AUTO } from "../../../key-bindings-store.ts";
import { layoutLabelsAvailable } from "../../../key-bindings.ts";
import { messages } from "../../../messages.ts";
import { navigate } from "../../../navigate.ts";
import { useEmu } from "./emu-context.ts";
import { PanelFrame } from "./panel-frame.tsx";

const KEYS = "/a8/emu/keys";

// The manual keyboard-layout picker (route /a8/emu/keys/layout). A pick overrides
// getLayoutMap and regenerates the default bindings from that layout — the
// fallback for browsers that don't expose the layout, and an override elsewhere.
export default function KeyboardLayoutPanel() {
	const { host } = useEmu();
	const current = host.layoutPref.value;
	// Nothing to auto-detect from where getLayoutMap is absent — gray it out.
	const autoAvailable = layoutLabelsAvailable();

	const options = [
		{ id: LAYOUT_AUTO, name: messages.shortcuts.layoutAuto },
		...KEYBOARD_LAYOUTS.map((l) => ({ id: l.id, name: l.name })),
	];

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

				<div class="flex flex-col gap-1">
					{options.map((option) => {
						const selected = option.id === current;
						const disabled = option.id === LAYOUT_AUTO && !autoAvailable;
						return (
							<button
								key={option.id}
								type="button"
								disabled={disabled}
								class={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
									disabled
										? "cursor-not-allowed text-neutral-400"
										: selected
											? "bg-neutral-200 text-neutral-900"
											: "text-neutral-700 hover:bg-neutral-100"
								}`}
								onClick={() => void host.setLayoutPreference(option.id)}
							>
								<span
									class={`inline-block h-3 w-3 shrink-0 rounded-full border ${
										disabled
											? "border-neutral-300"
											: selected
												? "border-neutral-800 bg-neutral-800"
												: "border-neutral-400"
									}`}
								/>
								{option.name}
								{disabled && (
									<span class="text-xs text-neutral-400">
										— {messages.shortcuts.layoutAutoUnavailable}
									</span>
								)}
							</button>
						);
					})}
				</div>

				<p class="text-xs text-neutral-500">
					{messages.shortcuts.layoutRegenerates}
				</p>
			</div>
		</PanelFrame>
	);
}
