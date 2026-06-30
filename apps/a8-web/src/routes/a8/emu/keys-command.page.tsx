import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { commands, type Command, labelOf } from "../../../commands.ts";
import { Icon } from "../../../icon.tsx";
import {
	type Binding,
	CHARACTER_CODES,
	chordLabel,
	codeLabel,
	KEY_CODES,
	triggerKey,
} from "../../../key-bindings.ts";
import { setCapturingKeys } from "../../../keyboard.ts";
import { messages } from "../../../messages.ts";
import { navigate } from "../../../navigate.ts";
import { useEmu } from "./emu-context.ts";
import { PanelFrame } from "./panel-frame.tsx";

const KEYS = "/a8/emu/keys";

// A modifier's form state. "off" → must be up (omitted), "on" → required down,
// "any" → don't-care. Maps to Binding's Mod (absent | true | "any").
type Tri = "off" | "on" | "any";
const MODS = ["ctrl", "shift", "alt", "meta"] as const;
type ModName = (typeof MODS)[number];

const toMod = (t: Tri): true | "any" | undefined =>
	t === "on" ? true : t === "any" ? "any" : undefined;

function isCommand(value: string): value is Command {
	return Object.hasOwn(commands, value);
}

// App commands default to the global scope (their `PRESS_`-less name), machine
// keys to "a8" — the editor's suggestion, overridable.
const defaultScope = (command: Command): "global" | "a8" =>
	command.startsWith("PRESS_") ? "a8" : "global";

// A captured combo. Modifiers are booleans (capture can't express "any"); a
// modifier key pressed alone records its `code` without setting that modifier.
interface Combo {
	code: string;
	ctrl: boolean;
	shift: boolean;
	alt: boolean;
	meta: boolean;
}

function captureCombo(event: KeyboardEvent): Combo {
	const c = event.code;
	const altGraph = event.getModifierState("AltGraph");
	return {
		code: c,
		ctrl:
			event.ctrlKey && !altGraph && c !== "ControlLeft" && c !== "ControlRight",
		shift: event.shiftKey && c !== "ShiftLeft" && c !== "ShiftRight",
		alt: event.altKey && !altGraph && c !== "AltLeft" && c !== "AltRight",
		meta: event.metaKey && c !== "MetaLeft" && c !== "MetaRight",
	};
}

function comboLabel(combo: Combo, mac: boolean): string {
	const parts: string[] = [];
	if (combo.ctrl) parts.push("Ctrl");
	if (combo.meta) parts.push(mac ? "Cmd" : "Meta");
	if (combo.alt) parts.push(mac ? "Opt" : "Alt");
	if (combo.shift) parts.push("Shift");
	parts.push(codeLabel(combo.code));
	return parts.join("+");
}

function BackLink() {
	return (
		<button
			type="button"
			class="self-start text-xs text-neutral-500 hover:underline"
			onClick={() => navigate(KEYS, { replace: true })}
		>
			‹ {messages.shortcuts.back}
		</button>
	);
}

// A small segmented control.
function Segments({
	value,
	options,
	onChange,
}: {
	value: string;
	options: { value: string; label: string }[];
	onChange: (value: string) => void;
}) {
	return (
		<div class="inline-flex overflow-hidden rounded border border-neutral-300">
			{options.map((option, index) => (
				<button
					key={option.value}
					type="button"
					class={`px-2 py-0.5 text-xs ${index > 0 ? "border-l border-neutral-300" : ""} ${
						value === option.value
							? "bg-neutral-800 text-white"
							: "bg-white text-neutral-600 hover:bg-neutral-50"
					}`}
					onClick={() => onChange(option.value)}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

export default function KeyCommandPanel({ command: raw }: { command: string }) {
	const { host } = useEmu();
	const [code, setCode] = useState("");
	const [mods, setMods] = useState<Record<ModName, Tri>>({
		ctrl: "off",
		shift: "off",
		alt: "off",
		meta: "off",
	});
	const [scope, setScope] = useState<"global" | "a8">(
		isCommand(raw) ? defaultScope(raw) : "a8",
	);
	const [capturing, setCapturing] = useState(false);
	const [captured, setCaptured] = useState<Combo | null>(null);
	const capturedRef = useRef<Combo | null>(null);

	// Key capture (VSCode-style): record each combo, Enter applies it to the form,
	// Esc cancels. A window-capture listener so it preempts the global resolver and
	// the emulator; the keyboard's global dispatch stands down via setCapturingKeys.
	// Layout effect (pre-paint) so the standdown is in place before the user, who
	// only acts once the capture UI is visible, can press a global chord like Cmd+K.
	useLayoutEffect(() => {
		if (!capturing) return;
		setCapturingKeys(true);
		const onKey = (event: KeyboardEvent) => {
			event.preventDefault();
			event.stopImmediatePropagation();
			if (event.key === "Escape") {
				setCapturing(false);
				return;
			}
			if (event.key === "Enter") {
				const combo = capturedRef.current;
				if (combo) {
					setCode(combo.code);
					setMods({
						ctrl: combo.ctrl ? "on" : "off",
						shift: combo.shift ? "on" : "off",
						alt: combo.alt ? "on" : "off",
						meta: combo.meta ? "on" : "off",
					});
				}
				setCapturing(false);
				return;
			}
			const combo = captureCombo(event);
			capturedRef.current = combo;
			setCaptured(combo);
		};
		window.addEventListener("keydown", onKey, true);
		return () => {
			setCapturingKeys(false);
			window.removeEventListener("keydown", onKey, true);
		};
	}, [capturing]);

	if (!isCommand(raw)) {
		return (
			<PanelFrame title={messages.sidebar.titleKeys}>
				<div class="flex min-h-0 flex-1 flex-col gap-3">
					<BackLink />
					<p class="text-sm text-neutral-400">
						{messages.shortcuts.unknownCommand}
					</p>
				</div>
			</PanelFrame>
		);
	}
	const command = raw;

	const modName: Record<ModName, string> = {
		ctrl: "Ctrl",
		shift: "Shift",
		alt: host.isMac ? "Opt" : "Alt",
		meta: host.isMac ? "Cmd" : "Meta",
	};

	const bindings = host.keyBindings.value.filter((b) => b.command === command);

	const candidate: Binding | null = code
		? {
				on: code,
				...(toMod(mods.ctrl) !== undefined && { ctrl: toMod(mods.ctrl) }),
				...(toMod(mods.shift) !== undefined && { shift: toMod(mods.shift) }),
				...(toMod(mods.alt) !== undefined && { alt: toMod(mods.alt) }),
				...(toMod(mods.meta) !== undefined && { meta: toMod(mods.meta) }),
				command,
				...(scope === "global" && { scope: "global" as const }),
			}
		: null;
	const candTrigger = candidate ? triggerKey(candidate) : null;
	const conflict = candTrigger
		? host.keyBindings.value.find((b) => triggerKey(b) === candTrigger)
		: undefined;
	// A bare character key (no Ctrl/Alt/Cmd required down) is shadowed by typing
	// in Character mode — it only fires in Positional.
	const bareTyping =
		!!code &&
		CHARACTER_CODES.has(code) &&
		mods.ctrl !== "on" &&
		mods.alt !== "on" &&
		mods.meta !== "on";

	const reset = () => {
		setCode("");
		setMods({ ctrl: "off", shift: "off", alt: "off", meta: "off" });
		setScope(defaultScope(command));
	};

	const add = () => {
		if (!candidate || !candTrigger) return;
		// One trigger → one command: drop any binding already on this trigger
		// (the reassign), then append.
		host.updateBindings([
			...host.keyBindings.value.filter((b) => triggerKey(b) !== candTrigger),
			candidate,
		]);
		reset();
	};

	const remove = (binding: Binding) => {
		const chord = chordLabel(binding, host.isMac);
		if (!window.confirm(messages.shortcuts.confirmRemove(chord))) return;
		host.updateBindings(host.keyBindings.value.filter((b) => b !== binding));
	};

	const triModOptions = [
		{ value: "off", label: messages.shortcuts.modOff },
		{ value: "on", label: messages.shortcuts.modOn },
		{ value: "any", label: messages.shortcuts.modAny },
	];

	return (
		<PanelFrame title={labelOf(command)}>
			<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
				<BackLink />

				<section class="flex flex-col gap-1.5">
					<h3 class="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
						{messages.shortcuts.bindings}
					</h3>
					{bindings.length === 0 ? (
						<p class="text-sm text-neutral-400">
							{messages.shortcuts.noBindings}
						</p>
					) : (
						<ul class="flex flex-col gap-1">
							{bindings.map((binding) => (
								<li
									key={triggerKey(binding)}
									class="flex items-center justify-between gap-2 text-sm"
								>
									<kbd class="font-mono text-xs text-neutral-700">
										{chordLabel(binding, host.isMac)}
										{binding.scope === "global" && (
											<span class="ml-1.5 text-neutral-400">
												{messages.shortcuts.scopeGlobal}
											</span>
										)}
									</kbd>
									<button
										type="button"
										aria-label={messages.shortcuts.removeBinding}
										class="text-neutral-400 hover:text-neutral-700"
										onClick={() => remove(binding)}
									>
										<Icon name="close" class="size-3.5" />
									</button>
								</li>
							))}
						</ul>
					)}
				</section>

				<section class="flex flex-col gap-2 border-t border-neutral-200 pt-3">
					<h3 class="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
						{messages.shortcuts.addBinding}
					</h3>

					<div class="flex flex-col gap-1">
						<span class="text-xs text-neutral-500">
							{messages.shortcuts.key}
						</span>
						{capturing ? (
							<div class="rounded border border-neutral-500 bg-neutral-50 px-2 py-1 text-sm">
								<span class="font-mono text-neutral-900">
									{captured
										? comboLabel(captured, host.isMac)
										: messages.shortcuts.capturePrompt}
								</span>
								<span class="ml-2 text-xs text-neutral-400">
									{messages.shortcuts.captureHint}
								</span>
							</div>
						) : (
							<button
								type="button"
								class="rounded border border-neutral-300 px-2 py-1 text-left text-sm text-neutral-700 hover:bg-neutral-50"
								onClick={() => {
									capturedRef.current = null;
									setCaptured(null);
									setCapturing(true);
								}}
							>
								{messages.shortcuts.capture}
							</button>
						)}
						<select
							value={code}
							class="rounded border border-neutral-300 px-2 py-1 text-sm text-neutral-900 outline-none focus:border-neutral-500"
							onChange={(event) => setCode(event.currentTarget.value)}
						>
							<option value="">{messages.shortcuts.keyNone}</option>
							{KEY_CODES.map((c) => (
								<option key={c} value={c} title={c}>
									{codeLabel(c)}
								</option>
							))}
						</select>
					</div>

					{MODS.map((m) => (
						<div
							key={m}
							class={`flex items-center justify-between gap-2 ${
								mods[m] === "off" ? "opacity-50" : ""
							}`}
						>
							<span class="text-sm text-neutral-700">{modName[m]}</span>
							<Segments
								value={mods[m]}
								options={triModOptions}
								onChange={(value) => setMods({ ...mods, [m]: value as Tri })}
							/>
						</div>
					))}

					<div class="flex items-center justify-between gap-2">
						<span class="text-sm text-neutral-700">
							{messages.shortcuts.scope}
						</span>
						<Segments
							value={scope}
							options={[
								{ value: "a8", label: messages.shortcuts.scopeMachine },
								{ value: "global", label: messages.shortcuts.scopeGlobal },
							]}
							onChange={(value) => setScope(value as "global" | "a8")}
						/>
					</div>

					{bareTyping && (
						<p class="text-xs text-amber-700">
							{messages.shortcuts.warnTyping}
						</p>
					)}
					{conflict && conflict.command !== command && (
						<p class="text-xs text-amber-700">
							{messages.shortcuts.warnConflict(labelOf(conflict.command))}
						</p>
					)}

					<button
						type="button"
						disabled={!code}
						class="mt-1 w-full rounded bg-neutral-800 px-2 py-1.5 text-sm text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:bg-neutral-300"
						onClick={add}
					>
						{messages.shortcuts.add}
					</button>
				</section>
			</div>
		</PanelFrame>
	);
}
