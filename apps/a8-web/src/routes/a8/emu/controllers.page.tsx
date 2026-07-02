import { ControllersView } from "../../../controllers.tsx";
import { messages } from "../../../messages.ts";
import { PanelFrame } from "./panel-frame.tsx";

// /a8/emu/controllers — a live monitor of connected gamepads. Reached from the
// menu. Read-only for now (diagnosis); binding and calibration build on it.
export default function ControllersPage() {
	return (
		<PanelFrame title={messages.sidebar.titleControllers}>
			<ControllersView />
		</PanelFrame>
	);
}
