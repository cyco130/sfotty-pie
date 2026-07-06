import type { ComponentChildren } from "preact";
import type { EmulatorHost, SidebarPanel } from "../../../host.ts";
import { messages } from "../../../messages.ts";
import { PanelFrame } from "./panel-frame.tsx";

// The settings tabs, in display order, each mapped to its own panel route —
// the routes (and their palette commands) survive the consolidation; the
// tabs just navigate between them.
export type SettingsTab =
	| "hardware"
	| "roms"
	| "display"
	| "shortcuts"
	| "controllers";

const TABS: readonly {
	id: SettingsTab;
	panel: SidebarPanel;
	label: string;
}[] = [
	{ id: "hardware", panel: "config", label: messages.settings.hardware },
	{ id: "roms", panel: "roms", label: messages.settings.roms },
	{ id: "display", panel: "display", label: messages.settings.display },
	{ id: "shortcuts", panel: "keys", label: messages.settings.shortcuts },
	{
		id: "controllers",
		panel: "controllers",
		label: messages.settings.controllers,
	},
];

/**
 * The shell shared by the settings panels: the PanelFrame titled "Settings"
 * with an underline-style tab strip (deliberately distinct from the in-page
 * button groups like the display panel's NTSC/PAL switch). Navigation goes
 * through showPanel so route side effects (config staging) keep working.
 */
export function SettingsFrame({
	host,
	active,
	children,
}: {
	host: EmulatorHost;
	active: SettingsTab;
	children: ComponentChildren;
}) {
	return (
		<PanelFrame title={messages.sidebar.titleSettings}>
			<div class="mb-3 flex shrink-0 gap-0.5 border-b border-neutral-200">
				{TABS.map((tab) => (
					<button
						key={tab.id}
						type="button"
						aria-pressed={active === tab.id}
						class={`-mb-px border-b-2 px-1.5 py-1 text-sm ${
							active === tab.id
								? "border-neutral-700 font-medium text-neutral-900"
								: "border-transparent text-neutral-500 hover:text-neutral-800"
						}`}
						onClick={() => host.showPanel(tab.panel)}
					>
						{tab.label}
					</button>
				))}
			</div>
			{children}
		</PanelFrame>
	);
}
