import { prerender as renderToStaticHtml } from "preact-iso";
import {
	HeadCollector,
	type HeadProps,
	type HeadSink,
	toPrerenderHead,
} from "./head.ts";
import { Root } from "./root.tsx";

// Build-time only. vite-prerender-plugin (wired via prerenderScript in
// vite.config.ts) imports this in Node and calls `prerender` once per queued
// route. There's no document/window here — `globalThis.location` is set by the
// plugin per route, which is all preact-iso's <LocationProvider> needs. This
// module is never referenced by index.html, so it stays out of the client
// bundle entirely.
//
// We prerender the landing page (`/`, which the plugin writes into index.html)
// and the docs subapp; everything else returns an empty shell so its fallback
// stays a neutral SPA host. The emulator routes can't render in Node (they need
// browser APIs), so we neither seed them nor follow links into them: discovered
// links are filtered to /a8/docs, dropping the home page's link out to
// /a8/emu.
export async function prerender(data: { url: string }) {
	const prerenderable = data.url === "/" || data.url.startsWith("/a8/docs");
	if (!prerenderable) return { html: "" };
	// A request-scoped sink the page's <Head>/useHead hands its data to during
	// render. renderToStaticHtml awaits the lazy route tree, so it's populated
	// by the time this resolves.
	let collected: HeadProps | null = null;
	const sink: HeadSink = {
		collect: (head) => {
			collected = head;
		},
	};
	const { html, links } = await renderToStaticHtml(
		<HeadCollector.Provider value={sink}>
			<Root />
		</HeadCollector.Provider>,
	);
	const docsLinks = new Set(
		[...(links ?? [])].filter((href) => href.startsWith("/a8/docs")),
	);
	const head = collected ? toPrerenderHead(collected) : undefined;
	return { html, head, links: docsLinks };
}
