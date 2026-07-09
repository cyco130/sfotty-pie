import { createContext } from "preact";
import { useContext, useEffect } from "preact/hooks";

/**
 * Per-page document head. preact-iso manages no head tags, so this is ours. A
 * single `useHead({ title, description })` call (or the {@link Head} component)
 * feeds two consumers from one declaration: at runtime it reconciles the live
 * document from an effect; during the build-time prerender pass it hands the
 * data up through {@link HeadCollector} so prerender.tsx can serialize it into
 * the static `<head>`. `title` also drives `og:title` and `description` drives
 * `og:description`; the constant OG/Twitter tags (og:image, og:site_name, ...)
 * live statically in index.html.
 */
export interface HeadProps {
	/** `<html lang>`. Defaults to "en". */
	lang?: string;
	/** `<title>` and `og:title`. */
	title?: string;
	/** `<meta name="description">` and `og:description`. */
	description?: string;
}

/**
 * Request-scoped sink the prerender pass provides via {@link HeadCollector}.
 * `useHead` hands its data over during render (build only); absent at runtime.
 * A method rather than a field so the call reads as intent, not a mutation of a
 * hook return value.
 */
export interface HeadSink {
	collect(head: HeadProps): void;
}

export const HeadCollector = createContext<HeadSink | null>(null);

export function useHead(head: HeadProps): void {
	// Build: hand our head to the sink during render. Rendering is top-down, so
	// the last useHead to run (the page) wins over a shallower one (a layout).
	useContext(HeadCollector)?.collect(head);

	// Runtime: apply to the live document. Effects never run during prerender,
	// so `document` is only ever touched on the client.
	const { lang, title, description } = head;
	useEffect(() => {
		applyHeadToDocument({ lang, title, description });
	}, [lang, title, description]);
}

/**
 * Render-nothing wrapper around {@link useHead} so `.mdx` (and `.tsx`) pages can
 * declare their head as JSX: `<Head title="..." description="..." />`.
 */
export function Head(head: HeadProps): null {
	useHead(head);
	return null;
}

/** A single serialized `<head>` tag, shaped for vite-prerender-plugin. */
export interface HeadElement {
	type: string;
	props: Record<string, string>;
}

/**
 * Project a page's head into vite-prerender-plugin's `head` payload. Only the
 * varying tags are here; the constant OG/Twitter tags stay static in index.html.
 * An absent title yields `""`, which the plugin treats as "leave the template
 * `<title>` alone".
 */
export function toPrerenderHead(head: HeadProps): {
	lang: string;
	title: string;
	elements: Set<HeadElement>;
} {
	const elements = new Set<HeadElement>();
	if (head.title !== undefined) {
		elements.add({
			type: "meta",
			props: { property: "og:title", content: head.title },
		});
	}
	if (head.description !== undefined) {
		elements.add({
			type: "meta",
			props: { name: "description", content: head.description },
		});
		elements.add({
			type: "meta",
			props: { property: "og:description", content: head.description },
		});
	}
	return { lang: head.lang ?? "en", title: head.title ?? "", elements };
}

/** Runtime: reconcile the live document with a page's head. Client-only. */
function applyHeadToDocument(head: HeadProps): void {
	document.documentElement.lang = head.lang ?? "en";
	if (head.title !== undefined) {
		document.title = head.title;
		upsertMeta("property", "og:title", head.title);
	}
	if (head.description !== undefined) {
		upsertMeta("name", "description", head.description);
		upsertMeta("property", "og:description", head.description);
	}
}

function upsertMeta(
	attr: "name" | "property",
	key: string,
	content: string,
): void {
	let el = document.head.querySelector<HTMLMetaElement>(
		`meta[${attr}="${key}"]`,
	);
	if (!el) {
		el = document.createElement("meta");
		el.setAttribute(attr, key);
		document.head.appendChild(el);
	}
	el.setAttribute("content", content);
}
