import { useEffect, useState } from "preact/hooks";
import { App } from "../../../app.tsx";
import { AudioOutput } from "../../../audio.ts";
import { installDevConsole } from "../../../dev-console.ts";
import { useHead } from "../../../head.ts";
import { EmulatorHost } from "../../../host.ts";
import { loadFirmwareLibrary } from "../../../library.ts";
import { messages } from "../../../messages.ts";

// Page-level singletons. The firmware set and the audio sink are created once
// and reused across emulator mounts — the machine reboots on re-entry, but
// these don't. Created lazily on first entry to /a8/emu, so content pages (the
// welcome page, reference, …) never pay to load or build them.
let firmwareOnce: ReturnType<typeof loadFirmwareLibrary> | null = null;
function getFirmware() {
	return (firmwareOnce ??= loadFirmwareLibrary());
}

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

type BootState =
	| { kind: "loading" }
	| { kind: "error"; message: string }
	| { kind: "ready"; host: EmulatorHost };

/**
 * The persistent emulator shell (/a8/emu). Owns the machine: loads firmware,
 * sets up audio, builds the {@link EmulatorHost}, then renders the chrome. The
 * host is created on mount and stopped on unmount, so leaving and returning
 * reboots the machine (firmware/audio are reused). Lazily code-split, so the
 * emulator core never lands in the initial bundle.
 */
export default function A8EmuLayout() {
	useHead({ title: messages.pages.emu.title });
	const [state, setState] = useState<BootState>({ kind: "loading" });

	useEffect(() => {
		let host: EmulatorHost | null = null;
		let cancelled = false;
		void (async () => {
			try {
				const firmware = await getFirmware();
				const { audio, audioError } = await getAudio();
				if (cancelled) return;
				host = new EmulatorHost({
					model: "800XL",
					firmware,
					audio,
					audioError,
				});
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
	return <App host={state.host} />;
}
