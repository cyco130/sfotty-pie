import { KeysView } from "../../../keys.tsx";
import { useEmu } from "./emu-context.ts";
import { SettingsFrame } from "./settings-frame.tsx";

// /a8/emu/keys - the settings view's Shortcuts tab: the raw binding set,
// searchable. Its drill-down pages (layout, per-command) keep their own
// frames.
export default function KeysPage() {
	const { host } = useEmu();
	return (
		<SettingsFrame host={host} active="shortcuts">
			<KeysView host={host} />
		</SettingsFrame>
	);
}
