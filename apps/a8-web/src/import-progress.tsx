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

	// `preparing` / `compressing` are indeterminate (no count, pulsing full bar);
	// `adding` / `exporting` are counted with an ETA.
	const counted = progress.phase === "adding" || progress.phase === "exporting";
	const label = {
		preparing: messages.library.preparing,
		adding: messages.library.adding,
		exporting: messages.library.exporting,
		compressing: messages.library.compressing,
	}[progress.phase];
	const pct =
		counted && progress.total > 0
			? Math.round((progress.done / progress.total) * 100)
			: 100;
	// ETA from the rate so far (elapsed per item × items remaining).
	const eta =
		counted && progress.done > 0
			? (progress.elapsedMs / 1000 / progress.done) *
				(progress.total - progress.done)
			: 0;

	return (
		<div class="shrink-0 border-b border-neutral-800 bg-neutral-900 px-3 py-1 text-xs text-neutral-300">
			<div class="flex items-center justify-between gap-2">
				<span>{label}</span>
				{counted && (
					<span>
						{progress.done} / {progress.total}
						{eta > 0 ? ` · ${messages.library.eta(eta)}` : ""}
					</span>
				)}
			</div>
			<div class="mt-1 h-1 w-full overflow-hidden rounded bg-neutral-700">
				<div
					class={`h-full rounded bg-emerald-500 ${counted ? "" : "animate-pulse"}`}
					style={{ width: `${pct}%` }}
				/>
			</div>
		</div>
	);
}
