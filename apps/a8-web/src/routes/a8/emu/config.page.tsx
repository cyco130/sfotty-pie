import { messages } from "../../../messages.ts";
import { ConfigView } from "../../../sidebar.tsx";
import { useEmu } from "./emu-context.ts";
import { PanelFrame } from "./panel-frame.tsx";

// /a8/emu/config — machine configuration (model, RAM, TV, BASIC), staged and
// applied with a reboot. Reached from the menu or the top bar's config label.
export default function ConfigPage() {
	const { host } = useEmu();
	return (
		<PanelFrame title={messages.sidebar.titleConfig}>
			<ConfigView host={host} />
		</PanelFrame>
	);
}
