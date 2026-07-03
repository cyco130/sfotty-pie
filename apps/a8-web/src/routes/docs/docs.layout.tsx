import type { ComponentChildren } from "preact";

// The docs subapp shell (/docs/*). A prose-only section with no emulator or
// browser-only APIs, so it stays prerenderable at build time. Stub for now:
// just a scrollable content column with a placeholder sidebar; the real nav
// (table of contents, section menu) and MDXProvider styling come next.
export function DocsLayout({ children }: { children: ComponentChildren }) {
	return (
		<div class="flex h-full bg-black text-neutral-200">
			<aside class="hidden w-56 shrink-0 border-r border-neutral-800 p-4 text-sm text-neutral-400 sm:block">
				<a href="/docs" class="text-neutral-200 hover:text-white">
					Docs
				</a>
			</aside>
			<main class="mx-auto max-w-2xl flex-1 overflow-y-auto p-8">
				{children}
			</main>
		</div>
	);
}
