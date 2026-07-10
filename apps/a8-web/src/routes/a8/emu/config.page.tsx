import { ConfigView } from "../../../sidebar.tsx";
import { useEmu } from "./emu-context.ts";
import { SettingsFrame } from "./settings-frame.tsx";

// /a8/emu/config - the settings view's Hardware tab: machine configuration
// (model, RAM, TV, BASIC), staged and applied with a reboot. Reached from the
// menu's Settings entry or the top bar's config label.
export default function ConfigPage() {
	const { host } = useEmu();
	return (
		<SettingsFrame host={host} active="hardware">
			<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
				<ConfigView host={host} />
			</div>
		</SettingsFrame>
	);
}
