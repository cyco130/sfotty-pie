import config from "@cyco130/eslint-config/node";

/** @type {typeof config} */
export default [
	...config,
	{
		// `*.local.*` are gitignored dev scratch (debug harnesses): kept in the
		// project for types/imports, but not held to lint.
		ignores: ["dist/", "node_modules/", "**/*.local.*"],
	},
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
];
