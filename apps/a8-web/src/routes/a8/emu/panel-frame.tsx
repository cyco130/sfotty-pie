import type { ComponentChildren } from "preact";
import { Icon } from "../../../icon.tsx";
import { messages } from "../../../messages.ts";
import { navigate } from "../../../navigate.ts";

/**
 * The sidebar panel shell: a light panel that pushes the screen aside (never
 * covers it), with a title and a close button. Each panel route renders its
 * content inside one; closing navigates back to /a8/emu (replace).
 */
export function PanelFrame({
	title,
	children,
}: {
	title: string;
	children: ComponentChildren;
}) {
	return (
		<aside class="flex max-h-[70vh] w-full shrink-0 flex-col overflow-hidden bg-white p-4 text-neutral-800 sm:h-full sm:max-h-none sm:w-1/4 sm:min-w-96 sm:max-w-xl">
			<div class="mb-4 flex shrink-0 items-center justify-between">
				<span class="text-lg font-semibold">{title}</span>
				<button
					type="button"
					class="px-1 text-neutral-500 hover:text-neutral-900"
					aria-label={messages.sidebar.close}
					title={messages.sidebar.close}
					onClick={() => navigate("/a8/emu", { replace: true })}
				>
					<Icon name="close" />
				</button>
			</div>
			{children}
		</aside>
	);
}
