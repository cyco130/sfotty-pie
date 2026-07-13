import { useRef, useState } from "preact/hooks";
import type { EmulatorHost } from "./host.ts";
import { messages } from "./messages.ts";

/**
 * The OSD's paste view: a free-form text editor whose send button types the
 * text into the machine through the OS keyboard trap ({@link
 * EmulatorHost.typeText}). This is the clipboard-API-free path: the OS
 * keyboard's own long-press paste works into the textarea, and it doubles
 * as an editor - paste a listing, fix a line, send. Sending clears the
 * editor and drops focus so the OS keyboard collapses and the machine is
 * visible while it types.
 */
export function PasteView({ host }: { host: EmulatorHost }) {
	const [text, setText] = useState("");
	const inputRef = useRef<HTMLTextAreaElement>(null);

	const send = () => {
		host.typeText(text);
		setText("");
		inputRef.current?.blur();
	};

	return (
		<div class="mx-auto flex w-full max-w-xl flex-col gap-2">
			<textarea
				ref={inputRef}
				value={text}
				placeholder={messages.paste.placeholder}
				autocapitalize="off"
				autocomplete="off"
				spellcheck={false}
				class="h-28 resize-none rounded-sm bg-white/90 p-2 font-mono text-sm text-neutral-900 placeholder-neutral-500 outline-none"
				onInput={(event) => setText(event.currentTarget.value)}
			/>
			<button
				type="button"
				class="rounded-sm bg-neutral-700/70 px-3 py-2 text-sm text-white select-none active:bg-neutral-500 disabled:opacity-40"
				disabled={text.length === 0}
				onClick={send}
			>
				{messages.paste.send}
			</button>
		</div>
	);
}
