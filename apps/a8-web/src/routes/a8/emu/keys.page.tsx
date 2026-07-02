import { KeysView } from "../../../keys.tsx";
import { messages } from "../../../messages.ts";
import { useEmu } from "./emu-context.ts";
import { PanelFrame } from "./panel-frame.tsx";

// /a8/emu/keys — keyboard shortcuts: the raw binding set, searchable. Reached
// from the menu.
export default function KeysPage() {
	const { host } = useEmu();
	return (
		<PanelFrame title={messages.sidebar.titleKeys}>
			<KeysView host={host} />
		</PanelFrame>
	);
}
