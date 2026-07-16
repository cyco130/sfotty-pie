import type { EmulatorHost } from "./host.ts";
import { messages } from "./messages.ts";
import { navigate } from "./navigate.ts";

/** The bottom status bar: the attached cartridge and D1: disk (the bootable
 *  media), each linking to its devices tab, and a crash indicator. Other
 *  mounts (the right cart, disks in D2:-D8:) fold into a single "+n" chip -
 *  every mount stays discoverable without the labels crowding a phone-width
 *  bar. With nothing attached, a plain link to the devices view takes the
 *  spot. */
export function BottomBar({ host }: { host: EmulatorHost }) {
	const { cartridge, drives } = host.attachments.value;
	const d1 = drives[0] ?? null;
	// The mounts the two headline labels don't cover. The chip lands on the
	// tab of what it hides: the drive bank when any hidden disk is among
	// them, else the cart tab (the right cart is the only hidden item).
	const hiddenDisks = drives.slice(1).filter((name) => name !== null).length;
	const hidden = hiddenDisks + (host.rightCartSlot.value ? 1 : 0);
	const crashed = host.crashed.value;
	const leds = host.leds.value;

	return (
		<footer class="flex h-7 shrink-0 items-center gap-4 px-3 text-sm text-neutral-400">
			<div class="flex min-w-0 flex-1 items-center gap-4">
				{cartridge && (
					<button
						type="button"
						class="truncate hover:text-neutral-200 hover:underline"
						onClick={() => navigate("/a8/emu/devices/cart", { replace: true })}
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
				{hidden > 0 && (
					<button
						type="button"
						class="shrink-0 rounded-sm bg-neutral-800 px-1.5 text-xs/5 hover:text-neutral-200"
						title={messages.bottomBar.moreAttached(hidden)}
						aria-label={messages.bottomBar.moreAttached(hidden)}
						onClick={() =>
							hiddenDisks > 0
								? host.showPanel("devices")
								: navigate("/a8/emu/devices/cart", { replace: true })
						}
					>
						+{hidden}
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
