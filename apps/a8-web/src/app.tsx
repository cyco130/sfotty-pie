import { FRAME_BUFFER_HEIGHT, FRAME_BUFFER_WIDTH } from "@sfotty-pie/a8";
import { useEffect, useRef } from "preact/hooks";
import { Alert } from "./alert.tsx";
import { BottomBar } from "./bottom-bar.tsx";
import type { EmulatorHost } from "./host.ts";
import { Osd } from "./osd.tsx";
import { Palette } from "./palette.tsx";
import { Sidebar } from "./sidebar.tsx";
import { TopBar } from "./top-bar.tsx";

/**
 * The application shell: a full-viewport column of top status bar, the
 * letterboxed emulator screen, and a (reserved) bottom status bar. Preact
 * owns this chrome; the {@link EmulatorHost} owns the real-time loop that
 * blits into the ref'd canvas, so nothing on the hot path re-renders.
 */
export function App({ host }: { host: EmulatorHost }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const keyInput = useRef<HTMLInputElement>(null);
	const fileInput = useRef<HTMLInputElement>(null);
	const rootRef = useRef<HTMLDivElement>(null);

	// Hand the canvas and keystroke input to the host, and start running.
	useEffect(() => {
		const canvas = canvasRef.current;
		const input = keyInput.current;
		const root = rootRef.current;
		if (!canvas || !input || !root) return;

		host.registerBootImagePicker(() => fileInput.current?.click());
		const teardowns = [
			host.attachScreen(canvas),
			host.attachKeyboard(input, root),
			host.enableAudioResume(),
		];
		host.start();
		return () => teardowns.forEach((teardown) => teardown());
	}, [host]);

	// Dropping a file anywhere on the page loads it.
	useEffect(() => {
		const over = (event: DragEvent) => event.preventDefault();
		const drop = (event: DragEvent) => {
			event.preventDefault();
			const file = event.dataTransfer?.files[0];
			if (file) void host.loadFile(file);
		};
		window.addEventListener("dragover", over);
		window.addEventListener("drop", drop);
		return () => {
			window.removeEventListener("dragover", over);
			window.removeEventListener("drop", drop);
		};
	}, [host]);

	return (
		<div
			ref={rootRef}
			class="flex h-full flex-col bg-black text-neutral-300 select-none sm:flex-row"
		>
			{/* The menu pushes the screen aside (left on desktop, top on
			    mobile) rather than overlaying it. */}
			<Sidebar host={host} />

			<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
				<TopBar host={host} />

				{/* The screen: canvas centered, sized by the host, letterboxed. */}
				<div class="relative flex-1 overflow-hidden bg-black">
					<canvas
						ref={canvasRef}
						width={FRAME_BUFFER_WIDTH}
						height={FRAME_BUFFER_HEIGHT}
						class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 [image-rendering:pixelated]"
					/>
				</div>

				<Osd host={host} />

				<BottomBar host={host} />
			</div>

			<Alert host={host} />

			<Palette host={host} />

			{/* Hidden picker behind the "Boot image…" menu action. */}
			<input
				ref={fileInput}
				type="file"
				accept=".rom,.bin,.raw,.car,.atr,.xex,.exe,.com,.obx"
				class="hidden"
				onChange={(event) => {
					const picker = event.currentTarget;
					const file = picker.files?.[0];
					if (file) void host.loadFile(file);
					picker.value = ""; // re-picking the same file fires again
				}}
			/>

			{/* Offscreen: captures keystrokes (incl. dead-key composition).
			    `inputmode=none` keeps it focusable for a physical keyboard
			    without raising the on-screen keyboard on touch devices. */}
			<input
				ref={keyInput}
				type="text"
				inputmode="none"
				autocapitalize="off"
				autocomplete="off"
				spellcheck={false}
				class="fixed top-0 left-0 h-px w-px border-none p-0 opacity-0"
			/>
		</div>
	);
}
