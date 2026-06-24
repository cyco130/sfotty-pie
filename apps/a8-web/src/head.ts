import { useEffect } from "preact/hooks";

/**
 * Per-page document head. preact-iso manages no head tags (runtime or
 * prerender), so this is ours. Shaped as an object (`useHead({ title })`, not
 * `useTitle(str)`) to match Rakkas's head API, so pages carry over unchanged if
 * we move to a real metaframework. Runtime-only for now — it sets
 * `document.title`; a future prerender pass would collect this separately.
 * `index.html`'s static `<title>` is the default for pages that set nothing.
 */
export interface Head {
	title?: string;
}

export function useHead({ title }: Head): void {
	useEffect(() => {
		if (title !== undefined) document.title = title;
	}, [title]);
}
