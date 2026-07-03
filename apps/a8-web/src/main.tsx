import { hydrate, render } from "preact";
import { Root } from "./root.tsx";
import "./index.css";

// The boot (firmware, audio, host) now lives in the emulator layout, so it runs
// lazily on entry to /a8/emu — content pages render instantly.
//
// Docs routes (/a8/docs/*) are the only ones prerendered to static HTML at
// build time (see prerender.tsx), so they arrive with real markup in #app that
// we hydrate in place. Every other route ships an empty #app and renders fresh.
// The path prefix picks the entry so it matches what the build produced.
function mount(): void {
	const root = document.querySelector<HTMLElement>("#app");
	if (!root) return;
	if (location.pathname.startsWith("/a8/docs")) {
		hydrate(<Root />, root);
	} else {
		render(<Root />, root);
	}
}

mount();
