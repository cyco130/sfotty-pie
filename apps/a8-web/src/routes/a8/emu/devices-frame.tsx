import type { ComponentChildren } from "preact";
import { Icon, type IconName } from "../../../icon.tsx";
import { messages } from "../../../messages.ts";
import { navigate } from "../../../navigate.ts";
import { PanelFrame } from "./panel-frame.tsx";

// The devices tabs, in socket order (storage first, then input). More appear
// as their subsystems land (C:, H:, P:, Joystick, PBI, Internal) - absent,
// not grayed. Tab labels are the CIO device letters where real (hardware
// tokens) and short plain words where not; aria-labels carry the full names.
export type DevicesTab = "disks" | "cart" | "keyboard";

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
		id: "cart",
		path: "/a8/emu/devices/cart",
		label: "Cart",
		name: messages.devices.cartridge,
	},
	{
		id: "keyboard",
		path: "/a8/emu/devices/keyboard",
		label: "K:",
		name: messages.devices.keyboard,
	},
];

/** An icon action in a device row. `hidden` renders it invisible but
 *  space-holding, so icon columns stay aligned across rows; `disabled`
 *  grays it out (e.g. save with nothing modified). */
export function IconAction({
	name,
	title,
	tone = "text-neutral-400 hover:text-neutral-700",
	hidden = false,
	disabled = false,
	onClick,
}: {
	name: IconName;
	title: string;
	tone?: string;
	hidden?: boolean;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			class={`shrink-0 ${disabled ? "text-neutral-200" : tone} ${
				hidden ? "invisible" : ""
			}`}
			title={title}
			aria-label={title}
			disabled={disabled}
			onClick={onClick}
		>
			<Icon name={name} class="size-4" />
		</button>
	);
}

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
