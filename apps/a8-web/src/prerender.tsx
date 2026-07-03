import { prerender as renderToStaticHtml } from "preact-iso";
import { Root } from "./root.tsx";

// Build-time only. vite-prerender-plugin (wired via prerenderScript in
// vite.config.ts) imports this in Node and calls `prerender` once per queued
// route. There's no document/window here — `globalThis.location` is set by the
// plugin per route, which is all preact-iso's <LocationProvider> needs. This
// module is never referenced by index.html, so it stays out of the client
// bundle entirely.
//
// We emit static markup only for the docs subapp. Every other route — including
// `/`, which the plugin always seeds and writes into index.html — returns an
// empty shell, so index.html keeps its empty #app and remains a neutral SPA
// fallback for all client-only routes. Discovered links are filtered to /docs
// so the crawler never wanders into the emulator, which can't render in Node.
export async function prerender(data: { url: string }) {
	if (!data.url.startsWith("/docs")) return { html: "" };
	const { html, links } = await renderToStaticHtml(<Root />);
	const docsLinks = new Set(
		[...(links ?? [])].filter((href) => href.startsWith("/docs")),
	);
	return { html, links: docsLinks };
}
