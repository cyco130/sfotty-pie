import type { EmulatorHost } from "./host.ts";

/** The bottom status bar: the attached cartridge/disks and a crash indicator. */
export function BottomBar({ host }: { host: EmulatorHost }) {
	const { cartridge, drives } = host.attachments.value;
	const crashed = host.crashed.value;

	return (
		<footer class="flex h-7 shrink-0 items-center gap-4 px-3 text-sm text-neutral-400">
			{cartridge && <span class="truncate">Cart: {cartridge}</span>}
			{drives.map(
				(name, index) =>
					name && (
						<span key={index} class="truncate">
							D{index + 1}: {name}
						</span>
					),
			)}
			{crashed && (
				<span class="ml-auto font-semibold text-red-500">
					CPU crashed (CIM)
				</span>
			)}
		</footer>
	);
}
