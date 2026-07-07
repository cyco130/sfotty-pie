import { DisplayView } from "../../../display-view.tsx";
import { useEmu } from "./emu-context.ts";
import { SettingsFrame } from "./settings-frame.tsx";

// /a8/emu/display — the settings view's Display tab: per-TV-standard overscan
// crop, frame blending, and palette generation parameters, live-applied.
export default function DisplayPage() {
	const { host } = useEmu();
	return (
		<SettingsFrame host={host} active="display">
			<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
				<DisplayView host={host} />
			</div>
		</SettingsFrame>
	);
}
