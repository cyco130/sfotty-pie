import { useHead } from "../head.ts";
import { messages } from "../messages.ts";

const GITHUB_URL = "https://github.com/cyco130/sfotty-pie";

export default function HomePage() {
	const t = messages.pages.home;
	useHead({ title: t.title });
	return (
		<main class="flex h-full flex-col overflow-y-auto bg-black text-neutral-300">
			<div class="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
				<img
					src="/sfotty-pie.svg"
					alt=""
					width="176"
					height="176"
					class="h-36 w-36 sm:h-44 sm:w-44"
				/>
				<h1 class="text-3xl font-semibold text-white">{t.heading}</h1>
				<p class="max-w-prose text-neutral-400">{t.lead}</p>
				<div class="flex flex-wrap items-center justify-center gap-3">
					<a
						href="/a8/emu"
						class="rounded bg-neutral-200 px-5 py-2 font-medium text-neutral-900 hover:bg-white"
					>
						{t.launch}
					</a>
					<a
						href={GITHUB_URL}
						target="_blank"
						rel="noreferrer"
						class="rounded border border-neutral-700 px-5 py-2 font-medium text-neutral-200 hover:bg-neutral-900"
					>
						{t.github}
					</a>
				</div>
			</div>
			<footer class="p-6 text-center text-xs text-neutral-500">
				<p class="mx-auto max-w-prose">
					{t.legal}{" "}
					<a
						href="/legal/THIRD-PARTY-LICENSES.md"
						target="_blank"
						rel="noreferrer"
						class="underline hover:text-neutral-300"
					>
						{t.thirdPartyLicenses}
					</a>
					.
				</p>
			</footer>
		</main>
	);
}
