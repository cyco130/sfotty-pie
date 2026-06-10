import {
	FRAME_BUFFER_HEIGHT,
	FRAME_BUFFER_WIDTH,
	NTSC_PIXEL_ASPECT_RATIO,
} from "@sfotty-pie/a8";
import { Emulator } from "./emulator.ts";
import { buildNtscPalette } from "./palette.ts";

const SCALE = 2;

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

// F2/F3/F4 = START/SELECT/OPTION console keys (CONSOL bits, 0 = pressed).
function setupConsoleKeys(emulator: Emulator): void {
	const bits: Record<string, number> = { F2: 0x01, F3: 0x02, F4: 0x04 };
	const update = (event: KeyboardEvent, pressed: boolean) => {
		const bit = bits[event.key];
		if (bit === undefined) return;
		event.preventDefault();
		const ag = emulator.machine.anticGtia;
		ag.console = pressed ? ag.console & ~bit : ag.console | bit;
	};
	window.addEventListener("keydown", (event) => update(event, true));
	window.addEventListener("keyup", (event) => update(event, false));
}

async function main(): Promise<void> {
	const root = document.querySelector<HTMLElement>("#app");
	if (!root) return;

	root.textContent = "Loading ROMs…";

	const xl = new URLSearchParams(location.search).has("xl");

	let os: Uint8Array;
	let basic: Uint8Array;
	try {
		[os, basic] = await Promise.all([
			loadRom(xl ? "xl-02.rom" : "800-b-ntsc.rom"),
			loadRom("basic-c.rom"),
		]);
	} catch (error) {
		root.textContent = String(error);
		return;
	}

	const emulator = new Emulator({ model: xl ? "800XL" : "800", os, basic });

	const canvas = document.createElement("canvas");
	canvas.width = FRAME_BUFFER_WIDTH;
	canvas.height = FRAME_BUFFER_HEIGHT;
	// Display at the NTSC pixel aspect ratio so the picture is 4:3-ish.
	canvas.style.width = `${Math.round(FRAME_BUFFER_WIDTH * NTSC_PIXEL_ASPECT_RATIO * SCALE)}px`;
	canvas.style.height = `${FRAME_BUFFER_HEIGHT * SCALE}px`;
	canvas.style.imageRendering = "pixelated";
	root.replaceChildren(canvas);

	const context = canvas.getContext("2d");
	if (!context) {
		root.textContent = "Canvas 2D is not available";
		return;
	}
	const imageData = context.createImageData(
		FRAME_BUFFER_WIDTH,
		FRAME_BUFFER_HEIGHT,
	);
	const pixels = new Uint32Array(imageData.data.buffer);
	const palette = buildNtscPalette();

	// Present the latest completed frame at the display refresh rate.
	let presented = -1;
	const present = () => {
		if (emulator.frameCount !== presented) {
			presented = emulator.frameCount;
			const frame = emulator.frame;
			for (let i = 0; i < frame.length; i++) {
				pixels[i] = palette[frame[i]!]!;
			}
			context.putImageData(imageData, 0, 0);
		}
		requestAnimationFrame(present);
	};
	requestAnimationFrame(present);

	setupConsoleKeys(emulator);
	emulator.start();
}

void main();
