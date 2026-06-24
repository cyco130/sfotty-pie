import { render } from "preact";
import { Root } from "./root.tsx";
import "./index.css";

// The boot (firmware, audio, host) now lives in the emulator layout, so it runs
// lazily on entry to /a8/emu — content pages render instantly.
function mount(): void {
	const root = document.querySelector<HTMLElement>("#app");
	if (root) render(<Root />, root);
}

mount();
