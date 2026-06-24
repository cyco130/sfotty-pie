import { lazy, LocationProvider, Route, Router } from "preact-iso";
import HomePage from "./routes/(home).page.tsx";
import NotFoundPage from "./routes/[...notfound].page.tsx";

// The emulator core is code-split: it only loads on entry to /a8/emu, keeping
// it out of the initial (welcome) bundle.
const A8EmuLayout = lazy(() => import("./routes/a8/emu/a8-emu.layout.tsx"));

/**
 * The SPA shell: one <Router> for the whole app. The emulator lives under
 * /a8/emu (panel sub-routes arrive in step 3); everything else is content.
 * Unmatched URLs render the not-found page (status 200 in pure-SPA mode — see
 * notes.local/routing.md).
 */
export function Root() {
	return (
		<LocationProvider>
			<Router>
				<Route path="/" component={HomePage} />
				<Route path="/a8/emu" component={A8EmuLayout} />
				<Route default component={NotFoundPage} />
			</Router>
		</LocationProvider>
	);
}
