import type { EmulatorHost } from "./host.ts";

/** The bottom status bar: the booted image's name and a crash indicator. */
export function BottomBar({ host }: { host: EmulatorHost }) {
	const imageName = host.imageName.value;
	const crashed = host.crashed.value;

	return (
		<footer class="flex h-7 shrink-0 items-center gap-4 px-3 text-sm text-neutral-400">
			<span class="truncate">{imageName ?? ""}</span>
			{crashed && (
				<span class="ml-auto font-semibold text-red-500">
					CPU crashed (CIM)
				</span>
			)}
		</footer>
	);
}
