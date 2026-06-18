import {
	Atari,
	CYCLES_PER_LINE,
	FRAME_BUFFER_HEIGHT,
	FRAME_BUFFER_WIDTH,
	NTSC_CYCLES_PER_SECOND,
	PAL_CYCLES_PER_SECOND,
	type AtrImage,
	type MachineConfig,
} from "@sfotty-pie/a8";
import { ReadOptions, traceLine, type Sfotty } from "@sfotty-pie/sfotty";
import { AntiAliasFilter } from "./audio-filter.ts";
import type { AudioOutput } from "./audio.ts";

// The CPU trace ring: the last this many executed instructions, kept for the
// dev console. Captured as formatted lines so a later dump is unaffected by
// memory changes (e.g. the bank switches around a reset).
const TRACE_RING_SIZE = 8192;

// On a reset, capture this many (loop-compressed) instructions of the boot
// that follows, then freeze — the warm/cold decision is near the start, so
// this keeps it from being evicted by the post-boot idle loop.
const RESET_TRACE_CAPTURE = 4096;

// Tight loops up to this many distinct instructions are recorded once, not
// every iteration (see #recentPcs).
const LOOP_WINDOW = 64;

// Audio chunking and pacing: ~21ms chunks, ~50ms of queue as the pacing
// target, and a bounded scanline batch per wake so the UI stays responsive.
const CHUNK_SAMPLES = 1024;
const TARGET_BUFFER_SECONDS = 0.05;
const SCANLINE_BATCH = 64;

// Yield cadence in scanlines. Coprime to both frame lengths (262 and 312) so
// the yield point drifts across the frame instead of aliasing to a fixed line.
const YIELD_INTERVAL = 257;

// When we fall further behind than this (tab jank, a debugger pause), rebase
// the clock and drop the lost time instead of replaying it — avoids the
// spiral of death.
const MAX_LAG_MS = 100;

export interface EmulatorConfig extends MachineConfig {
	/** Disk in drive D1: (read-only; served by the trap-based SIO). */
	disk?: AtrImage;
	/** Audio sink. When its context runs, the audio clock paces emulation. */
	audio?: AudioOutput;
	/**
	 * Hold OPTION down for the first frames after a cold boot — how the
	 * XL/XE disables built-in BASIC (the OS samples CONSOL during init).
	 */
	holdOption?: boolean;
}

// Frames to hold OPTION for the BASIC-disable: the OS reads CONSOL early in
// its cold-boot init, so a handful of frames is plenty.
const OPTION_HOLD_FRAMES = 7;

/**
 * Drives an {@link Atari} machine in real time, paced against
 * `performance.now()` (the audio clock will be promoted to master once there
 * is audio). Renders into a double buffer: `frame` is the latest completed
 * frame, `frameCount` ticks on every flip.
 */
export class Emulator {
	readonly machine: Atari;

	// Double buffer for tear-free display: the machine renders into #frames[#back]
	// (its own default buffer is reused as one half), and at each frame boundary
	// we present it and repoint the machine at the other half. Both assigned in
	// the constructor, once `machine` exists.
	readonly #frames: readonly [Uint8Array, Uint8Array];
	#back = 0;

	/** The latest completed frame (one Atari color byte per pixel). */
	frame: Uint8Array;
	/** Increments on every completed frame. */
	frameCount = 0;

	/** True once the CPU has jammed on a CIM (KIL/JAM) instruction. */
	get crashed(): boolean {
		return this.machine.cpu.crashed;
	}

	/** The CPU, for the dev console (inspection only). */
	get cpu(): Sfotty {
		return this.machine.cpu;
	}

	#trace = false;
	#traceRing: (string | undefined)[] = new Array(TRACE_RING_SIZE);
	#traceCount = 0;
	// A reset clears the ring and captures the boot, then freezes (so the
	// post-boot idle loop can't evict it). -1 = capture freely.
	#traceFreezeAt = -1;
	#wasResetAsserted = false;
	// Loop compression: skip recording a PC seen in the last this-many
	// recorded instructions, so tight loops (the XL coldstart's ~71k-iteration
	// delay, RAM clears) collapse and the ring spans real control flow.
	#recentPcs = new Int32Array(LOOP_WINDOW).fill(-1);
	readonly #peek = (address: number): number =>
		this.machine.read(address & 0xffff, ReadOptions.PEEK);

	// Record one committed-fetch instruction, skipping a PC seen in the last
	// LOOP_WINDOW records so tight loops collapse. Wired to the machine's
	// onInstruction only while tracing, so there's no per-instruction cost when
	// it's off; once a reset-capture fills, it unwires itself to freeze the ring.
	readonly #recordTrace = (pc: number): void => {
		if (this.#recentPcs.includes(pc)) return;
		this.#traceRing[this.#traceCount % TRACE_RING_SIZE] = traceLine(
			this.machine.cpu,
			this.#peek,
			pc,
		);
		this.#recentPcs[this.#traceCount % LOOP_WINDOW] = pc;
		this.#traceCount++;
		if (this.#traceFreezeAt >= 0 && this.#traceCount >= this.#traceFreezeAt) {
			this.#trace = false; // ring now holds the boot; freeze it
			this.machine.onInstruction = undefined;
		}
	};

	/** Enable/disable the CPU instruction trace ring. */
	setTrace(enabled: boolean): void {
		this.#trace = enabled;
		this.#traceFreezeAt = -1;
		this.machine.onInstruction = enabled ? this.#recordTrace : undefined;
	}

	/** Clear the trace ring. */
	clearTrace(): void {
		this.#traceCount = 0;
		this.#traceFreezeAt = -1;
	}

	/** Traced instructions, oldest first — the last `count`, or all of them. */
	dumpTrace(count?: number): string[] {
		const total = this.#traceCount;
		const start = Math.max(
			0,
			total - (count ?? total),
			total - TRACE_RING_SIZE,
		);
		const lines: string[] = [];
		for (let i = start; i < total; i++) {
			const line = this.#traceRing[i % TRACE_RING_SIZE];
			if (line !== undefined) lines.push(line);
		}
		return lines;
	}

	#running = false;
	#turboMode = false;
	#scanlines = 0;
	#epoch = 0;

	// BASIC-disable: hold OPTION for a few frames after each cold boot.
	readonly #holdOption: boolean;
	#optionFramesLeft = 0;

	// Wall-clock pacing is per-TV-standard (NTSC ~1.79MHz, PAL ~1.77MHz).
	readonly #msPerScanline: number;

	// The audio pipeline: per-cycle POKEY+speaker level → anti-alias filter
	// → nearest-neighbor decimation → DC blocker → fixed-size chunks.
	#audio: AudioOutput | null;
	#filter = new AntiAliasFilter();
	#cyclesPerSample = 0;
	#targetBuffer = 0;
	#phase = 0;
	#chunk = new Float32Array(CHUNK_SAMPLES);
	#chunkLength = 0;
	#dcIn = 0;
	#dcOut = 0;

	constructor(config: EmulatorConfig) {
		this.machine = new Atari(config);
		// Reuse the machine's default buffer as one half of the double buffer; the
		// machine already renders into it (#back starts at 0), so the first frame
		// needs no setFrameBuffer. The front starts on the other (empty) half.
		this.#frames = [
			this.machine.frame,
			new Uint8Array(FRAME_BUFFER_WIDTH * FRAME_BUFFER_HEIGHT),
		];
		this.frame = this.#frames[1];

		if (config.disk) this.machine.insertDisk(config.disk);

		this.#holdOption = config.holdOption ?? false;
		this.#startOptionHold();

		const cyclesPerSecond =
			config.tvSystem === "pal"
				? PAL_CYCLES_PER_SECOND
				: NTSC_CYCLES_PER_SECOND;
		this.#msPerScanline = (1000 * CYCLES_PER_LINE) / cyclesPerSecond;

		this.#audio = config.audio ?? null;
		if (this.#audio) {
			const rate = this.#audio.context.sampleRate;
			this.#cyclesPerSample = cyclesPerSecond / rate;
			this.#targetBuffer = Math.round(rate * TARGET_BUFFER_SECONDS);
		}
	}

	start(): void {
		if (this.#running) return;
		this.#running = true;
		void this.#loop();
	}

	stop(): void {
		this.#running = false;
	}

	/**
	 * Turbo mode: run as fast as the host allows, dropping both the audio
	 * buffer gate and the wall-clock sleep so emulation is no longer pinned to
	 * real time. Audio is suppressed while it's on (real-time playback can't
	 * speed up without unbounded buffering). Toggling either way rebases the
	 * wall clock and re-anchors the audio queue for a clean handoff.
	 */
	setTurboMode(enabled: boolean): void {
		if (this.#turboMode === enabled) return;
		this.#turboMode = enabled;
		this.#audio?.clear();
		this.#epoch = performance.now() - this.#scanlines * this.#msPerScanline;
	}

	/** Power cycle: cold-reset the machine and the CPU. */
	coldStart(): void {
		this.machine.reset(true);
		this.machine.cpu.reset(true);
		this.#startOptionHold();
	}

	// Press OPTION at boot (BASIC-disable); the frame loop releases it after
	// OPTION_HOLD_FRAMES.
	#startOptionHold(): void {
		if (!this.#holdOption) return;
		this.machine.consoleKeyDown(0x04);
		this.#optionFramesLeft = OPTION_HOLD_FRAMES;
	}

	async #loop(): Promise<void> {
		const yieldMacrotask = makeMacrotaskYield();
		this.#epoch = performance.now() - this.#scanlines * this.#msPerScanline;

		while (this.#running) {
			if (document.hidden) {
				this.#audio?.clear();
				await waitForVisible();
				// The hidden interval is lost time, not work to replay.
				this.#epoch = performance.now() - this.#scanlines * this.#msPerScanline;
			}

			if (this.#turboMode) {
				// Unthrottled: run a whole emulated frame back-to-back, then
				// yield a macrotask — the only thing turbo waits on, so input
				// and the present loop still get a task turn. No sleep, no audio
				// gate. One frame per yield self-bounds main-thread hold time.
				const target = this.frameCount + 1;
				while (this.#running && this.frameCount < target) {
					this.#runScanline();
					this.#scanlines++;
				}
				await yieldMacrotask();
				continue;
			}

			const audio = this.#audio;
			if (audio?.running) {
				// The audio clock is master: run scanlines to keep the queue
				// near the target, in bounded batches so the UI stays alive.
				if (audio.buffered() < this.#targetBuffer) {
					for (
						let i = 0;
						i < SCANLINE_BATCH && audio.buffered() < this.#targetBuffer;
						i++
					) {
						this.#runScanline();
						this.#scanlines++;
					}
					await yieldMacrotask();
				} else {
					await sleep(4);
				}
				// Keep the wall clock rebased for a clean handoff if the
				// audio context ever stops.
				this.#epoch = performance.now() - this.#scanlines * this.#msPerScanline;
				continue;
			}

			this.#runScanline();
			this.#scanlines++;

			const ahead =
				this.#epoch + this.#scanlines * this.#msPerScanline - performance.now();

			if (ahead > 5) {
				// setTimeout overshoots; re-reading the clock next iteration
				// self-corrects.
				await sleep(ahead - 2);
			} else if (ahead < -MAX_LAG_MS) {
				this.#epoch = performance.now() - this.#scanlines * this.#msPerScanline;
			} else if (this.#scanlines % YIELD_INTERVAL === 0) {
				// A macrotask yield — `await void 0` would only drain microtasks
				// and starve rendering, input, and requestAnimationFrame.
				await yieldMacrotask();
			}
		}
	}

	#runScanline(): void {
		const ag = this.machine.anticGtia;

		for (let cycle = 0; cycle < CYCLES_PER_LINE; cycle++) {
			// On the XL Reset line's release, start a fresh trace capture of the
			// boot that follows (the 800's Reset is an NMI, captured in normal
			// flow). The CPU reset itself is handled inside cycle().
			const resetAsserted = this.machine.resetAsserted;
			if (this.#trace && this.#wasResetAsserted && !resetAsserted) {
				this.#traceCount = 0;
				this.#traceFreezeAt = RESET_TRACE_CAPTURE;
				this.#recentPcs.fill(-1);
			}
			this.#wasResetAsserted = resetAsserted;

			// One whole machine cycle: ANTIC + POKEY + bus + CPU + render, the
			// audio level returned. Instructions are recorded via onInstruction
			// (see #recordTrace). a8-web installs no suspending traps, so cycle()
			// never throws — no resumeCycle() needed here.
			this.#collectAudio(this.machine.cycle(), ag.consoleSpeaker);
		}

		// vcount wraps to 0 while the last line of the frame is run: present the
		// finished buffer and repoint rendering at the other half.
		if (ag.vcount === 0) {
			// The `=== 0 ? 0 : 1` keeps a literal tuple index (no undefined).
			this.frame = this.#frames[this.#back === 0 ? 0 : 1];
			this.#back ^= 1;
			this.machine.setFrameBuffer(this.#frames[this.#back === 0 ? 0 : 1]);
			this.frameCount++;

			// Release the BASIC-disable OPTION hold once the OS has booted.
			if (this.#optionFramesLeft > 0 && --this.#optionFramesLeft === 0) {
				this.machine.consoleKeyUp(0x04);
			}
		}
	}

	// Per machine cycle: mix POKEY (0-60) with the console speaker, filter at
	// the machine rate, then pick one sample per audio frame (the filter has
	// already removed everything above ~18kHz) and DC-block it.
	#collectAudio(pokeyLevel: number, speaker: number): void {
		const audio = this.#audio;
		if (!audio?.running) return;
		// In turbo we generate samples far faster than real-time playback;
		// queuing them would grow the worklet buffer without bound. Drop them
		// and let the context underrun to silence until turbo ends.
		if (this.#turboMode) return;

		const filtered = this.#filter.apply(
			(pokeyLevel / 60) * 0.2 + speaker * 0.2,
		);

		if (++this.#phase < this.#cyclesPerSample) return;
		this.#phase -= this.#cyclesPerSample;

		const blocked = filtered - this.#dcIn + 0.999 * this.#dcOut;
		this.#dcIn = filtered;
		this.#dcOut = blocked;

		this.#chunk[this.#chunkLength++] = blocked;
		if (this.#chunkLength === CHUNK_SAMPLES) {
			audio.push(this.#chunk); // transfers the buffer away
			this.#chunk = new Float32Array(CHUNK_SAMPLES);
			this.#chunkLength = 0;
		}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForVisible(): Promise<void> {
	return new Promise((resolve) => {
		document.addEventListener("visibilitychange", function handler() {
			if (!document.hidden) {
				document.removeEventListener("visibilitychange", handler);
				resolve();
			}
		});
	});
}

function makeMacrotaskYield(): () => Promise<void> {
	const channel = new MessageChannel();
	let pending: (() => void) | null = null;
	channel.port1.onmessage = () => {
		const resolve = pending;
		pending = null;
		resolve?.();
	};
	return () =>
		new Promise((resolve) => {
			pending = resolve;
			channel.port2.postMessage(null);
		});
}
