import { defineConfig } from "vitest/config";

// A standalone test config — deliberately not the app's vite.config (no preact,
// tailwind, SSL, or the firmware-library scan): unit tests cover plain modules
// and IndexedDB logic, run under Node with a fake-indexeddb global.
export default defineConfig({
	test: {
		environment: "node",
		setupFiles: ["./vitest.setup.ts"],
	},
});
