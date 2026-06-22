// A scratch page for observing raw keyboard/composition events — not part of
// the emulator app and not a production build input; served by the dev server
// at /keyboard-lab.html.
/* eslint-disable no-console -- logging to the console is this page's whole job */

const MODIFIER_STATES = [
	"Shift",
	"Control",
	"Alt",
	"Meta",
	"AltGraph",
	"CapsLock",
	"NumLock",
	"ScrollLock",
] as const;

const LOCATION_NAMES = ["std", "left", "right", "numpad"] as const;

function quote(value: string | null): string {
	if (value === null) return "null";
	// Show whitespace/control chars and their code points explicitly.
	const points = [...value]
		.map((char) => "U+" + char.codePointAt(0)!.toString(16).padStart(4, "0"))
		.join(" ");
	return `${JSON.stringify(value)} [${points}]`;
}

function activeModifiers(event: KeyboardEvent): string {
	const on = MODIFIER_STATES.filter((name) => event.getModifierState(name));
	return on.length ? on.join("+") : "—";
}

function describeKeyboard(event: KeyboardEvent): string {
	const location = LOCATION_NAMES[event.location] ?? String(event.location);
	return [
		`key=${quote(event.key)}`,
		`code=${event.code}`,
		`loc=${location}`,
		`repeat=${event.repeat}`,
		`isComposing=${event.isComposing}`,
		`mods=[${activeModifiers(event)}]`,
	].join("  ");
}

function describeInput(event: InputEvent): string {
	return [
		`inputType=${event.inputType}`,
		`data=${quote(event.data)}`,
		`isComposing=${event.isComposing}`,
	].join("  ");
}

function describeComposition(event: CompositionEvent): string {
	return `data=${quote(event.data)}`;
}

function main(): void {
	const field = document.getElementById("field") as HTMLInputElement;
	const prevent = document.getElementById("prevent") as HTMLInputElement;
	const clearField = document.getElementById("clearField") as HTMLInputElement;
	const clearButton = document.getElementById("clear") as HTMLButtonElement;
	const modsEl = document.getElementById("mods") as HTMLDivElement;
	const logEl = document.getElementById("log") as HTMLDivElement;

	let start = performance.now();

	const stamp = (): string =>
		`+${Math.round(performance.now() - start)
			.toString()
			.padStart(5)}ms`;

	const append = (type: string, detail: string, event: Event): void => {
		const row = document.createElement("div");
		row.className = `row t-${type}`;
		row.textContent = `${stamp()}  ${type.padEnd(17)} ${detail}`;
		logEl.append(row);
		logEl.scrollIntoView(false);
		console.log(`[${type}]`, detail, event);
	};

	const renderMods = (event: KeyboardEvent): void => {
		modsEl.innerHTML = "";
		for (const name of MODIFIER_STATES) {
			const span = document.createElement("span");
			const on = event.getModifierState(name);
			span.className = on ? "on" : "dim";
			span.textContent = `${name}:${on ? "1" : "0"}`;
			modsEl.append(span, document.createTextNode("  "));
		}
	};

	field.addEventListener("keydown", (event) => {
		renderMods(event);
		append("keydown", describeKeyboard(event), event);
		if (prevent.checked) event.preventDefault();
	});

	field.addEventListener("keyup", (event) => {
		renderMods(event);
		append("keyup", describeKeyboard(event), event);
	});

	field.addEventListener("beforeinput", (event) => {
		append("beforeinput", describeInput(event as InputEvent), event);
	});

	field.addEventListener("input", (event) => {
		append("input", describeInput(event as InputEvent), event);
		if (clearField.checked && !(event as InputEvent).isComposing) {
			field.value = "";
		}
	});

	for (const type of [
		"compositionstart",
		"compositionupdate",
		"compositionend",
	] as const) {
		field.addEventListener(type, (event) => {
			append(type, describeComposition(event), event);
			if (type === "compositionend" && clearField.checked) field.value = "";
		});
	}

	clearButton.addEventListener("click", () => {
		logEl.innerHTML = "";
		start = performance.now();
	});

	field.focus();
}

main();
