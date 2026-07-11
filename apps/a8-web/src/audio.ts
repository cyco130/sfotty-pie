// The worklet processor module (see audio-processor.ts): `?worker&url` makes
// Vite transpile it as a self-contained worker entry and hands back its URL,
// which is all audioWorklet.addModule needs.
import processorUrl from "./audio-processor.ts?worker&url";

/**
 * The audio sink: chunks pushed in are played back-to-back by the worklet.
 * {@link buffered} estimates the queue depth from the audio clock - the
 * emulator paces itself by keeping it near a target, which makes the audio
 * clock the timing master.
 */
export class AudioOutput {
	private constructor(
		context: AudioContext,
		node: AudioWorkletNode,
		gain: GainNode,
	) {
		this.context = context;
		this.#node = node;
		this.#gain = gain;
	}

	/** Create the context and worklet; null when Web Audio is unavailable. */
	static async create(): Promise<AudioOutput | null> {
		if (typeof AudioContext === "undefined") return null;
		const context = new AudioContext({ latencyHint: "interactive" });
		await context.audioWorklet.addModule(processorUrl);
		const node = new AudioWorkletNode(context, "a8-audio", {
			numberOfInputs: 0,
			outputChannelCount: [1],
		});
		const gain = new GainNode(context, { gain: 1 });
		node.connect(gain);
		gain.connect(context.destination);
		return new AudioOutput(context, node, gain);
	}

	readonly context: AudioContext;

	/** True while the context runs - i.e. the audio clock is ticking. */
	get running(): boolean {
		return this.context.state === "running";
	}

	/** Resume the context; browsers require a user gesture for this. */
	resume(): void {
		if (!this.running) void this.context.resume();
	}

	/**
	 * Mute at the output, not by withholding chunks - the emulator paces
	 * itself off the audio clock, so the worklet must keep consuming.
	 */
	get muted(): boolean {
		return this.#gain.gain.value === 0;
	}

	set muted(value: boolean) {
		this.#gain.gain.value = value ? 0 : 1;
	}

	/** The estimated unplayed sample count. */
	buffered(): number {
		const consumed =
			(this.context.currentTime - this.#base) * this.context.sampleRate;
		return this.#sent - consumed;
	}

	/** Queue a chunk for playback (the buffer is transferred away). */
	push(chunk: Float32Array): void {
		if (this.buffered() <= 0) {
			// The queue ran dry (or this is the first push): re-anchor the
			// consumption estimate to now.
			this.#base = this.context.currentTime;
			this.#sent = 0;
		}
		this.#sent += chunk.length;
		this.#node.port.postMessage(chunk, [chunk.buffer]);
	}

	/** Drop everything queued - e.g. after a pause or machine swap. */
	clear(): void {
		this.#node.port.postMessage("clear");
		this.#sent = 0;
		this.#base = this.context.currentTime;
	}

	readonly #node: AudioWorkletNode;
	readonly #gain: GainNode;

	// Queue-depth accounting: samples sent minus samples consumed, the
	// latter estimated from the audio clock.
	#sent = 0;
	#base = 0;
}
