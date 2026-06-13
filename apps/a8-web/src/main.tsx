import { render } from "preact";
import { App } from "./app.tsx";
import { AudioOutput } from "./audio.ts";
import { installDevConsole } from "./dev-console.ts";
import { EmulatorHost } from "./host.ts";
import "./index.css";

async function loadRom(name: string): Promise<Uint8Array> {
	const response = await fetch(`/roms/${name}`);
	if (!response.ok) {
		throw new Error(
			`Failed to load /roms/${name} — put the ROM images in roms.local/ ` +
				`at the repo root`,
		);
	}
	return new Uint8Array(await response.arrayBuffer());
}

async function main(): Promise<void> {
	const root = document.querySelector<HTMLElement>("#app");
	if (!root) return;

	root.textContent = "Loading ROMs…";

	// Both OS ROMs are loaded so the menu can switch machine type at runtime
	// (the 800 runs OS-B; XL/XE run the XL OS).
	let os800: Uint8Array;
	let osXl: Uint8Array;
	let basic: Uint8Array;
	try {
		[os800, osXl, basic] = await Promise.all([
			loadRom("800-b-ntsc.rom"),
			loadRom("xl-02.rom"),
			loadRom("basic-c.rom"),
		]);
	} catch (error) {
		root.textContent = String(error);
		return;
	}

	// One audio sink for the page; emulators come and go across Loads.
	const audio = await AudioOutput.create().catch(() => null);

	const host = new EmulatorHost({
		model: "800XL",
		os800,
		osXl,
		basic,
		audio,
	});
	installDevConsole(host);

	root.textContent = "";
	render(<App host={host} />, root);
}

void main();
