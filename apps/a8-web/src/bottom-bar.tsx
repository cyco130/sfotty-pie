import type { EmulatorHost } from "./host.ts";
import { messages } from "./messages.ts";

/** The bottom status bar: the attached cartridge and D1: disk (the bootable
 *  media; the full bank lives on the devices view these link to - one day
 *  the cart will link to its own tab) and a crash indicator. With nothing
 *  attached, a plain link to the devices view takes the spot. */
export function BottomBar({ host }: { host: EmulatorHost }) {
	const { cartridge, drives } = host.attachments.value;
	const d1 = drives[0] ?? null;
	const crashed = host.crashed.value;
	const leds = host.leds.value;

	return (
		<footer class="flex h-7 shrink-0 items-center gap-4 px-3 text-sm text-neutral-400">
			<div class="flex min-w-0 flex-1 items-center gap-4">
				{cartridge && (
					<button
						type="button"
						class="truncate hover:text-neutral-200 hover:underline"
						onClick={() => host.showPanel("devices")}
					>
						{messages.bottomBar.cartridge} {cartridge}
					</button>
				)}
				{d1 && (
					<button
						type="button"
						class="truncate hover:text-neutral-200 hover:underline"
						onClick={() => host.showPanel("devices")}
					>
						D1: {d1}
					</button>
				)}
				{!cartridge && !d1 && (
					<button
						type="button"
						class="truncate hover:text-neutral-200 hover:underline"
						onClick={() => host.showPanel("devices")}
					>
						{messages.bottomBar.devices}
					</button>
				)}
			</div>
			{leds && (
				<div class="flex items-center gap-2 font-mono text-xs">
					<span class={leds[0] ? "text-red-500" : "text-neutral-700"}>L1</span>
					<span class={leds[1] ? "text-red-500" : "text-neutral-700"}>L2</span>
				</div>
			)}
			<div class="flex min-w-0 flex-1 items-center justify-end gap-4">
				{!host.keyboardAttached.value && (
					<button
						type="button"
						class="truncate text-amber-500 hover:underline"
						title={messages.bottomBar.attachKeyboard}
						onClick={() => host.setKeyboardAttached(true)}
					>
						{messages.bottomBar.keyboardDetached}
					</button>
				)}
				{crashed && (
					<span class="truncate font-semibold text-red-500">
						{messages.bottomBar.crashed}
					</span>
				)}
			</div>
		</footer>
	);
}
