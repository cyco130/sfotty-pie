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
		this.#watchers.forEach((callback) => callback(this, oldValue));
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
	source: S,
	oldValue: S["value"],
) => void;

// A Signal models a level (holds a value, notifies on change); a Pulse models
// an edge (no state, notifies on every emit).
export class Pulse<T = void> {
	emit(...args: undefined extends T ? [value?: T] : [value: T]): void {
		const value = args[0] as T;
		this.#watchers.forEach((callback) => callback(value, this));
	}

	watch(callback: PulseCallback<T>): () => void {
		this.#watchers.add(callback);
		return () => {
			this.#watchers.delete(callback);
		};
	}

	#watchers: Set<PulseCallback<T>> = new Set();
}

export type PulseCallback<T> = (value: T, source: Pulse<T>) => void;
