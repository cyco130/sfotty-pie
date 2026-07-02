// Platform detection, centralized so a test override can flip it. Everything
// else reads `host.isMac`; this is the one spot that looks at the environment.
//
// Real detection is the userAgent. For testing the *other* platform's shortcut
// labels and default bindings without another machine, a `?os=win|mac` query
// param overrides it and persists for the tab (sessionStorage), so it survives
// SPA navigation and reloads but clears itself when the tab closes; `?os=auto`
// clears it sooner. After flipping, reset key bindings so the set (and its
// primaries) regenerates for that platform.

const OVERRIDE_KEY = "force-os";

function readOverride(): "mac" | "win" | null {
	try {
		const param = new URLSearchParams(location.search).get("os");
		if (param === "auto") sessionStorage.removeItem(OVERRIDE_KEY);
		else if (param === "mac" || param === "win")
			sessionStorage.setItem(OVERRIDE_KEY, param);
		const stored = sessionStorage.getItem(OVERRIDE_KEY);
		return stored === "mac" || stored === "win" ? stored : null;
	} catch {
		return null; // no storage / non-browser context → fall back to detection
	}
}

/**
 * True on macOS — for platform-specific shortcut labels (⌘ vs Ctrl+) and the
 * platform default bindings. A `?os=win` / `?os=mac` query param overrides the
 * real userAgent (per-tab; `?os=auto` or closing the tab clears it) so the other
 * platform's labels can be seen while developing.
 */
export function isMac(): boolean {
	const override = readOverride();
	if (override) return override === "mac";
	return navigator.userAgent.includes("Mac");
}
