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
		// eslint-plugin-react detects the React version from node_modules; there
		// is no React yet (vanilla scaffold), so pin it to skip detection. Switch
		// to "detect" once React becomes a dependency.
		settings: { react: { version: "19.0" } },
	},
];
