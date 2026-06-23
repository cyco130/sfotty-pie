import type { EmulatorHost } from "./host.ts";
import { messages } from "./messages.ts";

/**
 * The top status bar: machine summary (opens the menu), and the audio,
 * run/pause, and frame-rate indicators. Each clickable item dispatches a
 * command, so keys and the future command palette drive the same verbs.
 */
export function TopBar({ host }: { host: EmulatorHost }) {
	const config = host.config.value;
	const audio = host.audio.value;
	const running = host.running.value;
	const turboMode = host.turboMode.value;
	const fps = host.fps.value;
	const panelOpen = host.sidebar.value !== null;

	// The compact font keeps the bar from wrapping on narrow viewports. It
	// normally relaxes to full size at `sm` (640px), but an open sidebar steals
	// ~1/4 of the width, so while it's open we hold compact until `lg` (1024px) —
	// otherwise the bar crowds on a landscape phone.
	const density = panelOpen
		? "lg:gap-4 lg:px-3 lg:text-base"
		: "sm:gap-4 sm:px-3 sm:text-base";

	return (
		<header
			class={`flex h-9 shrink-0 items-center gap-2 px-2 text-xs whitespace-nowrap ${density}`}
		>
			<button
				type="button"
				class="text-neutral-400 hover:text-white"
				aria-label={messages.topBar.menu}
				onClick={() => host.dispatch("MENU_TOGGLE")}
			>
				☰
			</button>
			<button
				type="button"
				class="text-neutral-300 hover:text-white"
				onClick={() => host.showPanel("menu")}
			>
				{config.model} · {config.tv.toUpperCase()}
			</button>

			<div class="ml-auto flex items-center gap-2 text-neutral-400 sm:gap-4">
				<button
					type="button"
					class={
						audio === "unavailable"
							? "opacity-50 hover:text-white"
							: "hover:text-white"
					}
					onClick={() => host.dispatch("AUDIO_TOGGLE")}
				>
					{messages.audio[audio]}
				</button>
				<button
					type="button"
					class="hover:text-white"
					onClick={() => host.dispatch("TOGGLE_PAUSE")}
				>
					{running ? messages.topBar.running : messages.topBar.paused}
				</button>
				<button
					type="button"
					class={
						turboMode
							? "text-amber-400 hover:text-amber-300"
							: "hover:text-white"
					}
					onClick={() => host.dispatch("TURBO_MODE_TOGGLE")}
				>
					{messages.topBar.turbo}
				</button>
				<span class="w-16 text-right tabular-nums text-neutral-500">
					{fps ? `${fps} fps` : "—"}
				</span>
			</div>
		</header>
	);
}
