import { canonicalize, CART_TYPES } from "@sfotty-pie/a8";
import { useEffect, useState } from "preact/hooks";
import {
	getImage,
	getImageBytes,
	readyLibrary,
	removeImage,
} from "../../../images/library.ts";
import type { ImageEntry, ImageType } from "../../../images/metadata.ts";
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

// Canonical download extension per type: a cartridge is a `.car`, an OS a raw
// `.rom`, a disk an `.atr`, an executable a `.xex`. Stored names carry no
// extension; this is added only on download.
const CANON_EXT: Record<ImageType, string> = {
	os: "rom",
	cart: "car",
	disk: "atr",
	xex: "xex",
};

// The per-type facts, each its own detail row (the kind itself is a separate
// "Type" row). A cartridge resolves to its full CART_TYPES name; xex has none.
function detailRows(entry: ImageEntry): { label: string; value: string }[] {
	const f = messages.library.fields;
	const k = entry.derived;
	switch (k.type) {
		case "os":
			return [{ label: f.sizeClass, value: `${k.sizeClass}K` }];
		case "cart":
			return [
				{
					label: f.cartType,
					value: CART_TYPES[k.cartType]?.name ?? `CART ${k.cartType}`,
				},
			];
		case "disk":
			return [
				{ label: f.sectors, value: String(k.sectors) },
				{ label: f.sectorSize, value: `${k.sectorSize} B` },
			];
		case "xex":
			return [];
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
		if (
			!window.confirm(messages.library.confirmDelete(entry.user.displayName))
		) {
			return;
		}
		await removeImage(entry.id);
		navigate(LIBRARY, { replace: true });
		host.toast(messages.library.deleted(entry.user.displayName));
	};

	const copyHash = (): void => {
		void navigator.clipboard?.writeText(entry.hash);
		host.toast(messages.toasts.copied);
	};

	const download = async (): Promise<void> => {
		const served = await getImageBytes(entry.id);
		// Download the canonical form — a raw built-in cart becomes a real `.car`.
		let bytes = served;
		try {
			const piece = canonicalize(served)[0];
			if (piece) bytes = piece.bytes;
		} catch {
			/* keep the served bytes if canonicalization fails */
		}
		const filename = `${entry.user.displayName}.${CANON_EXT[entry.derived.type]}`;
		const url = URL.createObjectURL(
			new Blob([bytes as BufferSource], { type: "application/octet-stream" }),
		);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = filename;
		anchor.click();
		URL.revokeObjectURL(url);
		host.toast(messages.toasts.saving(filename));
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
						value={messages.library.typeName[entry.derived.type]}
					/>
					{detailRows(entry).map((d) => (
						<Detail key={d.label} label={d.label} value={d.value} />
					))}
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
					<button
						type="button"
						class="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm text-neutral-800 hover:bg-neutral-100"
						onClick={() => void download()}
					>
						{messages.library.actions.download}
					</button>
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
