import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// A standalone test config — deliberately not the app's vite.config (no preact,
// tailwind, SSL, or the firmware-library scan): unit tests cover plain modules
// and IndexedDB logic, run under Node with a fake-indexeddb global. The
// `virtual:firmware-library` module (normally emitted by the firmware-library
// plugin) is aliased to a small fixture so the image library is testable.
export default defineConfig({
	resolve: {
		alias: {
			"virtual:firmware-library": fileURLToPath(
				new URL("./test/firmware-library-stub.ts", import.meta.url),
			),
		},
	},
	test: {
		environment: "node",
		setupFiles: ["./vitest.setup.ts"],
	},
});
