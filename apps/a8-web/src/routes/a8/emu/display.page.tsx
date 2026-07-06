import { DisplayView } from "../../../display-view.tsx";
import { messages } from "../../../messages.ts";
import { useEmu } from "./emu-context.ts";
import { PanelFrame } from "./panel-frame.tsx";

// /a8/emu/display — per-TV-standard display settings: overscan crop and
// palette generation parameters, live-applied. Reached from the menu.
export default function DisplayPage() {
	const { host } = useEmu();
	return (
		<PanelFrame title={messages.sidebar.titleDisplay}>
			<DisplayView host={host} />
		</PanelFrame>
	);
}
