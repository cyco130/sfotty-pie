import { lazy, LocationProvider, Route, Router, useLocation } from "preact-iso";
import { setRouter } from "./navigate.ts";
import HomePage from "./routes/(home).page.tsx";
import NotFoundPage from "./routes/[...notfound].page.tsx";

// Code-split per route so the initial (welcome) bundle stays light: the emulator
// core lives in the layout chunk, each panel in its own small chunk.
const A8EmuLayout = lazy(() => import("./routes/a8/emu/a8-emu.layout.tsx"));
const EmuIndex = lazy(() => import("./routes/a8/emu/(a8-emu).page.tsx"));
const MenuPanel = lazy(() => import("./routes/a8/emu/menu.page.tsx"));
const PalettePanel = lazy(() => import("./routes/a8/emu/palette.page.tsx"));
const AtariIndex = lazy(() => import("./routes/a8/(a8).page.tsx"));
const ReferenceIndex = lazy(
	() => import("./routes/a8/reference/(reference).page.tsx"),
);
const AtasciiKeyboard = lazy(
	() => import("./routes/a8/reference/atascii-and-keyboard.page.tsx"),
);

// Capture preact-iso's `route` into the module-level navigate() so non-component
// code (the host) can navigate. Lives inside LocationProvider.
function NavigationBridge() {
	const { route } = useLocation();
	setRouter(route);
	return null;
}

// /a8/emu/* — the emulator layout wrapping a nested router of panel routes. As a
// nesting `/*` parent it also matches the bare /a8/emu (empty remainder → the
// nested "/" route). The layout renders the matched panel into its sidebar slot.
function EmuSection() {
	return (
		<A8EmuLayout>
			<Router>
				<Route path="/" component={EmuIndex} />
				<Route path="/menu" component={MenuPanel} />
				<Route path="/palette" component={PalettePanel} />
				<Route default component={EmuIndex} />
			</Router>
		</A8EmuLayout>
	);
}

/**
 * The SPA shell: one <Router> for the whole app. Unmatched URLs render the
 * not-found page (status 200 in pure-SPA mode — see notes.local/routing.md).
 */
export function Root() {
	return (
		<LocationProvider>
			<NavigationBridge />
			<Router>
				<Route path="/" component={HomePage} />
				<Route path="/a8" component={AtariIndex} />
				{/* Two routes, one component: preact-iso's `/*` splat needs >=1
				    segment so it won't match the bare /a8/emu. The exact route
				    covers the index (nested rest="" → the "/" panel route); the
				    splat covers /a8/emu/menu etc. Same `component`, so the Router
				    doesn't remount EmuSection (the machine) when switching. */}
				<Route path="/a8/emu" component={EmuSection} />
				<Route path="/a8/emu/*" component={EmuSection} />
				<Route path="/a8/reference" component={ReferenceIndex} />
				<Route
					path="/a8/reference/atascii-and-keyboard"
					component={AtasciiKeyboard}
				/>
				<Route default component={NotFoundPage} />
			</Router>
		</LocationProvider>
	);
}
