// The AudioWorklet processor: plays Float32Array chunks posted to its port,
// holding the last level on underrun (the DC blocker upstream keeps that
// near zero). Defined as source text and loaded from a Blob so no bundler
// worklet plumbing is needed.
const PROCESSOR_SOURCE = `
class A8Audio extends AudioWorkletProcessor {
	constructor() {
		super();
		this.queue = [];
		this.offset = 0;
		this.last = 0;
		this.port.onmessage = (event) => {
			if (event.data === "clear") {
				this.queue.length = 0;
				this.offset = 0;
			} else {
				this.queue.push(event.data);
			}
		};
	}

	process(inputs, outputs) {
		const out = outputs[0][0];
		for (let i = 0; i < out.length; i++) {
			const head = this.queue[0];
			if (head) {
				out[i] = this.last = head[this.offset++];
				if (this.offset >= head.length) {
					this.queue.shift();
					this.offset = 0;
				}
			} else {
				out[i] = this.last;
			}
		}
		return true;
	}
}
registerProcessor("a8-audio", A8Audio);
`;

/**
 * The audio sink: chunks pushed in are played back-to-back by the worklet.
 * {@link buffered} estimates the queue depth from the audio clock — the
 * emulator paces itself by keeping it near a target, which makes the audio
 * clock the timing master.
 */
export class AudioOutput {
	readonly context: AudioContext;
	readonly #node: AudioWorkletNode;
	readonly #gain: GainNode;

	// Queue-depth accounting: samples sent minus samples consumed, the
	// latter estimated from the audio clock.
	#sent = 0;
	#base = 0;

	private constructor(
		context: AudioContext,
		node: AudioWorkletNode,
		gain: GainNode,
	) {
		this.context = context;
		this.#node = node;
		this.#gain = gain;
	}

	/**
	 * Mute at the output, not by withholding chunks — the emulator paces
	 * itself off the audio clock, so the worklet must keep consuming.
	 */
	get muted(): boolean {
		return this.#gain.gain.value === 0;
	}

	set muted(value: boolean) {
		this.#gain.gain.value = value ? 0 : 1;
	}

	/** Create the context and worklet; null when Web Audio is unavailable. */
	static async create(): Promise<AudioOutput | null> {
		if (typeof AudioContext === "undefined") return null;
		const context = new AudioContext({ latencyHint: "interactive" });
		const url = URL.createObjectURL(
			new Blob([PROCESSOR_SOURCE], { type: "text/javascript" }),
		);
		try {
			await context.audioWorklet.addModule(url);
		} finally {
			URL.revokeObjectURL(url);
		}
		const node = new AudioWorkletNode(context, "a8-audio", {
			numberOfInputs: 0,
			outputChannelCount: [1],
		});
		const gain = new GainNode(context, { gain: 1 });
		node.connect(gain);
		gain.connect(context.destination);
		return new AudioOutput(context, node, gain);
	}

	/** True while the context runs — i.e. the audio clock is ticking. */
	get running(): boolean {
		return this.context.state === "running";
	}

	/** Resume the context; browsers require a user gesture for this. */
	resume(): void {
		if (!this.running) void this.context.resume();
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

	/** Drop everything queued — e.g. after a pause or machine swap. */
	clear(): void {
		this.#node.port.postMessage("clear");
		this.#sent = 0;
		this.#base = this.context.currentTime;
	}
}
