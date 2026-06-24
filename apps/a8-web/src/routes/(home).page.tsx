import { useHead } from "../head.ts";
import { messages } from "../messages.ts";

// Placeholder welcome page. Just a launch link for now; real content later.
export default function HomePage() {
	const t = messages.pages.home;
	useHead({ title: t.title });
	return (
		<main class="flex h-full flex-col items-center justify-center gap-6 bg-black p-8 text-center text-neutral-300">
			<h1 class="text-3xl font-semibold text-white">{t.heading}</h1>
			<p class="max-w-prose text-neutral-400">{t.lead}</p>
			<a
				href="/a8/emu"
				class="rounded bg-neutral-200 px-4 py-2 font-medium text-neutral-900 hover:bg-white"
			>
				{t.launch}
			</a>
		</main>
	);
}
