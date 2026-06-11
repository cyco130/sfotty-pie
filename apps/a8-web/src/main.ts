import {
	AtrImage,
	Cartridge,
	detectFileFormat,
	FRAME_BUFFER_HEIGHT,
	FRAME_BUFFER_WIDTH,
	NTSC_PIXEL_ASPECT_RATIO,
	type AtariFileFormat,
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

/** Returns a function that refocuses the offscreen keystroke input. */
function setupKeyboard(
	getEmulator: () => Emulator,
	root: HTMLElement,
): () => void {
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

	const keyboard = new Keyboard((command) =>
		commands[command]({ emulator: getEmulator() }),
	);
	keyboard.attach(input);

	// Keep the input focused so it sees every keystroke.
	input.focus();
	root.addEventListener("pointerdown", (event) => {
		// Let the toolbar take clicks (file picker buttons need real focus).
		if ((event.target as HTMLElement).closest("button")) return;
		event.preventDefault();
		input.focus();
	});
	window.addEventListener("blur", () => keyboard.releaseAll());

	return () => input.focus();
}

/** Why a detected-but-not-loadable file can't be loaded (yet). */
function unsupportedMessage(format: AtariFileFormat | null): string | null {
	switch (format) {
		case "xex":
			return "XEX binaries aren't supported yet";
		case "os-rom-10k":
		case "os-rom-16k":
			return "that looks like an OS ROM, not a cartridge or disk";
		case null:
			return "unrecognized file format";
		default:
			return null; // a cartridge or disk format
	}
}

async function main(): Promise<void> {
	const root = document.querySelector<HTMLElement>("#app");
	if (!root) return;

	root.textContent = "Loading ROMs…";

	const xl = new URLSearchParams(location.search).has("xl");
	const model = xl ? ("800XL" as const) : ("800" as const);

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

	let emulator = new Emulator({ model, os, basic });

	// Toolbar: the Load button, its hidden file picker, and a status line.
	const toolbar = document.createElement("div");
	toolbar.style.display = "flex";
	toolbar.style.gap = "8px";
	toolbar.style.alignItems = "baseline";
	toolbar.style.margin = "8px 0";

	const loadButton = document.createElement("button");
	loadButton.textContent = "Load…";

	const filePicker = document.createElement("input");
	filePicker.type = "file";
	filePicker.accept = ".rom,.bin,.raw,.car,.atr";
	filePicker.style.display = "none";

	const status = document.createElement("span");

	function setStatus(message: string, isError = false): void {
		status.textContent = message;
		status.style.color = isError ? "tomato" : "#8c8";
	}

	loadButton.addEventListener("click", () => filePicker.click());
	filePicker.addEventListener("change", () => {
		const file = filePicker.files?.[0];
		if (file) void loadFile(file);
		filePicker.value = ""; // so re-picking the same file fires again
	});

	toolbar.append(loadButton, filePicker, status);

	async function loadFile(file: File): Promise<void> {
		const contents = new Uint8Array(await file.arrayBuffer());
		const format = detectFileFormat(contents, file.name);

		const unsupported = unsupportedMessage(format);
		if (unsupported) {
			setStatus(`${file.name}: ${unsupported}`, true);
			return;
		}

		let attachment: { cartridge: Cartridge } | { disk: AtrImage };
		try {
			attachment =
				format === "atr"
					? { disk: new AtrImage(contents) }
					: { cartridge: new Cartridge(contents, file.name) };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setStatus(`${file.name}: ${message}`, true);
			return;
		}

		// Load is "boot image": a power cycle with only the loaded thing
		// attached — on the 800, the BASIC cart comes out of the slot. (On
		// the XL BASIC is built in; disabling it there is a future concern.)
		emulator.stop();
		const base = xl ? { model, os, basic } : { model, os };
		emulator = new Emulator({ ...base, ...attachment });
		emulator.start();
		setStatus(file.name);
		focusKeyboard();
	}

	const canvas = document.createElement("canvas");
	canvas.width = FRAME_BUFFER_WIDTH;
	canvas.height = FRAME_BUFFER_HEIGHT;
	// Display at the NTSC pixel aspect ratio so the picture is 4:3-ish.
	canvas.style.width = `${Math.round(FRAME_BUFFER_WIDTH * NTSC_PIXEL_ASPECT_RATIO * SCALE)}px`;
	canvas.style.height = `${FRAME_BUFFER_HEIGHT * SCALE}px`;
	canvas.style.imageRendering = "pixelated";
	root.replaceChildren(toolbar, canvas);

	// Dropping a file anywhere on the page loads it too.
	window.addEventListener("dragover", (event) => event.preventDefault());
	window.addEventListener("drop", (event) => {
		event.preventDefault();
		const file = event.dataTransfer?.files[0];
		if (file) void loadFile(file);
	});

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

	const focusKeyboard = setupKeyboard(() => emulator, root);
	emulator.start();
}

void main();
