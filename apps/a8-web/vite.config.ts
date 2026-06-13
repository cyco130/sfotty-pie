import { readFile } from "node:fs/promises";
import { join } from "node:path";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

// Serve the (gitignored, unredistributable) ROM images from roms.local/ at the
// repo root during dev. A middleware rather than a public/ symlink so the ROMs
// can never end up in the build output.
function serveLocalRoms(): Plugin {
	return {
		name: "serve-local-roms",
		configureServer(server) {
			server.middlewares.use("/roms", (req, res, next) => {
				const name = req.url?.slice(1) ?? "";
				if (!/^[\w.-]+\.rom$/.test(name)) {
					next();
					return;
				}
				readFile(join(import.meta.dirname, "../../roms.local", name)).then(
					(data) => {
						res.setHeader("Content-Type", "application/octet-stream");
						res.end(data);
					},
					() => {
						res.statusCode = 404;
						res.end("ROM not found");
					},
				);
			});
		},
	};
}

export default defineConfig({
	plugins: [preact(), tailwindcss(), serveLocalRoms()],
	// @sfotty-pie/a8 is a linked workspace package built to dist. Excluding it
	// from dep pre-bundling lets Vite pick up its rebuilds (from the root
	// `pnpm dev` watch) and reload, instead of serving a stale optimized copy.
	optimizeDeps: {
		exclude: ["@sfotty-pie/a8", "@sfotty-pie/sfotty"],
	},
});
