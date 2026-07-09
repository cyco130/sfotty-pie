import { hydrate, render } from "preact";
import { Root } from "./root.tsx";
import "./index.css";

// The boot (firmware, audio, host) now lives in the emulator layout, so it runs
// lazily on entry to /a8/emu - content pages render instantly.
//
// The landing page (`/`) and the docs routes (/a8/docs/*) are prerendered to
// static HTML at build time (see prerender.tsx), so they arrive with real markup
// in #app that we hydrate in place. Every other route ships an empty #app and
// renders fresh. The path picks the entry so it matches what the build produced.
function mount(): void {
	const root = document.querySelector<HTMLElement>("#app");
	if (!root) return;
	// Hydrate only when this exact route was prerendered AND the shell actually
	// arrived with its markup. The route check alone would try to hydrate an
	// empty #app in dev (no prerender runs) - and hydrating the eager home page
	// against nothing throws; the content check alone would wrongly hydrate the
	// home markup that index.html carries as the SPA fallback for other routes.
	const path = location.pathname;
	const prerendered = path === "/" || path.startsWith("/a8/docs");
	if (prerendered && root.firstChild) {
		hydrate(<Root />, root);
	} else {
		render(<Root />, root);
	}
}

mount();
