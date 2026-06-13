import preact from "@preact/preset-vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	// basicSsl serves dev over HTTPS so the page is a secure context on a LAN
	// IP — required for AudioWorklet (and other secure-only APIs) to exist when
	// testing on a real device. Expect a one-time "untrusted certificate"
	// prompt in the browser. `host: true` exposes the server on the LAN so the
	// device can reach it in the first place.
	plugins: [preact(), tailwindcss(), basicSsl()],
	// Treat ROM/image files as binary assets so the library's globbed imports
	// emit them as hashed assets instead of trying to parse them as source.
	assetsInclude: ["**/*.rom"],
	server: { host: true },
	// @sfotty-pie/a8 is a linked workspace package built to dist. Excluding it
	// from dep pre-bundling lets Vite pick up its rebuilds (from the root
	// `pnpm dev` watch) and reload, instead of serving a stale optimized copy.
	optimizeDeps: {
		exclude: ["@sfotty-pie/a8", "@sfotty-pie/sfotty"],
	},
});
