import config from "@cyco130/eslint-config/react";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";

/** @type {typeof config} */
export default [
	...config,
	{
		ignores: ["dist/", "node_modules/"],
	},
	{
		files: ["src/**/*.tsx"],
		plugins: { "better-tailwindcss": betterTailwindcss },
		settings: {
			"better-tailwindcss": { entryPoint: "src/index.css" },
		},
		rules: {
			...betterTailwindcss.configs.recommended.rules,
			// prettier-plugin-tailwindcss owns class order and line width, so
			// the two stylistic rules that would fight it stay off.
			"better-tailwindcss/enforce-consistent-class-order": "off",
			"better-tailwindcss/enforce-consistent-line-wrapping": "off",
		},
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
	{
		// scripts/ holds standalone Node CLIs (CI/deploy tooling), not browser
		// code — stdout logging is their UI, so `console.log` is fine here.
		files: ["scripts/**"],
		rules: { "no-console": "off" },
	},
];
