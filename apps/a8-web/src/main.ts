import {
	FRAME_BUFFER_HEIGHT,
	FRAME_BUFFER_WIDTH,
	NTSC_PIXEL_ASPECT_RATIO,
} from "@sfotty-pie/a8";
import { commands } from "./commands.ts";
import { Emulator } from "./emulator.ts";
import { Keyboard } from "./keyboard.ts";
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

function setupKeyboard(emulator: Emulator, root: HTMLElement): void {
	// Keystrokes are captured through an offscreen input element so dead-key
	// composition works; display:none would stop the events, so it's merely
	// invisible.
	const input = document.createElement("input");
	input.type = "text";
	input.autocapitalize = "off";
	input.autocomplete = "off";
	input.spellcheck = false;
	input.style.position = "fixed";
	input.style.top = "0";
	input.style.left = "0";
	input.style.width = "1px";
	input.style.height = "1px";
	input.style.opacity = "0";
	input.style.border = "none";
	input.style.padding = "0";
	document.body.append(input);

	const keyboard = new Keyboard((command) => commands[command]({ emulator }));
	keyboard.attach(input);

	// Keep the input focused so it sees every keystroke.
	input.focus();
	root.addEventListener("pointerdown", (event) => {
		event.preventDefault();
		input.focus();
	});
	window.addEventListener("blur", () => keyboard.releaseAll());
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

	setupKeyboard(emulator, root);
	emulator.start();
}

void main();
