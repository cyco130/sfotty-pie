import type { ComponentChildren } from "preact";
import { useLocation } from "preact-iso";
import { useEffect, useRef, useState } from "preact/hooks";
import { App } from "../../../app.tsx";
import { AudioOutput } from "../../../audio.ts";
import { installDevConsole } from "../../../dev-console.ts";
import { useHead } from "../../../head.ts";
import { EmulatorHost, type SidebarPanel } from "../../../host.ts";
import { messages } from "../../../messages.ts";
import { isToggleChord } from "../../../sidebar.tsx";
import { EmuContext } from "./emu-context.ts";

// The audio sink is a page-level singleton — created once and reused across
// emulator mounts (the machine reboots on re-entry, but the sink doesn't),
// lazily on first entry to /a8/emu so content pages never pay for it. The host
// resolves firmware through the image library (built-ins ∪ user uploads) and
// fetches only the ROMs it picks, which the browser caches.

interface Audio {
	audio: AudioOutput | null;
	audioError: string | null;
}
let audioOnce: Promise<Audio> | null = null;
function getAudio(): Promise<Audio> {
	// One audio sink for the page; setup can fail (e.g. iOS worklet/gesture
	// restrictions) — keep the reason so the host can surface it.
	return (audioOnce ??= AudioOutput.create().then(
		(audio) => ({ audio, audioError: null }),
		(error: unknown) => ({ audio: null, audioError: String(error) }),
	));
}

function panelFromPath(path: string): SidebarPanel | null {
	if (path === "/a8/emu/menu") return "menu";
	if (path === "/a8/emu/config") return "config";
	if (path === "/a8/emu/palette") return "palette";
	if (path === "/a8/emu/roms") return "roms";
	if (path === "/a8/emu/library" || path.startsWith("/a8/emu/library/")) {
		return "library";
	}
	return null;
}

type BootState =
	| { kind: "loading" }
	| { kind: "error"; message: string }
	| { kind: "ready"; host: EmulatorHost };

/**
 * The persistent emulator shell (/a8/emu/*). Owns the machine: loads firmware,
 * sets up audio, builds the {@link EmulatorHost}, then renders the chrome with
 * the panel routes ({@link children}) in its sidebar slot. The host is created
 * on mount and stopped on unmount, so leaving and returning reboots the machine
 * (firmware/audio are reused). Lazily code-split, so the emulator core never
 * lands in the initial bundle.
 */
export default function A8EmuLayout({
	children,
}: {
	children?: ComponentChildren;
}) {
	useHead({ title: messages.pages.emu.title });
	const [state, setState] = useState<BootState>({ kind: "loading" });

	useEffect(() => {
		let host: EmulatorHost | null = null;
		let cancelled = false;
		void (async () => {
			try {
				const { audio, audioError } = await getAudio();
				if (cancelled) return;
				const built = await EmulatorHost.create({
					model: "xl/xe",
					audio,
					audioError,
				});
				if (cancelled) {
					built.pause();
					return;
				}
				host = built;
				installDevConsole(host);
				setState({ kind: "ready", host });
			} catch (error) {
				if (!cancelled) setState({ kind: "error", message: String(error) });
			}
		})();
		return () => {
			cancelled = true;
			// Halt the core on the way out (App's own teardown drops the screen,
			// keyboard, and audio-resume). The page-level audio sink is reused.
			host?.pause();
		};
	}, []);

	if (state.kind !== "ready") {
		return (
			<div class="flex h-full items-center justify-center bg-black p-8 text-center text-neutral-400">
				{state.kind === "error" ? state.message : messages.app.loadingFirmware}
			</div>
		);
	}
	return <EmuShell host={state.host}>{children}</EmuShell>;
}

/**
 * The chrome + cross-cutting panel behaviour, mounted only once the host is
 * ready. The open panel is driven by the URL (the panel routes render into the
 * sidebar slot); this mirrors it onto `host.sidebar` for the top bar and OSD,
 * and owns the palette chord, Esc-to-close, and the iOS keyboard primer.
 */
function EmuShell({
	host,
	children,
}: {
	host: EmulatorHost;
	children?: ComponentChildren;
}) {
	const { path } = useLocation();
	const primerRef = useRef<HTMLInputElement>(null);
	const panelOpen = panelFromPath(path) !== null;

	// URL is the source of truth for the open panel; mirror it onto the host
	// signal that the top bar and OSD read.
	useEffect(() => {
		host.setSidebar(panelFromPath(path));
	}, [host, path]);

	// The global palette chord (Cmd/Alt+K). Capture phase + stopImmediate so it
	// preempts both the browser and the emulator's offscreen-input handler.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (!isToggleChord(event)) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			host.togglePanel("palette");
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [host]);

	// Esc closes whatever panel is open. Capture-phase + stopPropagation so the
	// keystroke doesn't also reach the emulator's offscreen input.
	useEffect(() => {
		if (!panelOpen) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			host.closePanel();
		};
		document.addEventListener("keydown", onKey, true);
		return () => document.removeEventListener("keydown", onKey, true);
	}, [host, panelOpen]);

	// Opening the palette from a tap: focus a throwaway input synchronously
	// within the gesture so iOS Safari raises the soft keyboard (it only does so
	// for in-gesture focus). PaletteView then moves focus to its real search box.
	const openPalette = () => {
		primerRef.current?.focus();
		host.showPanel("palette");
	};

	return (
		<EmuContext.Provider value={{ host, openPalette }}>
			<App host={host} sidebar={children} />
			{/* Off-screen primer (see openPalette): kept mounted so a tap can
			    focus it within the gesture and raise the iOS soft keyboard. */}
			<input
				ref={primerRef}
				type="text"
				aria-hidden="true"
				tabIndex={-1}
				autocomplete="off"
				autocapitalize="off"
				spellcheck={false}
				class="pointer-events-none fixed top-0 left-0 h-px w-px opacity-0"
			/>
		</EmuContext.Provider>
	);
}
