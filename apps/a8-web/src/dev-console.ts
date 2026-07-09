/* eslint-disable no-console -- this module's whole job is to print to the console */
import { canonicalize } from "@sfotty-pie/a8";
import { disassemble, ReadOptions } from "@sfotty-pie/sfotty";
import { setCommandTrace } from "./commands.ts";
import { PALETTE_PRESETS, type PaletteSettings } from "./display-settings.ts";
import {
	type CalibrationSample,
	type CalibrationSet,
	classify,
	deviates,
	normalize,
	type PadView,
	samplePad,
} from "./gamepad-normalize.ts";
import type { EmulatorHost } from "./host.ts";
import { idbBlobStore } from "./images/blob-store.ts";
import { deflateRaw, inflateRaw } from "./images/compress.ts";
import {
	type BlobRecord,
	openLibraryDb,
	STORE_BLOBS,
	withStore,
} from "./images/db.ts";
import { sha256Hex } from "./images/hash.ts";
import {
	addImage,
	getImage,
	getImageBytes,
	libraryEntries,
	nukeLibrary,
	readyLibrary,
	removeImage,
} from "./images/library.ts";
import { builtinLibrary } from "./library.ts";
import { builtinFirmware } from "virtual:firmware-library";

function hex(value: number, width: number): string {
	return value.toString(16).padStart(width, "0");
}

function bytesToHex(bytes: Uint8Array): string {
	return [...bytes].map((byte) => hex(byte, 2)).join("");
}

/** Read a single file the user picks - a stand-in for the upload UI. */
function pickFile(): Promise<{ name: string; bytes: Uint8Array }> {
	return new Promise((resolve, reject) => {
		const input = document.createElement("input");
		input.type = "file";
		input.onchange = () => {
			const file = input.files?.[0];
			if (!file) {
				reject(new Error("no file selected"));
				return;
			}
			file
				.arrayBuffer()
				.then((buffer) =>
					resolve({ name: file.name, bytes: new Uint8Array(buffer) }),
				)
				.catch(reject);
		};
		input.click();
	});
}

type ImageInput = File | Uint8Array | { name?: string; bytes: Uint8Array };

async function toBytes(
	input: ImageInput,
): Promise<{ name: string | undefined; bytes: Uint8Array }> {
	if (input instanceof Uint8Array) return { name: undefined, bytes: input };
	if (input instanceof File) {
		return {
			name: input.name,
			bytes: new Uint8Array(await input.arrayBuffer()),
		};
	}
	return { name: input.name, bytes: input.bytes };
}

/**
 * `window.a8.images`: a console harness for the image library before the UI
 * exists. Pick or pass a file, canonicalize it, and round-trip blobs.
 *
 *   a8.images.canonicalize(await a8.images.pick())
 *   a8.images.blobs.put("k", new Uint8Array([1,2,3]))
 */
const images = {
	pick: pickFile,
	sha256: sha256Hex,
	// The built-in firmware manifest (with precomputed canonical hash + kind).
	builtin: builtinFirmware,
	// The unified library (built-ins + user uploads) and its operations.
	//   await a8.images.library.ready()
	//   const f = await a8.images.pick(); await a8.images.library.add(f.bytes, f.name)
	//   a8.images.library.entries.value
	//   await a8.images.library.nuke()   // wipe IndexedDB and reset
	library: {
		ready: readyLibrary,
		entries: libraryEntries,
		add: addImage,
		get: getImage,
		bytes: getImageBytes,
		remove: removeImage,
		nuke: nukeLibrary,
	},
	deflate: deflateRaw,
	inflate: inflateRaw,
	blobs: idbBlobStore(),
	db: openLibraryDb,
	// Inspect a stored blob's encoding and on-disk size (to confirm store-smaller).
	async stat(ref: string) {
		const db = await openLibraryDb();
		const record = await withStore<BlobRecord | undefined>(
			db,
			STORE_BLOBS,
			"readonly",
			(store) => store.get(ref),
		);
		return record
			? { encoding: record.encoding, storedSize: record.bytes.byteLength }
			: undefined;
	},
	// Canonicalize and summarize each piece - role, kind, the source range and
	// header recipe (the built-in locator), and the canonical hash.
	async canonicalize(input: ImageInput) {
		const { name, bytes } = await toBytes(input);
		const pieces = canonicalize(bytes, name);
		return Promise.all(
			pieces.map(async (piece) => ({
				role: piece.role,
				kind: piece.kind,
				size: piece.bytes.length,
				from: piece.from,
				to: piece.to,
				header: bytesToHex(piece.header),
				hash: await sha256Hex(piece.bytes),
			})),
		);
	},
};

// --- Fake gamepad ----------------------------------------------------------

// A synthetic non-standard pad for exercising normalization and calibration
// without oddball hardware. Wraps navigator.getGamepads to expose the fake at
// slot 7, and fires plain Events with a `gamepad` expando (the connect
// listeners only read `.gamepad`, so a real GamepadEvent isn't needed).
// Deliberately scrambled layout: fire on raw button 5, directions on an
// SDL-style stepped hat at axis 3 (resting at the out-of-range 9/7 sentinel),
// and axis 2 idling at -1 like an unpressed analog trigger.

const FAKE_ID = "Fake Retro Stick (a8 dev console)";
const hatValue = (position: number) => -1 + (2 * position) / 7;
const HAT_DIRECTIONS = [
	"up",
	"upright",
	"right",
	"downright",
	"down",
	"downleft",
	"left",
	"upleft",
	"center",
] as const;

interface FakePad {
	index: number;
	id: string;
	mapping: string;
	connected: boolean;
	timestamp: number;
	buttons: { pressed: boolean; touched: boolean; value: number }[];
	axes: number[];
}

let fake: FakePad | null = null;
let getGamepadsWrapped = false;

function fakePadEvent(type: string, pad: FakePad): void {
	window.dispatchEvent(Object.assign(new Event(type), { gamepad: pad }));
}

const fakePad = {
	/** Connect the fake pad (idempotent). */
	connect(): void {
		if (!getGamepadsWrapped) {
			getGamepadsWrapped = true;
			const real = navigator.getGamepads.bind(navigator);
			navigator.getGamepads = () => {
				const out: (Gamepad | null)[] = [...real()];
				if (fake) out[fake.index] = fake as unknown as Gamepad;
				return out;
			};
		}
		if (fake) return;
		fake = {
			index: 7, // clear of the browser's real slots (0-3)
			id: FAKE_ID,
			mapping: "",
			connected: true,
			timestamp: 0,
			buttons: Array.from({ length: 8 }, () => ({
				pressed: false,
				touched: false,
				value: 0,
			})),
			axes: [0, 0, -1, hatValue(8)],
		};
		fakePadEvent("gamepadconnected", fake);
		console.log(
			"fake pad connected - fire: a8.fakePad.press(5) / release(5); " +
				"directions: a8.fakePad.hat('up' | 'upright' | ... | 'center')",
		);
	},
	disconnect(): void {
		if (!fake) return;
		const pad = fake;
		fake = null;
		fakePadEvent("gamepaddisconnected", pad);
	},
	press(button: number): void {
		const b = fake?.buttons[button];
		if (b) Object.assign(b, { pressed: true, touched: true, value: 1 });
	},
	release(button: number): void {
		const b = fake?.buttons[button];
		if (b) Object.assign(b, { pressed: false, touched: false, value: 0 });
	},
	axis(index: number, value: number): void {
		if (fake && index < fake.axes.length) fake.axes[index] = value;
	},
	/** Point the hat: a direction name or "center". */
	hat(direction: (typeof HAT_DIRECTIONS)[number]): void {
		const position = HAT_DIRECTIONS.indexOf(direction);
		if (fake && position >= 0) fake.axes[3] = hatValue(position);
	},
};

// --- Console-driven pad calibration -----------------------------------------

// The wizard-to-be, driven by console prompts: sample rest, then wait for a
// firm sustained change per prompted step, classify, apply. Works on any
// connected pad - a profile on a standard pad simply overrides its native
// layout (a8.uncalibrate() restores it).

const CALIBRATION_STEPS = ["up", "down", "left", "right", "trigger"] as const;

const frame = () =>
	new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function calibratePad(host: EmulatorHost, index?: number): Promise<void> {
	const padNow = (): Gamepad | undefined => {
		const pads = navigator.getGamepads();
		const p = index === undefined ? pads.find((x) => x) : pads[index];
		return p ?? undefined;
	};
	const first = padNow();
	if (!first) {
		console.log("no connected pad (press a button on it first)");
		return;
	}
	const id = first.id;
	const at = first.index;

	console.log(`calibrating "${id}" - leave it alone...`);
	for (let i = 0; i < 45; i++) await frame(); // let it settle
	const rest = samplePad(padNow()!);
	const samples: CalibrationSet = { rest };

	for (const step of CALIBRATION_STEPS) {
		console.log(
			step === "trigger"
				? "press FIRE and hold"
				: `push ${step.toUpperCase()} and hold`,
		);
		let sample: CalibrationSample;
		for (;;) {
			await frame();
			const pad = navigator.getGamepads()[at];
			if (!pad) continue;
			if (!deviates(rest, samplePad(pad))) continue;
			// Confirm it's a hold, not a transient, then take the real sample.
			for (let i = 0; i < 10; i++) await frame();
			const held = navigator.getGamepads()[at];
			if (!held) continue;
			const confirm = samplePad(held);
			if (deviates(rest, confirm)) {
				sample = confirm;
				break;
			}
		}
		samples[step] = sample;
		console.log("  captured - release");
		for (;;) {
			await frame();
			const pad = navigator.getGamepads()[at];
			if (pad && !deviates(rest, samplePad(pad))) break;
		}
	}

	const profile = classify(samples);
	host.setGamepadProfile(id, profile);
	console.log("profile applied (a8.uncalibrate() to remove):", profile);
}

/**
 * Install `window.a8`: a poor-man's monitor for the browser console - live
 * machine/cpu access, peek/poke, a disassembler, and the CPU/command traces.
 *
 *   a8.trace.cpu(true); ...reproduce...; a8.trace.dump(300)
 *   a8.peek(0x0244)        a8.disasm(a8.cpu.PC)
 */
export function installDevConsole(host: EmulatorHost): void {
	const peek = (address: number) =>
		host.emulator.machine.read(address & 0xffff, ReadOptions.PEEK);

	const a8 = {
		get emulator() {
			return host.emulator;
		},
		get machine() {
			return host.emulator.machine;
		},
		get cpu() {
			return host.emulator.cpu;
		},
		peek,
		poke: (address: number, value: number) =>
			host.emulator.machine.write(
				address & 0xffff,
				value & 0xff,
				ReadOptions.NONE,
			),
		disasm: (address: number, count = 16) => {
			let pc = address & 0xffff;
			const lines: string[] = [];
			for (let i = 0; i < count; i++) {
				const { text, length } = disassemble(peek, pc);
				lines.push(`${hex(pc, 4)}  ${text}`);
				pc = (pc + length) & 0xffff;
			}
			console.log(lines.join("\n"));
		},
		// The built-in image library (merged committed + local folders).
		get library() {
			return builtinLibrary;
		},
		// The image-library harness (uploads/canonicalization/blob store).
		images,
		trace: {
			cpu: (enabled: boolean) => host.setCpuTrace(enabled),
			commands: (enabled: boolean) => setCommandTrace(enabled),
			clear: () => host.clearCpuTrace(),
			// No count -> the whole capture (after a reset, the captured boot).
			dump: (count?: number) =>
				console.log(host.dumpCpuTrace(count).join("\n")),
		},
		// The synthetic non-standard pad (see the fake-gamepad section above),
		// plus a canned calibration: the same samples the wizard will collect
		// by prompting, run through the real classifier and applied live.
		fakePad: {
			...fakePad,
			calibrate: () => {
				const rest = {
					buttons: Array.from({ length: 8 }, () => false),
					axes: [0, 0, -1, hatValue(8)],
				};
				const hat = (p: number) => ({
					...rest,
					axes: [0, 0, -1, hatValue(p)],
				});
				host.setGamepadProfile(
					FAKE_ID,
					classify({
						rest,
						up: hat(0),
						right: hat(2),
						down: hat(4),
						left: hat(6),
						trigger: { ...rest, buttons: rest.buttons.map((_, i) => i === 5) },
					}),
				);
				console.log(
					"fake pad calibrated - the hat drives the D-pad, button 5 is fire " +
						"(a8.fakePad.decalibrate() to undo)",
				);
			},
			decalibrate: () => host.setGamepadProfile(FAKE_ID, null),
		},
		// Ground truth for "is my mapping applied": the raw pad next to its
		// normalized view, exactly as the poller computes it.
		padView: (index?: number) => {
			const pads = navigator.getGamepads();
			const pad = index === undefined ? pads.find((x) => x) : pads[index];
			if (!pad) return undefined;
			const profile = host.gamepadNormalize.peek()[pad.id];
			const dump = (v: PadView) => ({
				pressed: v.buttons.flatMap((b, i) => (b.pressed ? [i] : [])),
				axes: v.axes.map((a) => Number(a.toFixed(2))),
			});
			return {
				id: pad.id,
				profiled: !!profile,
				raw: dump(pad),
				view: dump(normalize(pad, profile)),
			};
		},
		// Adjust the running standard's overscan crop (persisted; sanitized to
		// 320-376 x 192-240, even). No args just reports the current setting.
		overscan: (width?: number, height?: number) => {
			const tv = host.config.peek().tv;
			if (width !== undefined && height !== undefined) {
				host.setOverscan(tv, { width, height });
			}
			return { tv, ...host.displaySettings.peek()[tv].overscan };
		},
		// Adjust the running standard's palette generation parameters
		// (persisted; partial merge), or apply a named preset:
		//   a8.palette({ hueStep: 19 })    a8.palette("blueGr0")
		// No args just reports the current values.
		palette: (params?: Partial<PaletteSettings> | string) => {
			const tv = host.config.peek().tv;
			if (typeof params === "string") {
				const preset = PALETTE_PRESETS[tv][params];
				if (preset) host.setPalette(tv, preset);
				else {
					console.log(
						`no "${params}" preset for ${tv}; available:`,
						Object.keys(PALETTE_PRESETS[tv]),
					);
				}
			} else if (params) {
				host.setPalette(tv, params);
			}
			return { tv, ...host.displaySettings.peek()[tv].palette };
		},
		// The running standard's frame blending (0-0.9, persisted).
		frameBlending: (value?: number) => {
			const tv = host.config.peek().tv;
			if (value !== undefined) host.setFrameBlending(tv, value);
			return {
				tv,
				frameBlending: host.displaySettings.peek()[tv].frameBlending,
			};
		},
		// Prompt-driven calibration of a real pad (defaults to the first
		// connected one); works on standard pads too, as a layout override.
		calibrate: (index?: number) => void calibratePad(host, index),
		uncalibrate: (index?: number) => {
			const pads = navigator.getGamepads();
			const pad = index === undefined ? pads.find((x) => x) : pads[index];
			if (pad) host.setGamepadProfile(pad.id, null);
		},
	};

	Object.assign(window, { a8 });
	console.log("Dev console ready: window.a8 (try a8.trace.cpu(true))");
}
