import { LocationProvider, Route, Router } from "preact-iso";
import { App } from "./app.tsx";
import { useHead } from "./head.ts";
import type { EmulatorHost } from "./host.ts";
import { messages } from "./messages.ts";
import HomePage from "./routes/(home).page.tsx";
import NotFoundPage from "./routes/[...notfound].page.tsx";

/**
 * Temporary emulator route: step 1 mounts today's <App> unchanged at
 * /a8/emu/*. Step 2 replaces this with a8-emu.layout.tsx that owns host
 * creation and hosts the panel sub-routes (/a8/emu/menu, …).
 *
 * Note: <App>'s unmount tears down screen/keyboard/audio but leaves the core
 * running, so leaving and re-entering /a8/emu re-attaches to a live machine.
 * The proper lifecycle lands with the layout in step 2.
 */
function EmuRoute({ host }: { host: EmulatorHost }) {
	useHead({ title: messages.pages.emu.title });
	return <App host={host} />;
}

/**
 * The SPA shell: one <Router> for the whole app. The emulator lives under
 * /a8/emu/*; everything else is content. Unmatched URLs render the not-found
 * page (status 200 in pure-SPA mode — see notes.local/routing.md).
 */
export function Root({ host }: { host: EmulatorHost }) {
	return (
		<LocationProvider>
			<Router>
				<Route path="/" component={HomePage} />
				{/* Exact for now; becomes /a8/emu/* with a nested panel router in
				    step 3. preact-iso's trailing /* needs >=1 segment, so it would
				    not match the bare /a8/emu. */}
				<Route path="/a8/emu" component={() => <EmuRoute host={host} />} />
				<Route default component={NotFoundPage} />
			</Router>
		</LocationProvider>
	);
}
