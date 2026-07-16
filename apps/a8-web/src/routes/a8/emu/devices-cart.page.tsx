import { useState } from "preact/hooks";
import { messages } from "../../../messages.ts";
import { navigate } from "../../../navigate.ts";
import { OnOff } from "../../../settings-controls.tsx";
import { DevicesFrame, IconAction } from "./devices-frame.tsx";
import { useEmu } from "./emu-context.ts";

// /a8/emu/devices/cart - the devices view's Cart tab: the cartridge slot,
// drive-row mechanics but simpler. Attaching and ejecting reboot - a
// cartridge is memory-mapped and only takes effect at reset. On the 400/800
// an enabled BASIC occupies the slot like a real cart; ejecting it disables
// BASIC. Below it, the 800's right slot: no picker and no empty state - a
// right-slot image lands there on any insert gesture (in addition to the
// normal slot; a normal insert ejects both), so the row only shows with a
// cart in it, eject-only. Then the per-cart extras: the R-Time 8
// passthrough clock today; flash write-enable one day - and with flashing,
// carts become modifiable media too.
export default function DevicesCartPage() {
	const { host } = useEmu();
	const slot = host.cartSlot.value;
	const rightSlot = host.rightCartSlot.value;
	const m = messages.devices;
	// Drop target, like a drive row (stopPropagation keeps the window-level
	// drop from also booting the file).
	const [dragOver, setDragOver] = useState(false);
	return (
		<DevicesFrame active="cart">
			<div class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
				<div class="flex items-center pl-1">
					<button
						type="button"
						class="ml-auto text-sm text-neutral-500 hover:underline"
						onClick={() => navigate("/a8/emu/library?type=cart")}
					>
						{m.cartLibrary}
					</button>
				</div>
				<div
					class={`flex items-center gap-2 rounded-sm p-1 ${
						dragOver ? "bg-neutral-200" : "hover:bg-neutral-50"
					}`}
					onDragOver={(event) => {
						event.preventDefault();
						event.stopPropagation();
						setDragOver(true);
					}}
					onDragLeave={() => setDragOver(false)}
					onDrop={(event) => {
						event.preventDefault();
						event.stopPropagation();
						setDragOver(false);
						const file = event.dataTransfer?.files[0];
						if (file) {
							void host.attachCartridgeFile(file, { keepPanel: true });
						}
					}}
				>
					<span class="w-10 shrink-0 text-sm font-medium text-neutral-700">
						Cart
					</span>
					{slot ? (
						<>
							{/* The name links to the cart's library page; BASIC in the
							    400/800 slot has none - plain text. */}
							{slot.sourceId ? (
								<button
									type="button"
									class="min-w-0 flex-1 truncate text-left text-sm text-neutral-800 hover:underline"
									title={slot.name}
									onClick={() =>
										navigate(
											`/a8/emu/library/${encodeURIComponent(slot.sourceId!)}` +
												`?back=${encodeURIComponent("/a8/emu/devices/cart")}`,
										)
									}
								>
									{slot.name}
								</button>
							) : (
								<span
									class="min-w-0 flex-1 truncate text-sm text-neutral-800"
									title={slot.name}
								>
									{slot.name}
								</span>
							)}
							<div class="flex shrink-0 items-center gap-1.5">
								<IconAction
									name="folder-open"
									title={m.openFromComputer}
									onClick={() => host.pickAttachCartridge()}
								/>
								<IconAction
									name="close"
									title={m.eject}
									onClick={() => host.detachCartridge()}
								/>
							</div>
						</>
					) : (
						<>
							<button
								type="button"
								class="flex-1 truncate text-left text-sm text-neutral-400 hover:text-neutral-600 hover:underline"
								title={m.openFromComputer}
								onClick={() => host.pickAttachCartridge()}
							>
								{m.driveEmpty}
							</button>
							<IconAction
								name="folder-open"
								title={m.openFromComputer}
								onClick={() => host.pickAttachCartridge()}
							/>
						</>
					)}
				</div>
				{rightSlot && (
					<div class="flex items-center gap-2 rounded-sm p-1 hover:bg-neutral-50">
						{/* "Right" is a slot name like "Cart" above - kept inline. */}
						<span class="w-10 shrink-0 text-sm font-medium text-neutral-700">
							Right
						</span>
						{rightSlot.sourceId ? (
							<button
								type="button"
								class="min-w-0 flex-1 truncate text-left text-sm text-neutral-800 hover:underline"
								title={rightSlot.name}
								onClick={() =>
									navigate(
										`/a8/emu/library/${encodeURIComponent(rightSlot.sourceId!)}` +
											`?back=${encodeURIComponent("/a8/emu/devices/cart")}`,
									)
								}
							>
								{rightSlot.name}
							</button>
						) : (
							<span
								class="min-w-0 flex-1 truncate text-sm text-neutral-800"
								title={rightSlot.name}
							>
								{rightSlot.name}
							</span>
						)}
						<div class="flex shrink-0 items-center gap-1.5">
							<IconAction
								name="close"
								title={m.eject}
								onClick={() => host.detachRightCartridge()}
							/>
						</div>
					</div>
				)}
				{/* The R-Time 8 passthrough clock (default: unplugged). Isolation
				    (default on, effective only while plugged in) claims
				    $D5B8-$D5BF for the clock so it works even under carts whose
				    control decode spans the page (Atarimax flash, OSS, ...).
				    Unisolated it's hardware-faithful: over such a cart the
				    clock suspends itself (both would drive the bus) - say so
				    instead of leaving a dead clock unexplained. */}
				<div class="mt-4 flex flex-col gap-2">
					<h3 class="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
						{m.rtime8}
					</h3>
					<OnOff
						label={m.rtime8Enable}
						value={host.rtime8.value}
						onSet={(on) => host.setRtime8(on)}
					/>
					<OnOff
						label={m.rtime8Isolate}
						value={host.rtime8Shield.value}
						onSet={(on) => host.setRtime8Shield(on)}
					/>
					{host.rtime8.value && host.rtime8Blocked.value && (
						<p class="pl-1 text-sm text-neutral-500">{m.rtime8Blocked}</p>
					)}
				</div>
			</div>
		</DevicesFrame>
	);
}
