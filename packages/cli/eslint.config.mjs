import config from "@cyco130/eslint-config/node";

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
				// @ts-expect-error: remove this directive if you have Node type definitions in your project
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
];
