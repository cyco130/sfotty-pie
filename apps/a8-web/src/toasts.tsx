import { useEffect, useState } from "preact/hooks";
import type { EmulatorHost, Toast } from "./host.ts";
import { messages } from "./messages.ts";

// Auto-dismiss timings: warnings linger longer than plain info.
const INFO_MS = 3500;
const WARNING_MS = 6000;

/**
 * An auto-dismissing info/warning toast (bottom-right). The timer pauses while
 * hovered so it can't vanish mid-read; a click dismisses it outright.
 */
function Notice({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
	const [hovered, setHovered] = useState(false);

	useEffect(() => {
		if (hovered) return;
		const ms = toast.kind === "warning" ? WARNING_MS : INFO_MS;
		const timer = setTimeout(onDismiss, ms);
		return () => clearTimeout(timer);
	}, [hovered, toast, onDismiss]);

	const color = toast.kind === "warning" ? "bg-amber-600" : "bg-neutral-800";
	return (
		<div
			class={`pointer-events-auto cursor-pointer rounded ${color} px-3 py-1.5 text-sm text-white shadow-lg`}
			onClick={onDismiss}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
		>
			{toast.text}
		</div>
	);
}

/**
 * A pinned error toast (top-center). It stays until dismissed via ✕, the text
 * is selectable, and a Copy button puts it on the clipboard for bug reports.
 */
function ErrorToast({
	toast,
	onDismiss,
}: {
	toast: Toast;
	onDismiss: () => void;
}) {
	const [copied, setCopied] = useState(false);

	const copy = () => {
		void navigator.clipboard?.writeText(toast.text);
		setCopied(true);
	};

	return (
		<div
			role="alert"
			class="pointer-events-auto flex max-w-md items-start gap-2 rounded bg-red-600 px-3 py-1.5 text-sm text-white shadow-lg"
		>
			<span class="grow select-text">{toast.text}</span>
			<button
				type="button"
				class="shrink-0 rounded bg-red-700/70 px-1.5 hover:bg-red-700"
				onClick={copy}
			>
				{copied ? messages.toasts.copied : messages.toasts.copy}
			</button>
			<button
				type="button"
				class="shrink-0 px-1 hover:text-red-200"
				aria-label={messages.toasts.dismiss}
				onClick={onDismiss}
			>
				✕
			</button>
		</div>
	);
}

/**
 * The toast layers: pinned errors top-center (manually dismissed, copyable);
 * auto-dismissing info/warning notices bottom-right. Both stacks let pointer
 * events through except on the toasts themselves.
 */
export function Toasts({ host }: { host: EmulatorHost }) {
	const errors = host.errors.value;
	const notices = host.notices.value;

	return (
		<>
			<div class="pointer-events-none fixed top-3 left-1/2 z-20 flex max-w-[90%] -translate-x-1/2 flex-col items-center gap-2">
				{errors.map((toast) => (
					<ErrorToast
						key={toast.id}
						toast={toast}
						onDismiss={() => host.dismissToast(toast.id)}
					/>
				))}
			</div>
			<div class="pointer-events-none fixed right-3 bottom-3 z-20 flex max-w-[90%] flex-col items-end gap-2">
				{notices.map((toast) => (
					<Notice
						key={toast.id}
						toast={toast}
						onDismiss={() => host.dismissToast(toast.id)}
					/>
				))}
			</div>
		</>
	);
}
