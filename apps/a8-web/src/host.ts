import {
	AtrImage,
	buildBootDisk,
	buildNtscPalette,
	buildPalPalette,
	Cartridge,
	detectFileFormat,
	FRAME_BUFFER_HEIGHT,
	FRAME_BUFFER_WIDTH,
	NTSC_PIXEL_ASPECT_RATIO,
	PAL_PIXEL_ASPECT_RATIO,
	preferredBasicKeys,
	preferredOsKeys,
	type AtariFileFormat,
	type AtariModel,
	type FirmwareKey,
} from "@sfotty-pie/a8";
import { computed, signal } from "@preact/signals";
import type { AudioOutput } from "./audio.ts";
import { commands, type Command } from "./commands.ts";
import { Emulator } from "./emulator.ts";
import { Keyboard } from "./keyboard.ts";
import {
	loadLibraryEntry,
	type LibraryEntry,
	type LoadedFirmware,
} from "./library.ts";

export interface HostConfig {
	model: AtariModel;
	/** The identified firmware library; the host ranks/picks OS + BASIC. */
	firmware: LoadedFirmware[];
	audio: AudioOutput | null;
	/** Why audio is unavailable, if it failed to initialize (shown on tap). */
	audioError?: string | null;
}

/**
 * The audio indicator's state: no Web Audio at all, suspended (awaiting the
 * first user gesture), playing, or muted at the output.
 */
export type AudioState = "unavailable" | "suspended" | "on" | "muted";

/**
 * The sidebar's content when open. Stable string ids so the state stays
 * serializable (a future deep-link layer can map these straight to the URL).
 */
export type SidebarPanel = "menu" | "palette";

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
	/**
	 * What's attached, for the status bar: the cartridge-slot label (a cart
	 * name, or "BASIC" when it occupies the 400/800 cart slot, or null) and a
	 * per-drive disk name (index 0 = D1:; null = empty).
	 */
	readonly attachments = signal<{
		cartridge: string | null;
		drives: (string | null)[];
	}>({ cartridge: null, drives: [null] });

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

	/** Whether turbo mode (unthrottled, muted) is engaged. */
	readonly turboMode = signal(false);

	/**
	 * Which sidebar panel is showing, or null when closed. The sidebar is a
	 * single docked surface that hosts the menu, the command palette, and (in
	 * future) other dialogs — one at a time, always pushing the screen aside
	 * rather than covering it.
	 */
	readonly sidebar = signal<SidebarPanel | null>(null);

	// Identified firmware, indexed by key for ranked selection.
	readonly #firmware: Map<FirmwareKey, LoadedFirmware>;
	readonly #audio: AudioOutput | null;
	readonly #audioError: string | null;
	readonly #keyboard: Keyboard;

	#emulator: Emulator;
	#keyInput: HTMLInputElement | null = null;
	#bootImagePicker: (() => void) | null = null;
	// What to do with the next file the shared picker yields (boot vs. attach).
	#pendingPick: (file: File) => void = (file) => void this.loadFile(file);
	#cpuTrace = false; // persists across reboots; reapplied to each emulator
	#turboMode = false; // persists across reboots; reapplied to each emulator
	// What's mounted, kept across reboots and re-applied by #makeEmulator. The
	// cartridge slot and the disk drives are independent (a cart and a disk can
	// coexist); #drives is indexed by drive number (0 = D1:), one slot for now.
	#cartridge: { cart: Cartridge; name: string } | null = null;
	#drives: ({ disk: AtrImage; name: string } | null)[] = [null];

	constructor({ model, firmware, audio, audioError }: HostConfig) {
		// Later firmware of the same key wins; the library is already merged
		// (local over committed), so order is preserved here.
		this.#firmware = new Map(firmware.map((f) => [f.key, f]));
		this.#audio = audio;
		this.#audioError = audioError ?? null;
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

		// Keep the status-bar attachment labels in sync with the config — the
		// 400/800 BASIC slot depends on the model and whether BASIC is enabled.
		// (Runs immediately, seeding the initial labels.)
		this.config.subscribe(() => this.#refreshAttachments());
	}

	// Recompute the status-bar attachment labels from the mounted slots and the
	// running config. On the 400/800 an enabled BASIC occupies the cartridge
	// slot (when no cart is mounted) and shows there like any cartridge; on
	// XL/XE BASIC is internal and isn't shown.
	#refreshAttachments(): void {
		const { model, basicDisabled } = this.config.value;
		const basicInSlot = model === "800" && !basicDisabled;
		this.attachments.value = {
			cartridge: this.#cartridge?.name ?? (basicInSlot ? "BASIC" : null),
			drives: this.#drives.map((drive) => drive?.name ?? null),
		};
	}

	/** Run a bound command (from a key binding, the UI, or the palette). */
	dispatch(command: Command): void {
		commands[command].run({ emulator: this.#emulator, host: this });
	}

	/**
	 * Set joystick 0 to an absolute direction — for the analog OSD stick,
	 * which (unlike the keyboard's per-direction press/release) reports a
	 * whole position at once. `mask` bits: 1 = up, 2 = down, 4 = left,
	 * 8 = right; 0 = centred. Release-then-press is atomic between frames.
	 */
	setJoystickDirection(mask: number): void {
		const machine = this.#emulator.machine;
		machine.joystickUp(0, 0x0f & ~mask);
		machine.joystickDown(0, mask);
	}

	// The best-ranked firmware present in the library for a list of keys.
	#pick(keys: readonly FirmwareKey[]): LoadedFirmware | null {
		for (const key of keys) {
			const firmware = this.#firmware.get(key);
			if (firmware) return firmware;
		}
		return null;
	}

	// Build an emulator for the running config + the mounted image. The OS and
	// BASIC ROMs are picked from the library by the model's preference ranking.
	// On the 800 the BASIC cart shares the slot, so it's present only when not
	// disabled and no cartridge is mounted. The XL/XE always wire BASIC in (its
	// "disable" is the OPTION-hold at boot).
	#makeEmulator(): Emulator {
		const { model, tv, basicDisabled } = this.config.value;
		const xl = model !== "800";
		const cartMounted = this.#cartridge !== null;
		const includeBasic = xl || (!basicDisabled && !cartMounted);

		const os = this.#pick(preferredOsKeys({ model, tv }));
		if (!os) {
			throw new Error(
				`No compatible OS ROM in the library for ${model} (${tv.toUpperCase()}).`,
			);
		}
		const basic = includeBasic ? this.#pick(preferredBasicKeys()) : null;

		// eslint-disable-next-line no-console -- shows which ROMs the ranking picked
		console.log(
			`Firmware for ${model} ${tv.toUpperCase()}: OS "${os.name}"` +
				(basic ? `, BASIC "${basic.name}"` : ", no BASIC"),
		);

		const emulator = new Emulator({
			model,
			os: os.bytes,
			tvSystem: tv,
			...(basic && { basic: basic.bytes }),
			...(xl && basicDisabled && { holdOption: true }),
			...(this.#cartridge && { cartridge: this.#cartridge.cart }),
			...(this.#drives[0] && { disk: this.#drives[0].disk }),
			...(this.#audio && { audio: this.#audio }),
		});
		emulator.setTrace(this.#cpuTrace);
		emulator.setTurboMode(this.#turboMode);
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

	setTurboMode(enabled: boolean): void {
		this.#turboMode = enabled;
		this.#emulator.setTurboMode(enabled);
		this.turboMode.value = enabled;
	}

	toggleTurboMode(): void {
		this.setTurboMode(!this.turboMode.value);
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
		if (!audio) {
			// No audio sink — surface why (it's the only feedback the user gets).
			this.alert.value = this.#audioError
				? `Audio unavailable: ${this.#audioError}`
				: "Audio is unavailable in this browser.";
			return;
		}
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
		this.#pendingPick = (file) => void this.loadFile(file);
		this.#bootImagePicker?.();
	}

	/** Open the file picker to attach a disk to D1: (no reboot). */
	pickAttachDisk(): void {
		this.#pendingPick = (file) => void this.attachDiskFile(file);
		this.#bootImagePicker?.();
	}

	/** The shared picker's callback: route the chosen file per the last pick. */
	handlePickedFile(file: File): void {
		this.#pendingPick(file);
	}

	dismissAlert(): void {
		this.alert.value = null;
	}

	/** Show a sidebar panel (switching directly if another is already open). */
	showPanel(panel: SidebarPanel): void {
		if (panel === "menu") this.staged.value = this.config.peek(); // from running config
		this.sidebar.value = panel;
	}

	closePanel(): void {
		this.sidebar.value = null;
		this.#keyInput?.focus(); // return keystrokes to the emulator
	}

	/** A panel's trigger: open it, or close it if it's already the one showing. */
	togglePanel(panel: SidebarPanel): void {
		if (this.sidebar.value === panel) this.closePanel();
		else this.showPanel(panel);
	}

	// Machine configuration. The menu's form stages changes (below) and applies
	// them with a single reboot; the palette's config commands apply one change
	// and reboot immediately (apply*, below that).
	stageModel(model: AtariModel): void {
		this.staged.value = { ...this.staged.value, model };
	}

	stageTv(tv: "ntsc" | "pal"): void {
		this.staged.value = { ...this.staged.value, tv };
	}

	stageBasicDisabled(basicDisabled: boolean): void {
		this.staged.value = { ...this.staged.value, basicDisabled };
	}

	/** Apply the staged config: adopt it, power-cycle into it, close the menu. */
	applyConfig(): void {
		if (!this.dirty.value) return;
		this.config.value = this.staged.value;
		this.#rebuild();
		this.closePanel();
	}

	// Apply a single config change to the running machine and reboot into it —
	// the palette's "… (reboots)" commands. A no-op change is ignored so it
	// doesn't cost a pointless cold boot. The staged copy follows so the menu
	// opens clean.
	#applyConfigChange(change: Partial<MachineSettings>): void {
		const next = { ...this.config.value, ...change };
		if (settingsEqual(next, this.config.value)) return;
		this.config.value = next;
		this.staged.value = next;
		this.#rebuild();
	}

	applyModel(model: AtariModel): void {
		this.#applyConfigChange({ model });
	}

	applyTv(tv: "ntsc" | "pal"): void {
		this.#applyConfigChange({ tv });
	}

	toggleTv(): void {
		this.applyTv(this.config.value.tv === "ntsc" ? "pal" : "ntsc");
	}

	applyBasicDisabled(basicDisabled: boolean): void {
		this.#applyConfigChange({ basicDisabled });
	}

	toggleBasic(): void {
		this.applyBasicDisabled(!this.config.value.basicDisabled);
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

	/** Boot a user-supplied file (the "Boot image…" picker / drag-and-drop). */
	async loadFile(file: File): Promise<void> {
		this.#bootImage(new Uint8Array(await file.arrayBuffer()), file.name);
	}

	/** Boot a software item from the built-in library. */
	async bootLibraryEntry(entry: LibraryEntry): Promise<void> {
		this.#bootImage(await loadLibraryEntry(entry), entry.fileName);
	}

	// Mount an image (disk/cartridge/executable) and power-cycle into it.
	// Booting an image always disables BASIC so it can't intercept the boot; on
	// the 800 the BASIC cart also comes out for a game cartridge anyway (handled
	// by #makeEmulator).
	#bootImage(contents: Uint8Array, name: string): void {
		const format = detectFileFormat(contents, name);

		// An unrecognized/unloadable file changes nothing — just alert.
		const unsupported = unsupportedMessage(format);
		if (unsupported) {
			this.alert.value = `${name}: ${unsupported}`;
			return;
		}

		// Boot image starts fresh: fill the one slot it boots from and clear the
		// rest. (Attach, below, instead adds to the running machine in place.)
		let cartridge: { cart: Cartridge; name: string } | null = null;
		let disk: { disk: AtrImage; name: string } | null = null;
		try {
			if (format === "atr") {
				disk = { disk: new AtrImage(contents), name };
			} else if (format === "xex") {
				// XEX boots from a generated in-memory disk (its loader).
				disk = { disk: buildBootDisk(contents), name };
			} else {
				cartridge = { cart: new Cartridge(contents, name), name };
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.alert.value = `${name}: ${message}`;
			return;
		}

		this.sidebar.value = null; // get out of the way
		this.#cartridge = cartridge;
		this.#drives = [disk];
		this.config.value = { ...this.config.value, basicDisabled: true };
		this.#refreshAttachments();
		this.#rebuild();
	}

	/**
	 * Save the disk mounted in D1: as an `.atr`, including any sectors the
	 * running machine has written this session (writes live only in memory, so
	 * this is how you keep them). Writable disks only — the synthetic XEX boot
	 * disk is write-protected and isn't a real disk worth saving.
	 */
	downloadDisk(): void {
		const drive = this.#drives[0];
		if (!drive || drive.disk.writeProtected) {
			this.alert.value = "No writable disk in D1: to download.";
			return;
		}

		// Copy into a fresh ArrayBuffer-backed view: a snapshot the Blob owns,
		// decoupled from later writes to the live image.
		const blob = new Blob([new Uint8Array(drive.disk.toBytes())], {
			type: "application/octet-stream",
		});
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = drive.name;
		anchor.click();
		URL.revokeObjectURL(url);
	}

	/**
	 * Attach an ATR to D1: of the running machine — live, no reboot, BASIC
	 * untouched (unlike Boot image, which power-cycles into the image). The
	 * disk also becomes D1: for the next cold start and is what Download D1:
	 * saves.
	 */
	async attachDiskFile(file: File): Promise<void> {
		const contents = new Uint8Array(await file.arrayBuffer());
		let disk: AtrImage;
		try {
			disk = new AtrImage(contents);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.alert.value = `${file.name}: ${message}`;
			return;
		}

		this.#drives[0] = { disk, name: file.name };
		this.#emulator.machine.insertDisk(disk);
		this.sidebar.value = null; // get out of the way
		this.#refreshAttachments();
	}

	/** Detach the disk from D1: of the running machine (live, no reboot). */
	detachDisk(): void {
		if (!this.#drives[0]) {
			this.alert.value = "No disk in D1: to detach.";
			return;
		}
		this.#drives[0] = null;
		this.#emulator.machine.ejectDisk();
		this.#refreshAttachments();
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
		let framesAtSecondStart = this.#emulator.frameCount;
		let secondStart = performance.now();
		const present = () => {
			if (this.#emulator.frameCount !== presented) {
				presented = this.#emulator.frameCount;
				const frame = this.#emulator.frame;
				for (let i = 0; i < frame.length; i++) {
					pixels[i] = palette[frame[i]!]!;
				}
				context.putImageData(imageData, 0, 0);
			}
			this.crashed.value = this.#emulator.crashed; // dedup'd by the signal
			// Sample the emulated frame rate about once a second. Measure the
			// emulator's own frameCount delta over the elapsed wall clock, not
			// how many distinct frames this RAF loop happened to observe — RAF
			// coalesces under main-thread load and would undercount frames the
			// emulator actually produced.
			const now = performance.now();
			const elapsed = now - secondStart;
			const frameCount = this.#emulator.frameCount;
			if (frameCount < framesAtSecondStart) {
				// The emulator was swapped (reboot/config change) and its
				// frameCount reset — rebase the window rather than report a
				// negative delta.
				framesAtSecondStart = frameCount;
				secondStart = now;
			} else if (elapsed >= 1000) {
				const frames = frameCount - framesAtSecondStart;
				this.fps.value = Math.round((frames * 1000) / elapsed);
				framesAtSecondStart = frameCount;
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
			// Let toolbar buttons and the sidebar (which has its own focusable
			// input) take their own clicks; only steal focus back from clicks on
			// the screen/letterbox so keystrokes return to the emulator.
			if ((event.target as HTMLElement).closest("button, aside")) return;
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
