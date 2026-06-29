import type { AudioState, EmulatorHost } from "./host.ts";
import { Icon, type IconName } from "./icon.tsx";
import { MODEL_LABELS, ramTotal } from "./machine-config.ts";
import { messages } from "./messages.ts";

// The audio indicator's icon per state: full waves when on, an X when muted,
// a plain speaker awaiting the first gesture (suspended), and a slashed
// speaker when Web Audio is unavailable.
const AUDIO_ICON: Record<AudioState, IconName> = {
	unavailable: "volume-off",
	suspended: "volume",
	on: "volume-2",
	muted: "volume-x",
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
	const turboMode = host.turboMode.value;
	const fps = host.fps.value;
	const panelOpen = host.sidebar.value !== null;

	// The compact font keeps the bar from wrapping on narrow viewports. It
	// normally relaxes to full size at `sm` (640px), but an open sidebar steals
	// ~1/4 of the width, so while it's open we hold compact until `lg` (1024px) —
	// otherwise the bar crowds on a landscape phone.
	const density = panelOpen
		? "lg:gap-5 lg:px-3 lg:text-base"
		: "sm:gap-5 sm:px-3 sm:text-base";

	return (
		<header
			class={`flex h-9 shrink-0 items-center gap-3 px-2 text-xs whitespace-nowrap ${density}`}
		>
			<button
				type="button"
				class="text-neutral-400 hover:text-white"
				aria-label={messages.topBar.menu}
				title={messages.topBar.menu}
				onClick={() => host.togglePanel("menu")}
			>
				<Icon name="menu" class="size-6" />
			</button>
			<button
				type="button"
				class="text-neutral-300 hover:text-white"
				onClick={() => host.showPanel("config")}
			>
				{MODEL_LABELS[config.model]} · {ramTotal(config)}K ·{" "}
				{config.tv.toUpperCase()}
			</button>

			<div class="ml-auto flex items-center gap-3 text-neutral-400 sm:gap-5">
				<button
					type="button"
					class={
						audio === "unavailable"
							? "opacity-50 hover:text-white"
							: audio === "suspended"
								? "text-amber-400 hover:text-amber-300"
								: "hover:text-white"
					}
					aria-label={messages.audio[audio]}
					title={messages.audio[audio]}
					onClick={() => host.dispatch("AUDIO_TOGGLE")}
				>
					<Icon name={AUDIO_ICON[audio]} class="size-6" />
				</button>
				<button
					type="button"
					class={
						running
							? "hover:text-white"
							: "text-amber-400 hover:text-amber-300 motion-safe:animate-pulse"
					}
					aria-label={
						running ? messages.topBar.running : messages.topBar.paused
					}
					title={running ? messages.topBar.running : messages.topBar.paused}
					onClick={() => host.dispatch("TOGGLE_PAUSE")}
				>
					{/* Action-semantic: while running, the button pauses (and vice
					    versa), so it shows the icon for what a click will do. */}
					<Icon name={running ? "pause" : "play"} class="size-6" />
				</button>
				<button
					type="button"
					class={
						turboMode
							? "text-amber-400 hover:text-amber-300 motion-safe:animate-pulse"
							: "hover:text-white"
					}
					aria-label={messages.topBar.turbo}
					title={messages.topBar.turbo}
					onClick={() => host.dispatch("TURBO_MODE_TOGGLE")}
				>
					<Icon name="zap" class="size-6" />
				</button>
				<span class="w-16 text-right tabular-nums text-neutral-500">
					{fps ? `${fps} fps` : "—"}
				</span>
			</div>
		</header>
	);
}
