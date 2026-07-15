import type { ComponentChildren } from "preact";
import { messages } from "../../../messages.ts";
import { navigate } from "../../../navigate.ts";
import { PanelFrame } from "./panel-frame.tsx";

// The devices tabs, in socket order (storage first, then input). More appear
// as their subsystems land (Cart, C:, H:, P:, Joystick, PBI, Internal) -
// absent, not grayed. Tab labels are the CIO device letters (hardware
// tokens); the heading under the strip spells the active one out, and
// aria-labels carry the full names.
export type DevicesTab = "disks" | "keyboard";

const TABS: readonly {
	id: DevicesTab;
	path: string;
	label: string;
	name: string;
}[] = [
	{
		id: "disks",
		path: "/a8/emu/devices",
		label: "D:",
		name: messages.devices.diskDrives,
	},
	{
		id: "keyboard",
		path: "/a8/emu/devices/keyboard",
		label: "K:",
		name: messages.devices.keyboard,
	},
];

/**
 * The shell shared by the devices panels: the PanelFrame titled "Devices"
 * with the settings view's underline-style tab strip (the tabs' aria-labels
 * and tooltips spell the letters out). A standalone view, not a settings
 * tab: mounting media is a during-play action, not configuration.
 */
export function DevicesFrame({
	active,
	children,
}: {
	active: DevicesTab;
	children: ComponentChildren;
}) {
	return (
		<PanelFrame title={messages.devices.title}>
			<div class="mb-3 flex shrink-0 gap-0.5 border-b border-neutral-200">
				{TABS.map((tab) => (
					<button
						key={tab.id}
						type="button"
						aria-pressed={active === tab.id}
						aria-label={tab.name}
						title={tab.name}
						class={`-mb-px border-b-2 px-1.5 py-1 text-sm ${
							active === tab.id
								? "border-neutral-700 font-medium text-neutral-900"
								: "border-transparent text-neutral-500 hover:text-neutral-800"
						}`}
						onClick={() => navigate(tab.path, { replace: true })}
					>
						{tab.label}
					</button>
				))}
			</div>
			{children}
		</PanelFrame>
	);
}
