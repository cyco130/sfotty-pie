import { messages } from "../../../messages.ts";
import { PaletteView } from "../../../palette.tsx";
import { useEmu } from "./emu-context.ts";
import { PanelFrame } from "./panel-frame.tsx";

// /a8/emu/palette — the command palette.
export default function PalettePage() {
	const { host } = useEmu();
	return (
		<PanelFrame title={messages.sidebar.titlePalette}>
			<PaletteView host={host} />
		</PanelFrame>
	);
}
