import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import mdx from "@mdx-js/rollup";
import preact from "@preact/preset-vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { firmwareLibrary } from "./firmware-library-plugin.ts";

// The commit the build was made from, surfaced in the UI to identify manual
// deployments. Marked `-dirty` when the tree has uncommitted changes, and
// `unknown` outside a git checkout.
function gitHash(): string {
	try {
		const hash = execSync("git rev-parse --short HEAD").toString().trim();
		const dirty = execSync("git status --porcelain").toString().trim() !== "";
		return dirty ? `${hash}-dirty` : hash;
	} catch {
		return "unknown";
	}
}

export default defineConfig({
	appType: "spa",
	// Build-time constant: replaces `import.meta.env.GIT_HASH` in the source.
	define: { "import.meta.env.GIT_HASH": JSON.stringify(gitHash()) },
	// basicSsl serves dev over HTTPS so the page is a secure context on a LAN
	// IP — required for AudioWorklet (and other secure-only APIs) to exist when
	// testing on a real device. Expect a one-time "untrusted certificate"
	// prompt in the browser. `host: true` exposes the server on the LAN so the
	// device can reach it in the first place.
	// `enforce: "pre"` runs the MDX compiler before @preact/preset-vite's babel,
	// so .md(x) files arrive at preset-vite as ordinary Preact JSX (a
	// default-exported component). `jsxImportSource: "preact"` targets Preact's
	// automatic JSX runtime to match the rest of the app.
	plugins: [
		{ ...mdx({ jsxImportSource: "preact" }), enforce: "pre" },
		// Build-time prerender of the docs subapp only. The build-time entry
		// (src/prerender.tsx, referenced explicitly so it never ships to the
		// browser) emits real markup for /docs* and an empty shell for
		// everything else, including `/` which the plugin always writes into
		// index.html — keeping index.html a neutral SPA fallback. `renderTarget`
		// matches where main.tsx mounts (<main id="app">).
		preact({
			prerender: {
				enabled: true,
				prerenderScript: fileURLToPath(
					new URL("./src/prerender.tsx", import.meta.url),
				),
				renderTarget: "#app",
				additionalPrerenderRoutes: ["/docs"],
				previewMiddlewareEnabled: true,
			},
		}),
		tailwindcss(),
		basicSsl(),
		firmwareLibrary(),
	],
	// Treat ROM/image files as binary assets so the library's globbed imports
	// emit them as hashed assets instead of trying to parse them as source.
	assetsInclude: ["**/*.rom", "**/*.xex", "**/*.atr", "**/*.car"],
	server: { host: true },
	// A single-page SPA: index.html is the only entry (Vite's default), so no
	// rollupOptions.input is needed.
	build: {
		// Emit hashed, content-addressed assets under /_app/assets so the
		// deploy's Nginx can serve them with a long-lived immutable cache
		// (everything here is fingerprinted, so it's safe to cache forever).
		assetsDir: "_app/assets",
		// Never inline SVGs as data URIs: the icon sprite is referenced with
		// `<use href="…#id">`, and browsers don't resolve a #fragment against a
		// data: URI — it must stay a real (hashed) file. `false` opts out;
		// `undefined` keeps Vite's default size threshold for everything else.
		assetsInlineLimit: (filePath) =>
			filePath.endsWith(".svg") ? false : undefined,
	},
	// @sfotty-pie/a8 is a linked workspace package built to dist. Excluding it
	// from dep pre-bundling lets Vite pick up its rebuilds (from the root
	// `pnpm dev` watch) and reload, instead of serving a stale optimized copy.
	optimizeDeps: {
		exclude: ["@sfotty-pie/a8", "@sfotty-pie/sfotty"],
	},
});
