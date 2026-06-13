import config from "@cyco130/eslint-config/react";

/** @type {typeof config} */
export default [
	...config,
	{
		ignores: ["dist/", "node_modules/"],
	},
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		// The UI is Preact, not React, so there's no `react` package for
		// eslint-plugin-react's "detect" to resolve — pin to the React API
		// level Preact's compat targets so the version-gated rules behave.
		settings: { react: { version: "19.0" } },
		rules: {
			// Preact's JSX is HTML-style (class, for, spellcheck, …), which
			// its own TypeScript types already validate. eslint-plugin-react's
			// no-unknown-property only knows React's camelCase DOM props, so it
			// false-positives on every Preact attribute — turn it off here.
			"react/no-unknown-property": "off",
		},
	},
];
