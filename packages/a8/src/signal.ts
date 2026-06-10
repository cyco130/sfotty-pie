export class Signal<T> {
	constructor(value: T) {
		this.#value = value;
	}

	get value(): T {
		return this.#value;
	}

	set value(value: T) {
		if (Object.is(this.#value, value)) {
			return;
		}

		const oldValue = this.#value;
		this.#value = value;
		this.#watchers.forEach((callback) => callback(oldValue, this));
	}

	watch(callback: SignalChangeCallback<Signal<T>>): () => void {
		this.#watchers.add(callback);
		return () => {
			this.#watchers.delete(callback);
		};
	}

	connect(input: Signal<T>): () => void {
		return this.watch(() => {
			input.value = this.#value;
		});
	}

	#value: T;
	#watchers: Set<SignalChangeCallback<Signal<T>>> = new Set();
}

export type SignalChangeCallback<S extends Signal<any>> = (
	oldValue: S["value"],
	source: S,
) => void;
