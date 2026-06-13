import {
	AtrImage,
	buildBootDisk,
	Cartridge,
	detectFileFormat,
	FRAME_BUFFER_HEIGHT,
	FRAME_BUFFER_WIDTH,
	NTSC_PIXEL_ASPECT_RATIO,
	PAL_PIXEL_ASPECT_RATIO,
	type AtariFileFormat,
	type AtariModel,
} from "@sfotty-pie/a8";
import { computed, signal } from "@preact/signals";
import type { AudioOutput } from "./audio.ts";
import { commands, type Command } from "./commands.ts";
import { Emulator } from "./emulator.ts";
import { Keyboard } from "./keyboard.ts";
import { buildNtscPalette, buildPalPalette } from "./palette.ts";

export interface HostConfig {
	model: AtariModel;
	/** The 800's OS-B ROM (10K). */
	os800: Uint8Array;
	/** The XL/XE OS ROM (16K), shared by 800XL and 130XE. */
	osXl: Uint8Array;
	basic: Uint8Array;
	audio: AudioOutput | null;
}

/**
 * The audio indicator's state: no Web Audio at all, suspended (awaiting the
 * first user gesture), playing, or muted at the output.
 */
export type AudioState = "unavailable" | "suspended" | "on" | "muted";

/** The user-facing machine configuration the menu edits. */
export interface MachineSettings {
	model: AtariModel;
	tv: "ntsc" | "pal";
	/** On the 800: no BASIC cart. On XL/XE: hold OPTION at boot (step 5). */
	basicDisabled: boolean;
}

function settingsEqual(a: MachineSettings, b: MachineSettings): boolean {
	return (
		a.model === b.model && a.tv === b.tv && a.basicDisabled === b.basicDisabled
	);
}

/** Why a detected-but-not-loadable file can't be loaded (yet). */
function unsupportedMessage(format: AtariFileFormat | null): string | null {
	switch (format) {
		case "os-rom-10k":
		case "os-rom-16k":
			return "that looks like an OS ROM, not something loadable";
		case null:
			return "unrecognized file format";
		default:
			return null; // a cartridge, disk, or executable
	}
}

/**
 * Owns the emulator's imperative lifetime — the live {@link Emulator}
 * instance (swapped on Load), the real-time present loop, audio, and the
 * keyboard — so the Preact chrome stays a thin view. Reactive UI state is
 * exposed as signals; the canvas and keystroke loops are wired up via the
 * `attach*` methods (called from the component's mount effect) and never
 * touch Preact's render path.
 */
export class EmulatorHost {
	/** The last successfully booted image's name (null = nothing loaded). */
	readonly imageName = signal<string | null>(null);

	/** True once the CPU has jammed (CIM). */
	readonly crashed = signal(false);

	/** A transient error alert (e.g. an unrecognized file); null = none. */
	readonly alert = signal<string | null>(null);

	/** The running machine configuration (drives the config indicator). */
	readonly config = signal<MachineSettings>({
		model: "800",
		tv: "ntsc",
		basicDisabled: false,
	});

	/** The menu's working copy — applied (with a reboot) on demand. */
	readonly staged = signal<MachineSettings>(this.config.peek());

	/** True while the staged config differs from the running machine. */
	readonly dirty = computed(
		() => !settingsEqual(this.staged.value, this.config.value),
	);

	/** Whether emulation is running (vs. paused). */
	readonly running = signal(true);

	/** The audio indicator state. */
	readonly audio = signal<AudioState>("unavailable");

	/** The measured emulated frame rate, sampled about once a second. */
	readonly fps = signal(0);

	/** Whether the menu sidebar is open. */
	readonly menuOpen = signal(false);

	readonly #os800: Uint8Array;
	readonly #osXl: Uint8Array;
	readonly #basic: Uint8Array;
	readonly #audio: AudioOutput | null;
	readonly #keyboard: Keyboard;

	#emulator: Emulator;
	#keyInput: HTMLInputElement | null = null;
	#bootImagePicker: (() => void) | null = null;
	#cpuTrace = false; // persists across reboots; reapplied to each emulator
	// The currently mounted image (kept across reboots; replaced by a Load).
	#attachment: { cartridge: Cartridge } | { disk: AtrImage } | null = null;

	constructor({ model, os800, osXl, basic, audio }: HostConfig) {
		this.#os800 = os800;
		this.#osXl = osXl;
		this.#basic = basic;
		this.#audio = audio;
		this.config.value = { model, tv: "ntsc", basicDisabled: false };
		this.staged.value = this.config.peek();

		this.#emulator = this.#makeEmulator();
		this.#keyboard = new Keyboard((command) => this.dispatch(command));

		// The audio context resumes/suspends asynchronously; track it.
		if (audio) {
			audio.context.addEventListener("statechange", () =>
				this.#refreshAudioState(),
			);
			this.#refreshAudioState();
		}
	}

	/** Run a bound command (from a key binding, the UI, or the palette). */
	dispatch(command: Command): void {
		commands[command]({ emulator: this.#emulator, host: this });
	}

	// Build an emulator for the running config + the mounted image. On the
	// 800 the BASIC cart shares the slot, so it's present only when not
	// disabled and no cartridge is mounted. The XL/XE always wire BASIC in
	// (its "disable" is the OPTION-hold at boot).
	#makeEmulator(): Emulator {
		const { model, tv, basicDisabled } = this.config.value;
		const xl = model !== "800";
		const cartMounted =
			this.#attachment !== null && "cartridge" in this.#attachment;
		const includeBasic = xl || (!basicDisabled && !cartMounted);
		const emulator = new Emulator({
			model,
			os: xl ? this.#osXl : this.#os800,
			tvSystem: tv,
			...(includeBasic && { basic: this.#basic }),
			...(xl && basicDisabled && { holdOption: true }),
			...this.#attachment,
			...(this.#audio && { audio: this.#audio }),
		});
		emulator.setTrace(this.#cpuTrace);
		return emulator;
	}

	/** The live emulator (swaps on reboot) — for the dev console. */
	get emulator(): Emulator {
		return this.#emulator;
	}

	/** Toggle the CPU instruction trace (persists across reboots). */
	setCpuTrace(enabled: boolean): void {
		this.#cpuTrace = enabled;
		this.#emulator.setTrace(enabled);
	}

	dumpCpuTrace(count?: number): string[] {
		return this.#emulator.dumpTrace(count);
	}

	clearCpuTrace(): void {
		this.#emulator.clearTrace();
	}

	// Swap in a fresh emulator for the current config + attachment.
	#rebuild(): void {
		this.#emulator.stop();
		this.#audio?.clear();
		this.#emulator = this.#makeEmulator();
		this.#emulator.start();
		this.running.value = true;
		this.#keyInput?.focus();
	}

	start(): void {
		this.#emulator.start();
		this.running.value = true;
	}

	// --- Command targets ---------------------------------------------------

	pause(): void {
		this.#emulator.stop();
		this.running.value = false;
	}

	resume(): void {
		this.#emulator.start();
		this.running.value = true;
	}

	togglePause(): void {
		if (this.running.value) this.pause();
		else this.resume();
	}

	setMuted(muted: boolean): void {
		if (!this.#audio) return;
		this.#audio.muted = muted;
		this.#refreshAudioState();
	}

	/**
	 * The audio indicator's click action: enable audio if it's still
	 * suspended (any gesture resumes the context), otherwise flip mute.
	 */
	toggleAudio(): void {
		const audio = this.#audio;
		if (!audio) return;
		if (!audio.running) {
			audio.resume();
			return; // the statechange listener updates the indicator
		}
		this.setMuted(!audio.muted);
	}

	/** The App registers how to open the file picker (it owns the input). */
	registerBootImagePicker(open: () => void): void {
		this.#bootImagePicker = open;
	}

	pickBootImage(): void {
		this.#bootImagePicker?.();
	}

	dismissAlert(): void {
		this.alert.value = null;
	}

	openMenu(): void {
		this.staged.value = this.config.peek(); // start from the running config
		this.menuOpen.value = true;
	}

	closeMenu(): void {
		this.menuOpen.value = false;
		this.#keyInput?.focus(); // return keystrokes to the emulator
	}

	toggleMenu(): void {
		if (this.menuOpen.value) this.closeMenu();
		else this.openMenu();
	}

	// Machine configuration: the menu stages changes, then applies them with
	// a single reboot.
	stageModel(model: AtariModel): void {
		this.staged.value = { ...this.staged.value, model };
	}

	stageTv(tv: "ntsc" | "pal"): void {
		this.staged.value = { ...this.staged.value, tv };
	}

	stageBasicDisabled(basicDisabled: boolean): void {
		this.staged.value = { ...this.staged.value, basicDisabled };
	}

	/** Apply the staged config: adopt it and power-cycle into it. */
	applyConfig(): void {
		if (!this.dirty.value) return;
		this.config.value = this.staged.value;
		this.#rebuild();
	}

	/** Discard staged edits, snapping back to the running config. */
	revertConfig(): void {
		this.staged.value = this.config.peek();
	}

	#refreshAudioState(): void {
		const audio = this.#audio;
		if (!audio) {
			this.audio.value = "unavailable";
		} else if (!audio.running) {
			this.audio.value = "suspended";
		} else {
			this.audio.value = audio.muted ? "muted" : "on";
		}
	}

	async loadFile(file: File): Promise<void> {
		const contents = new Uint8Array(await file.arrayBuffer());
		const format = detectFileFormat(contents, file.name);

		// An unrecognized/unloadable file changes nothing — just alert.
		const unsupported = unsupportedMessage(format);
		if (unsupported) {
			this.alert.value = `${file.name}: ${unsupported}`;
			return;
		}

		let attachment: { cartridge: Cartridge } | { disk: AtrImage };
		try {
			attachment =
				format === "atr"
					? { disk: new AtrImage(contents) }
					: format === "xex"
						? // XEX files boot from a generated in-memory disk whose
							// boot sectors are the XEX loader.
							{ disk: buildBootDisk(contents) }
						: { cartridge: new Cartridge(contents, file.name) };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.alert.value = `${file.name}: ${message}`;
			return;
		}

		// A valid image: mount it and power-cycle. The 800's BASIC cart comes
		// out for a game cartridge (handled by #makeEmulator).
		this.menuOpen.value = false; // get out of the way
		this.#attachment = attachment;
		this.imageName.value = file.name;
		this.#rebuild();
	}

	/**
	 * Drive the canvas: present the latest completed frame at the display
	 * refresh rate, and keep it sized to the largest pixel-aspect-correct
	 * rectangle that fits its parent (the rest is black letterbox). Returns
	 * a teardown function.
	 */
	attachScreen(canvas: HTMLCanvasElement): () => void {
		const context = canvas.getContext("2d");
		const stage = canvas.parentElement;
		if (!context || !stage) return () => {};

		// Fit the canvas into its parent, preserving the display aspect — which
		// depends on the TV standard's pixel aspect ratio, so re-fit when the
		// config changes too (the stage size may not).
		const fit = () => {
			const par =
				this.config.value.tv === "pal"
					? PAL_PIXEL_ASPECT_RATIO
					: NTSC_PIXEL_ASPECT_RATIO;
			const displayAspect = (FRAME_BUFFER_WIDTH * par) / FRAME_BUFFER_HEIGHT;
			const boxWidth = stage.clientWidth;
			const boxHeight = stage.clientHeight;
			let width = boxWidth;
			let height = width / displayAspect;
			if (height > boxHeight) {
				height = boxHeight;
				width = height * displayAspect;
			}
			canvas.style.width = `${Math.round(width)}px`;
			canvas.style.height = `${Math.round(height)}px`;
		};
		const resize = new ResizeObserver(fit);
		resize.observe(stage);

		const imageData = context.createImageData(
			FRAME_BUFFER_WIDTH,
			FRAME_BUFFER_HEIGHT,
		);
		const pixels = new Uint32Array(imageData.data.buffer);

		// Both the fit (pixel aspect) and the palette follow the TV standard,
		// so refresh them whenever the config changes (the stage may not).
		let palette = buildNtscPalette();
		const unsubscribe = this.config.subscribe(() => {
			fit();
			palette =
				this.config.value.tv === "pal" ? buildPalPalette() : buildNtscPalette();
		});

		let raf = 0;
		let presented = -1;
		let framesThisSecond = 0;
		let secondStart = performance.now();
		const present = () => {
			if (this.#emulator.frameCount !== presented) {
				presented = this.#emulator.frameCount;
				framesThisSecond++;
				const frame = this.#emulator.frame;
				for (let i = 0; i < frame.length; i++) {
					pixels[i] = palette[frame[i]!]!;
				}
				context.putImageData(imageData, 0, 0);
			}
			this.crashed.value = this.#emulator.crashed; // dedup'd by the signal
			// Sample the emulated frame rate about once a second.
			const now = performance.now();
			const elapsed = now - secondStart;
			if (elapsed >= 1000) {
				this.fps.value = Math.round((framesThisSecond * 1000) / elapsed);
				framesThisSecond = 0;
				secondStart = now;
			}
			raf = requestAnimationFrame(present);
		};
		raf = requestAnimationFrame(present);
		return () => {
			cancelAnimationFrame(raf);
			resize.disconnect();
			unsubscribe();
		};
	}

	/**
	 * Wire keystrokes through the offscreen input (so dead-key composition
	 * works) and keep it focused. Returns a teardown function.
	 */
	attachKeyboard(input: HTMLInputElement, root: HTMLElement): () => void {
		this.#keyInput = input;
		this.#keyboard.attach(input);
		input.focus();

		const refocus = (event: PointerEvent) => {
			// Let toolbar buttons take their own clicks.
			if ((event.target as HTMLElement).closest("button")) return;
			event.preventDefault();
			input.focus();
		};
		const releaseAll = () => this.#keyboard.releaseAll();
		root.addEventListener("pointerdown", refocus);
		window.addEventListener("blur", releaseAll);
		return () => {
			root.removeEventListener("pointerdown", refocus);
			window.removeEventListener("blur", releaseAll);
		};
	}

	/**
	 * Resume the audio context on the first user gesture anywhere. iOS Safari
	 * only unlocks audio on a *completed* gesture (pointerup/touchend/click),
	 * not pointerdown — so listen on pointerup and keydown.
	 */
	enableAudioResume(): () => void {
		const audio = this.#audio;
		if (!audio) return () => {};
		const resume = () => audio.resume();
		window.addEventListener("pointerup", resume);
		window.addEventListener("keydown", resume);
		return () => {
			window.removeEventListener("pointerup", resume);
			window.removeEventListener("keydown", resume);
		};
	}
}
