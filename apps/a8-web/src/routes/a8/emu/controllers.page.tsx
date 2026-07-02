import { ControllersView } from "../../../controllers.tsx";
import { messages } from "../../../messages.ts";
import { useEmu } from "./emu-context.ts";
import { PanelFrame } from "./panel-frame.tsx";

// /a8/emu/controllers — a live monitor of connected gamepads with per-pad port
// assignment. Reached from the menu. Binding and calibration build on it.
export default function ControllersPage() {
	const { host } = useEmu();
	return (
		<PanelFrame title={messages.sidebar.titleControllers}>
			<ControllersView host={host} />
		</PanelFrame>
	);
}
