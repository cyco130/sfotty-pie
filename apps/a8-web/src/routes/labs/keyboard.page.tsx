/* eslint-disable no-console -- logging every event to the console is this probe's whole job */
import { useEffect, useRef } from "preact/hooks";
import { useHead } from "../../head.ts";
import { messages } from "../../messages.ts";

// /labs/keyboard — a scratch page for observing raw keyboard/composition events.
// Useful groundwork for the key-binding work (key/code/location/modifier model).

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

// Per-event-type log row colour.
const TYPE_COLOR: Record<string, string> = {
	keydown: "text-green-400",
	keyup: "text-blue-400",
	beforeinput: "text-pink-400",
	input: "text-pink-400",
	compositionstart: "text-amber-400",
	compositionupdate: "text-amber-400",
	compositionend: "text-amber-400",
};

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

export default function KeyboardLabPage() {
	useHead({ title: messages.pages.keyboard.title });

	const fieldRef = useRef<HTMLInputElement>(null);
	const preventRef = useRef<HTMLInputElement>(null);
	const clearFieldRef = useRef<HTMLInputElement>(null);
	const clearButtonRef = useRef<HTMLButtonElement>(null);
	const modsRef = useRef<HTMLDivElement>(null);
	const logRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const field = fieldRef.current;
		const prevent = preventRef.current;
		const clearField = clearFieldRef.current;
		const clearButton = clearButtonRef.current;
		const modsEl = modsRef.current;
		const logEl = logRef.current;
		if (
			!field ||
			!prevent ||
			!clearField ||
			!clearButton ||
			!modsEl ||
			!logEl
		) {
			return;
		}

		let start = performance.now();
		const stamp = (): string =>
			`+${Math.round(performance.now() - start)
				.toString()
				.padStart(5)}ms`;

		const append = (type: string, detail: string, event: Event): void => {
			const row = document.createElement("div");
			row.className = `border-b border-neutral-900 py-0.5 ${TYPE_COLOR[type] ?? ""}`;
			row.textContent = `${stamp()}  ${type.padEnd(17)} ${detail}`;
			logEl.append(row);
			logEl.scrollTop = logEl.scrollHeight;
			console.log(`[${type}]`, detail, event);
		};

		const renderMods = (event: KeyboardEvent): void => {
			modsEl.replaceChildren();
			for (const name of MODIFIER_STATES) {
				const span = document.createElement("span");
				const on = event.getModifierState(name);
				span.className = on ? "text-amber-400" : "text-neutral-500";
				span.textContent = `${name}:${on ? "1" : "0"}`;
				modsEl.append(span, document.createTextNode("  "));
			}
		};

		const onKeydown = (event: KeyboardEvent): void => {
			renderMods(event);
			append("keydown", describeKeyboard(event), event);
			if (prevent.checked) event.preventDefault();
		};
		const onKeyup = (event: KeyboardEvent): void => {
			renderMods(event);
			append("keyup", describeKeyboard(event), event);
		};
		const onBeforeinput = (event: InputEvent): void => {
			append("beforeinput", describeInput(event), event);
		};
		const onInput = (event: Event): void => {
			const e = event as InputEvent;
			append("input", describeInput(e), e);
			if (clearField.checked && !e.isComposing) field.value = "";
		};
		const compositionTypes = [
			"compositionstart",
			"compositionupdate",
			"compositionend",
		] as const;
		const onComposition = (event: CompositionEvent): void => {
			append(event.type, describeComposition(event), event);
			if (event.type === "compositionend" && clearField.checked) {
				field.value = "";
			}
		};
		const onClear = (): void => {
			logEl.replaceChildren();
			start = performance.now();
		};

		field.addEventListener("keydown", onKeydown);
		field.addEventListener("keyup", onKeyup);
		field.addEventListener("beforeinput", onBeforeinput);
		field.addEventListener("input", onInput);
		for (const type of compositionTypes) {
			field.addEventListener(type, onComposition);
		}
		clearButton.addEventListener("click", onClear);
		field.focus();

		return () => {
			field.removeEventListener("keydown", onKeydown);
			field.removeEventListener("keyup", onKeyup);
			field.removeEventListener("beforeinput", onBeforeinput);
			field.removeEventListener("input", onInput);
			for (const type of compositionTypes) {
				field.removeEventListener(type, onComposition);
			}
			clearButton.removeEventListener("click", onClear);
		};
	}, []);

	return (
		<div class="flex h-full flex-col bg-neutral-950 font-mono text-sm text-neutral-200 [color-scheme:dark]">
			<header class="shrink-0 border-b border-neutral-800 px-4 py-3">
				<h1 class="text-base font-semibold text-neutral-100">
					Keyboard event lab
				</h1>
				<p class="mt-1 text-xs text-neutral-400">
					Focus the field and type. Every keydown / keyup / beforeinput / input
					/ composition* event is logged here and to the console. Try dead keys
					(e.g. <code>^</code> then <code>a</code>), AltGr, Shift, Ctrl, Caps
					Lock, and held/repeating keys.
				</p>
			</header>

			<div class="flex shrink-0 flex-wrap items-center gap-3 px-4 py-3">
				<input
					ref={fieldRef}
					type="text"
					autocomplete="off"
					autocapitalize="off"
					autocorrect="off"
					spellcheck={false}
					placeholder="Type here…"
					class="min-w-64 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-white"
				/>
				<label class="flex cursor-pointer items-center gap-2 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 select-none">
					<input ref={preventRef} type="checkbox" />
					preventDefault keydown
				</label>
				<label class="flex cursor-pointer items-center gap-2 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 select-none">
					<input ref={clearFieldRef} type="checkbox" checked />
					auto-clear field
				</label>
				<button
					ref={clearButtonRef}
					type="button"
					class="cursor-pointer rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 select-none hover:bg-neutral-700"
				>
					Clear log
				</button>
			</div>

			<div
				ref={modsRef}
				class="min-h-[1.2em] shrink-0 px-4 pb-2 text-xs text-neutral-400"
			/>
			<div
				ref={logRef}
				class="flex-1 overflow-y-auto px-4 pt-2 pb-8 break-words whitespace-pre-wrap"
			/>
		</div>
	);
}
