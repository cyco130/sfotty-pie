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
// We emit static markup only for the docs subapp. Every other route — including
// `/`, which the plugin always seeds and writes into index.html — returns an
// empty shell, so index.html keeps its empty #app and remains a neutral SPA
// fallback for all client-only routes. Discovered links are filtered to
// /a8/docs so the crawler never wanders into the emulator, which can't render
// in Node.
export async function prerender(data: { url: string }) {
	if (!data.url.startsWith("/a8/docs")) return { html: "" };
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
