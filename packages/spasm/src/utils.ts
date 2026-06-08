export function impossible(value: never): never {
	console.error(value);
	throw new Error(`Impossible value ${value}`);
}

export function assume(condition: boolean): asserts condition {
	if (!condition) {
		throw new Error("Assumption error");
	}
}
