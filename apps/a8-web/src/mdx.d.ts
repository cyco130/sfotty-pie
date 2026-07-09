// MDX/Markdown files compile (via @mdx-js/rollup, see vite.config.ts) to a
// module whose default export is a Preact component. This declares that shape
// so `import Doc from "./foo.page.mdx"` typechecks and slots into the route
// table like any other page component. `components` maps intrinsic elements
// (h1, a, code, ...) to custom renderers - the hook for giving docs the app's
// look via an MDXProvider later.
declare module "*.mdx" {
	import type { FunctionComponent } from "preact";

	const MDXContent: FunctionComponent<{
		components?: Record<string, unknown>;
	}>;
	export default MDXContent;
	export const frontmatter: Record<string, unknown>;
}

declare module "*.md" {
	import type { FunctionComponent } from "preact";

	const MDXContent: FunctionComponent<{
		components?: Record<string, unknown>;
	}>;
	export default MDXContent;
	export const frontmatter: Record<string, unknown>;
}
