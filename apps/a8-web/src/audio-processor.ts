// The AudioWorklet processor: plays Float32Array chunks posted to its port,
// holding the last level on underrun (the DC blocker upstream keeps that
// near zero). Bundled as a worker entry and loaded by URL (see audio.ts) -
// Vite has no first-class worklet target, but `?worker&url` transpiles and
// emits a self-contained file, which is all addModule needs. Keep this file
// import-free and free of Worker-scope globals so that stays true.

// The AudioWorklet global scope is not in TS's DOM lib; declare what we use.
declare abstract class AudioWorkletProcessor {
	readonly port: MessagePort;
	abstract process(
		inputs: Float32Array[][],
		outputs: Float32Array[][],
	): boolean;
}
declare function registerProcessor(
	name: string,
	processor: new () => AudioWorkletProcessor,
): void;

class A8Audio extends AudioWorkletProcessor {
	#queue: Float32Array[] = [];
	#offset = 0;
	#last = 0;

	constructor() {
		super();
		this.port.onmessage = (event: MessageEvent<Float32Array | "clear">) => {
			if (event.data === "clear") {
				this.#queue.length = 0;
				this.#offset = 0;
			} else {
				this.#queue.push(event.data);
			}
		};
	}

	override process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
		const out = outputs[0]![0]!;
		for (let i = 0; i < out.length; i++) {
			const head = this.#queue[0];
			if (head) {
				out[i] = this.#last = head[this.#offset++]!;
				if (this.#offset >= head.length) {
					this.#queue.shift();
					this.#offset = 0;
				}
			} else {
				out[i] = this.#last;
			}
		}
		return true;
	}
}

registerProcessor("a8-audio", A8Audio);
