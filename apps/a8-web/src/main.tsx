import { render } from "preact";
import { AudioOutput } from "./audio.ts";
import { installDevConsole } from "./dev-console.ts";
import { EmulatorHost } from "./host.ts";
import { loadFirmwareLibrary } from "./library.ts";
import { messages } from "./messages.ts";
import { Root } from "./root.tsx";
import "./index.css";

async function main(): Promise<void> {
	const root = document.querySelector<HTMLElement>("#app");
	if (!root) return;

	root.textContent = messages.app.loadingFirmware;

	// The OS and BASIC ROMs come from the built-in library now; the host ranks
	// and picks the best match for the running machine.
	let firmware;
	try {
		firmware = await loadFirmwareLibrary();
	} catch (error) {
		root.textContent = String(error);
		return;
	}

	// One audio sink for the page; emulators come and go across Loads. If setup
	// throws (e.g. iOS Safari's worklet/gesture restrictions), keep the reason
	// so the host can show it when the user taps the "No audio" indicator.
	let audio: AudioOutput | null = null;
	let audioError: string | null = null;
	try {
		audio = await AudioOutput.create();
	} catch (error) {
		audioError = String(error);
	}

	let host: EmulatorHost;
	try {
		host = new EmulatorHost({ model: "800XL", firmware, audio, audioError });
	} catch (error) {
		// e.g. no compatible OS ROM in the library for the default machine.
		root.textContent = String(error);
		return;
	}
	installDevConsole(host);

	root.textContent = "";
	render(<Root host={host} />, root);
}

void main();
