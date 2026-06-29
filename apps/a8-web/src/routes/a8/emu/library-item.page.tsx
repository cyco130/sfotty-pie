import {
	canonicalize,
	CART_TYPES,
	detectFirmware,
	type FirmwareInfo,
} from "@sfotty-pie/a8";
import { useEffect, useState } from "preact/hooks";
import { Icon } from "../../../icon.tsx";
import {
	getImage,
	getImageBytes,
	readyLibrary,
	removeImage,
	updateUserMeta,
} from "../../../images/library.ts";
import type {
	ImageEntry,
	ImageSlot,
	ImageType,
} from "../../../images/metadata.ts";
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

// An OS ROM's target machine family, from its size class (10K → 400/800,
// 16K → the XL/XE class). Hardware tokens, kept inline.
function osTypeLabel(sizeClass: number): string {
	return sizeClass === 10 ? "400/800" : "XL/XE";
}

// A canonical cartridge blob is a 16-byte CART header + the raw ROM; firmware
// detection wants the unwrapped ROM (built-ins already serve it raw).
function isCar(bytes: Uint8Array): boolean {
	return (
		bytes.length > 16 &&
		bytes[0] === 0x43 && // C
		bytes[1] === 0x41 && // A
		bytes[2] === 0x52 && // R
		bytes[3] === 0x54 // T
	);
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
			return [{ label: f.osType, value: osTypeLabel(k.sizeClass) }];
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

// Editable name with an explicit Save (shown only once the text differs), plus a
// confirming toast — so a rename never happens silently. Keyed by id by the
// caller so the draft resets when switching images.
function NameEditor({
	entry,
	toast,
}: {
	entry: ImageEntry;
	toast: (message: string) => void;
}) {
	const [draft, setDraft] = useState(entry.user.displayName);
	const name = draft.trim();
	const dirty = name !== "" && name !== entry.user.displayName;
	const save = (): void => {
		if (!dirty) return;
		void updateUserMeta(entry.id, { displayName: name });
		toast(messages.library.renamed(name));
	};
	return (
		<div class="flex flex-col gap-1">
			<span class="text-xs text-neutral-500">
				{messages.library.fields.name}
			</span>
			<div class="flex gap-2">
				<input
					type="text"
					value={draft}
					class="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-sm font-medium text-neutral-900 outline-none focus:border-neutral-500"
					onInput={(event) => setDraft(event.currentTarget.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") save();
					}}
				/>
				{dirty && (
					<button
						type="button"
						class="shrink-0 rounded bg-neutral-800 px-3 py-1 text-sm text-white hover:bg-neutral-700"
						onClick={save}
					>
						{messages.library.save}
					</button>
				)}
			</div>
		</div>
	);
}

// Free-form tags as removable chips plus an add field. Tags are normalized
// (trimmed, lower-cased, deduped); changes apply immediately (the chip is the
// feedback). Keyed by id by the caller so the draft resets between images.
function TagEditor({ entry }: { entry: ImageEntry }) {
	const [draft, setDraft] = useState("");
	const tags = entry.user.tags ?? [];
	const add = (raw: string): void => {
		const tag = raw.trim().toLowerCase();
		setDraft("");
		if (tag && !tags.includes(tag)) {
			void updateUserMeta(entry.id, { tags: [...tags, tag] });
		}
	};
	const remove = (tag: string): void => {
		void updateUserMeta(entry.id, { tags: tags.filter((t) => t !== tag) });
	};
	return (
		<div class="flex flex-col gap-1">
			<span class="text-xs text-neutral-500">
				{messages.library.tags.label}
			</span>
			<div class="flex flex-wrap items-center gap-1">
				{tags.map((tag) => (
					<span
						key={tag}
						class="inline-flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-700"
					>
						{tag}
						<button
							type="button"
							aria-label={messages.library.tags.remove}
							class="text-neutral-400 hover:text-neutral-700"
							onClick={() => remove(tag)}
						>
							<Icon name="close" class="size-3" />
						</button>
					</span>
				))}
				<input
					type="text"
					value={draft}
					placeholder={messages.library.tags.add}
					autocapitalize="off"
					class="min-w-24 flex-1 rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-900 placeholder-neutral-400 outline-none focus:border-neutral-500"
					onInput={(event) => setDraft(event.currentTarget.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" || event.key === ",") {
							event.preventDefault();
							add(draft);
						}
					}}
					onBlur={() => add(draft)}
				/>
			</div>
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

	// Detect well-known firmware from the bytes — only OS/cartridge images can
	// be one, so other types skip the (potentially large) read.
	const [firmware, setFirmware] = useState<FirmwareInfo | null>(null);
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				await readyLibrary();
				const e = getImage(id);
				if (e?.derived.type !== "os" && e?.derived.type !== "cart") {
					if (!cancelled) setFirmware(null);
					return;
				}
				const bytes = await getImageBytes(id);
				const rom = isCar(bytes) ? bytes.subarray(16) : bytes;
				if (!cancelled) setFirmware(detectFirmware(rom));
			} catch {
				if (!cancelled) setFirmware(null);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [id]);

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

	// Slot flags apply to standard-8K carts (CART type 1) — the kind the BASIC
	// and built-in-game ROM slots accept.
	const isStdCart =
		entry.derived.type === "cart" && entry.derived.cartType === 1;
	const slots = entry.user.slots ?? [];

	const toggleSlot = (slot: ImageSlot, on: boolean): void => {
		const next = on
			? [...slots.filter((s) => s !== slot), slot]
			: slots.filter((s) => s !== slot);
		void updateUserMeta(entry.id, { slots: next });
	};

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

				<NameEditor
					key={entry.id}
					entry={entry}
					toast={(message) => host.toast(message)}
				/>
				<TagEditor key={`tags-${entry.id}`} entry={entry} />

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

				{isStdCart && (
					<div class="flex flex-col gap-1.5">
						<h3 class="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
							{messages.library.slots.title}
						</h3>
						<label class="flex items-center gap-2 text-sm text-neutral-800">
							<input
								type="checkbox"
								checked={slots.includes("basic")}
								onChange={(event) =>
									toggleSlot("basic", event.currentTarget.checked)
								}
							/>
							{messages.library.slots.basic}
						</label>
						<label class="flex items-center gap-2 text-sm text-neutral-800">
							<input
								type="checkbox"
								checked={slots.includes("game")}
								onChange={(event) =>
									toggleSlot("game", event.currentTarget.checked)
								}
							/>
							{messages.library.slots.game}
						</label>
					</div>
				)}

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

				{firmware && (
					<div class="flex flex-col gap-1 border-t border-neutral-200 pt-3">
						<h3 class="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
							{messages.library.knownTitle}
						</h3>
						<p class="text-sm font-medium text-neutral-800">{firmware.name}</p>
						<p class="text-xs text-neutral-500">{firmware.origin}</p>
						{firmware.notes && (
							<p class="text-xs text-neutral-500">{firmware.notes}</p>
						)}
					</div>
				)}
			</div>
		</PanelFrame>
	);
}
