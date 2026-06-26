import { useEffect, useState } from "preact/hooks";
import {
	getImage,
	readyLibrary,
	removeImage,
} from "../../../images/library.ts";
import type { ImageEntry } from "../../../images/metadata.ts";
import { messages } from "../../../messages.ts";
import { navigate } from "../../../navigate.ts";
import { useEmu } from "./emu-context.ts";
import { PanelFrame } from "./panel-frame.tsx";

// /a8/emu/library/:id — one image's details and actions. Built-in or user;
// boot/attach run through the host, delete is user-only and returns to the list.

const LIBRARY = "/a8/emu/library";

function sizeLabel(bytes: number): string {
	return `${Math.round(bytes / 1024)}K`;
}

// The type plus its one discriminating fact, e.g. "Cartridge · CART 1".
function typeDetail(entry: ImageEntry): string {
	const name = messages.library.typeName;
	const derived = entry.derived;
	switch (derived.type) {
		case "os":
			return `${name.os} · ${derived.sizeClass}K`;
		case "cart":
			return `${name.cart} · CART ${derived.cartType}`;
		case "disk":
			return `${name.disk} · ${derived.sectorSize}B × ${derived.sectors}`;
		case "xex":
			return name.xex;
	}
}

function BackLink() {
	return (
		<button
			type="button"
			class="self-start text-xs text-neutral-500 hover:underline"
			onClick={() => navigate(LIBRARY, { replace: true })}
		>
			‹ {messages.library.title}
		</button>
	);
}

function Detail({ label, value }: { label: string; value: string }) {
	return (
		<div class="flex items-baseline justify-between gap-2 text-sm">
			<span class="shrink-0 text-neutral-500">{label}</span>
			<span class="truncate text-neutral-800" title={value}>
				{value}
			</span>
		</div>
	);
}

export default function LibraryItemPanel({ id: rawId }: { id: string }) {
	const { host } = useEmu();
	const [ready, setReady] = useState(false);
	useEffect(() => void readyLibrary().then(() => setReady(true)), []);

	let id = rawId;
	try {
		id = decodeURIComponent(rawId);
	} catch {
		/* keep the raw id if it isn't valid percent-encoding */
	}
	const entry = getImage(id); // reactive on the merged library

	if (!entry) {
		return (
			<PanelFrame title={messages.library.title}>
				<div class="flex min-h-0 flex-1 flex-col gap-3">
					<BackLink />
					<p class="text-sm text-neutral-400">
						{ready ? messages.library.notFound : messages.library.loading}
					</p>
				</div>
			</PanelFrame>
		);
	}

	const type = entry.derived.type;
	const canBoot = type === "cart" || type === "disk" || type === "xex";

	const remove = async (): Promise<void> => {
		await removeImage(entry.id);
		navigate(LIBRARY, { replace: true });
		host.toast(messages.library.deleted(entry.user.displayName));
	};

	const copyHash = (): void => {
		void navigator.clipboard?.writeText(entry.hash);
		host.toast(messages.toasts.copied);
	};

	return (
		<PanelFrame title={entry.user.displayName}>
			<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
				<BackLink />

				<div class="flex flex-col gap-1.5">
					<Detail
						label={messages.library.columns.source}
						value={
							entry.source === "builtin"
								? messages.library.sourceBuiltin
								: messages.library.sourceUser
						}
					/>
					<Detail
						label={messages.library.columns.type}
						value={typeDetail(entry)}
					/>
					<Detail
						label={messages.library.columns.size}
						value={sizeLabel(entry.size)}
					/>
					<div class="flex items-baseline justify-between gap-2 text-sm">
						<span class="shrink-0 text-neutral-500">
							{messages.library.hash}
						</span>
						<button
							type="button"
							class="truncate font-mono text-xs text-neutral-700 hover:underline"
							title={`${entry.hash} — ${messages.library.copyHash}`}
							onClick={copyHash}
						>
							{entry.hash.slice(0, 16)}…
						</button>
					</div>
				</div>

				<div class="flex flex-col gap-2">
					{canBoot && (
						<button
							type="button"
							class="w-full rounded bg-neutral-800 px-2 py-1.5 text-sm text-white hover:bg-neutral-700"
							onClick={() => void host.bootImage(entry.id)}
						>
							{messages.library.actions.boot}
						</button>
					)}
					{type === "disk" && (
						<button
							type="button"
							class="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm text-neutral-800 hover:bg-neutral-100"
							onClick={() => void host.attachDisk(entry.id)}
						>
							{messages.library.actions.attachDisk}
						</button>
					)}
					{type === "cart" && (
						<button
							type="button"
							class="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm text-neutral-800 hover:bg-neutral-100"
							onClick={() => void host.attachCartridge(entry.id)}
						>
							{messages.library.actions.attachCart}
						</button>
					)}
					{entry.source === "user" && (
						<button
							type="button"
							class="w-full rounded border border-red-300 px-2 py-1.5 text-sm text-red-700 hover:bg-red-50"
							onClick={() => void remove()}
						>
							{messages.library.actions.delete}
						</button>
					)}
				</div>
			</div>
		</PanelFrame>
	);
}
