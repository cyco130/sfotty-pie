import { importProgress } from "./images/library.ts";
import { messages } from "./messages.ts";

/**
 * A top-level import indicator in the app chrome — visible whatever panel is
 * open, and it keeps tracking after the library panel closes (the progress is a
 * module-level signal, not panel state). Renders nothing when idle. Shows an
 * indeterminate "Preparing…" while the dropped tree is walked, then a counted
 * bar with an ETA while files are ingested.
 */
export function ImportProgress() {
	const progress = importProgress.value;
	if (!progress) return null;

	const preparing = progress.phase === "preparing";
	const pct = preparing
		? 100
		: Math.round((progress.done / progress.total) * 100);
	// ETA from the rate so far (elapsed per file × files remaining).
	const eta =
		!preparing && progress.done > 0
			? (progress.elapsedMs / 1000 / progress.done) *
				(progress.total - progress.done)
			: 0;

	return (
		<div class="shrink-0 border-b border-neutral-800 bg-neutral-900 px-3 py-1 text-xs text-neutral-300">
			<div class="flex items-center justify-between gap-2">
				<span>
					{preparing ? messages.library.preparing : messages.library.adding}
				</span>
				{!preparing && (
					<span>
						{progress.done} / {progress.total}
						{eta > 0 ? ` · ${messages.library.eta(eta)}` : ""}
					</span>
				)}
			</div>
			<div class="mt-1 h-1 w-full overflow-hidden rounded bg-neutral-700">
				<div
					class={`h-full rounded bg-emerald-500 ${preparing ? "animate-pulse" : ""}`}
					style={{ width: `${pct}%` }}
				/>
			</div>
		</div>
	);
}
