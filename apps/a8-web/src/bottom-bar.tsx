import type { EmulatorHost } from "./host.ts";
import { messages } from "./messages.ts";

/** The bottom status bar: the attached cartridge/disks and a crash indicator. */
export function BottomBar({ host }: { host: EmulatorHost }) {
	const { cartridge, drives } = host.attachments.value;
	const crashed = host.crashed.value;
	const leds = host.leds.value;

	return (
		<footer class="flex h-7 shrink-0 items-center gap-4 px-3 text-sm text-neutral-400">
			<div class="flex min-w-0 flex-1 items-center gap-4">
				{cartridge && (
					<span class="truncate">
						{messages.bottomBar.cartridge} {cartridge}
					</span>
				)}
				{drives.map(
					(name, index) =>
						name && (
							<span key={index} class="truncate">
								D{index + 1}: {name}
							</span>
						),
				)}
			</div>
			{leds && (
				<div class="flex items-center gap-2 font-mono text-xs">
					<span class={leds[0] ? "text-red-500" : "text-neutral-700"}>L1</span>
					<span class={leds[1] ? "text-red-500" : "text-neutral-700"}>L2</span>
				</div>
			)}
			<div class="flex min-w-0 flex-1 items-center justify-end">
				{crashed && (
					<span class="truncate font-semibold text-red-500">
						{messages.bottomBar.crashed}
					</span>
				)}
			</div>
		</footer>
	);
}
