import { useHead } from "../head.ts";
import { messages } from "../messages.ts";

// Catch-all not-found page. Rendered (status 200) for any unmatched URL in
// pure-SPA mode; a real 404 status would need the deferred CF-side handling.
export default function NotFoundPage() {
	const t = messages.pages.notFound;
	useHead({ title: t.title });
	return (
		<main class="flex h-full flex-col items-center justify-center gap-4 bg-black p-8 text-center text-neutral-300">
			<h1 class="text-3xl font-semibold text-white">{t.heading}</h1>
			<p class="text-neutral-400">{t.body}</p>
			<a href="/" class="text-neutral-200 underline hover:text-white">
				{t.home}
			</a>
		</main>
	);
}
