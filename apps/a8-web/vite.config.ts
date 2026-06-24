import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import preact from "@preact/preset-vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

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
	// Build-time constant: replaces `import.meta.env.GIT_HASH` in the source.
	define: { "import.meta.env.GIT_HASH": JSON.stringify(gitHash()) },
	// basicSsl serves dev over HTTPS so the page is a secure context on a LAN
	// IP — required for AudioWorklet (and other secure-only APIs) to exist when
	// testing on a real device. Expect a one-time "untrusted certificate"
	// prompt in the browser. `host: true` exposes the server on the LAN so the
	// device can reach it in the first place.
	plugins: [preact(), tailwindcss(), basicSsl()],
	// Treat ROM/image files as binary assets so the library's globbed imports
	// emit them as hashed assets instead of trying to parse them as source.
	assetsInclude: ["**/*.rom", "**/*.xex", "**/*.atr", "**/*.car"],
	server: { host: true },
	// Multi-page build: the emulator (index.html), the reference docs
	// (docs/index.html, served at /docs/), and the keyboard event lab
	// (keyboard-lab.html, served at /keyboard-lab.html) — shipped so its
	// capturability probes can be run on borrowed/remote machines.
	build: {
		rollupOptions: {
			input: {
				main: fileURLToPath(new URL("./index.html", import.meta.url)),
				docs: fileURLToPath(new URL("./docs/index.html", import.meta.url)),
				keyboardLab: fileURLToPath(
					new URL("./keyboard-lab.html", import.meta.url),
				),
			},
		},
	},
	// @sfotty-pie/a8 is a linked workspace package built to dist. Excluding it
	// from dep pre-bundling lets Vite pick up its rebuilds (from the root
	// `pnpm dev` watch) and reload, instead of serving a stale optimized copy.
	optimizeDeps: {
		exclude: ["@sfotty-pie/a8", "@sfotty-pie/sfotty"],
	},
});
