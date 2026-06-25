// A Rakkas-shaped programmatic navigation seam over preact-iso. preact-iso only
// exposes `route` through the useLocation() hook (component scope), so a small
// bridge in the router shell captures it here — letting non-component code (the
// host) navigate too. Panel transitions pass { replace: true }: URLs are for
// deep-linking, not browser history (see notes.local/routing.md).
type RouteFn = (url: string, replace?: boolean) => void;

let routeFn: RouteFn | null = null;

/** Called once from the router shell to wire up {@link navigate}. */
export function setRouter(fn: RouteFn): void {
	routeFn = fn;
}

export interface NavigateOptions {
	replace?: boolean;
}

export function navigate(to: string, options: NavigateOptions = {}): void {
	routeFn?.(to, options.replace ?? false);
}

/** The current path — for non-component code that needs to branch on the route. */
export function currentPath(): string {
	return window.location.pathname;
}
