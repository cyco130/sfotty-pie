import { messages } from "../../../messages.ts";
import { MenuView } from "../../../sidebar.tsx";
import { useEmu } from "./emu-context.ts";
import { PanelFrame } from "./panel-frame.tsx";

// /a8/emu/menu — machine config, boot image, software, key help.
export default function MenuPage() {
	const { host, openPalette } = useEmu();
	return (
		<PanelFrame title={messages.sidebar.titleMenu}>
			<MenuView host={host} onOpenPalette={openPalette} />
		</PanelFrame>
	);
}
