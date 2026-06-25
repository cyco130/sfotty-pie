import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { EmulatorHost } from "../../../host.ts";

export interface EmuContextValue {
	host: EmulatorHost;
	/** Open the command palette, raising the iOS soft keyboard in-gesture. */
	openPalette: () => void;
}

// Provided by the emulator layout; consumed by the panel routes (and their
// content) so they don't prop-drill the host through preact-iso's router.
export const EmuContext = createContext<EmuContextValue | null>(null);

export function useEmu(): EmuContextValue {
	const value = useContext(EmuContext);
	if (!value) {
		throw new Error("useEmu must be used within the emulator layout");
	}
	return value;
}
