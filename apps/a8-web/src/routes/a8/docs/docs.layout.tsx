import type { ComponentChildren } from "preact";

// The docs subapp shell (/a8/docs/*). A prose-only section with no emulator or
// browser-only APIs, so it stays prerenderable at build time. Stub for now:
// just a scrollable content column with a placeholder sidebar; the real nav
// (table of contents, section menu) and MDXProvider styling come next.
export function DocsLayout({ children }: { children: ComponentChildren }) {
	return (
		<div class="flex h-full bg-black text-neutral-200">
			<aside class="hidden w-56 shrink-0 border-r border-neutral-800 p-4 text-sm text-neutral-400 sm:block">
				<a href="/a8/docs" class="text-neutral-200 hover:text-white">
					Docs
				</a>
			</aside>
			<main class="flex-1 overflow-y-auto p-8">
				{/* `prose` supplies the Typography plugin's reading defaults;
				    `prose-invert` flips them for the dark background. The MDX
				    page renders bare h1/p/ul/… elements here, so this is what
				    styles them until (if) we add an MDXProvider component map. */}
				<article class="mx-auto prose prose-neutral prose-invert">
					{children}
				</article>
			</main>
		</div>
	);
}
