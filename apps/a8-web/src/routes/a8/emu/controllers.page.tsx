import { ControllersView } from "../../../controllers.tsx";
import { useEmu } from "./emu-context.ts";
import { SettingsFrame } from "./settings-frame.tsx";

// /a8/emu/controllers - the settings view's Controllers tab: a live monitor
// of connected gamepads with port assignment, remapping, and bindings.
export default function ControllersPage() {
	const { host } = useEmu();
	return (
		<SettingsFrame host={host} active="controllers">
			<ControllersView host={host} />
		</SettingsFrame>
	);
}
