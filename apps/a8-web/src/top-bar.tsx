import type { AudioState, EmulatorHost } from "./host.ts";

const AUDIO_LABEL: Record<AudioState, string> = {
	unavailable: "No audio",
	suspended: "Tap for audio",
	on: "Audio on",
	muted: "Audio muted",
};

/**
 * The top status bar: machine summary (opens the menu), and the audio,
 * run/pause, and frame-rate indicators. Each clickable item dispatches a
 * command, so keys and the future command palette drive the same verbs.
 */
export function TopBar({ host }: { host: EmulatorHost }) {
	const config = host.config.value;
	const audio = host.audio.value;
	const running = host.running.value;
	const fps = host.fps.value;

	return (
		<header class="flex h-9 shrink-0 items-center gap-4 px-3 text-base">
			<button
				type="button"
				class="text-neutral-400 hover:text-white"
				aria-label="Menu"
				onClick={() => host.dispatch("MENU_TOGGLE")}
			>
				☰
			</button>
			<button
				type="button"
				class="text-neutral-300 hover:text-white"
				onClick={() => host.dispatch("MENU_OPEN")}
			>
				{config.model} · {config.tv.toUpperCase()}
			</button>

			<div class="ml-auto flex items-center gap-4 text-neutral-400">
				<button
					type="button"
					class="hover:text-white disabled:cursor-default disabled:opacity-50"
					disabled={audio === "unavailable"}
					onClick={() => host.dispatch("AUDIO_TOGGLE")}
				>
					{AUDIO_LABEL[audio]}
				</button>
				<button
					type="button"
					class="hover:text-white"
					onClick={() => host.dispatch("TOGGLE_PAUSE")}
				>
					{running ? "Running" : "Paused"}
				</button>
				<span class="w-16 text-right tabular-nums text-neutral-500">
					{fps ? `${fps} fps` : "—"}
				</span>
			</div>
		</header>
	);
}
