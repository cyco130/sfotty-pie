import type { VNode } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Icon } from "../../../icon.tsx";
import {
	addFiles,
	importProgress,
	libraryEntries,
	readyLibrary,
} from "../../../images/library.ts";
import type { DerivedMeta, ImageType } from "../../../images/metadata.ts";
import { messages } from "../../../messages.ts";
import { navigate } from "../../../navigate.ts";
import { TypePill } from "../../../type-pill.tsx";
import { useUrlParams } from "../../../url-params.ts";
import { useEmu } from "./emu-context.ts";
import { PanelFrame } from "./panel-frame.tsx";

// /a8/emu/library — the image library: an uploader over a sortable, filterable,
// paged table of every image (built-in ∪ your uploads). Sort/filter/page state
// lives in the URL query so it survives reload and is shareable. The whole
// (metadata-only) set is held in memory and sorted/filtered/sliced in JS —
// fine into the tens of thousands; the IndexedDB indexes are the escape hatch
// if a collection ever outgrows that. Selecting which image fills a slot is the
// separate ROM-preferences panel.

const PAGE_SIZE = 100;

const TYPE_VALUES: readonly ImageType[] = ["os", "cart", "disk", "xex"];

// The attribute filters a detail value can set (URL params); only meaningful
// within the matching type-filtered view.
type AttrParam = "sizeClass" | "cartType" | "sectors" | "bps";
type SetAttr = (param: AttrParam, value: number) => void;

// A clickable detail value: sets an attribute filter; underlines on hover.
function FilterValue({
	value,
	onClick,
}: {
	value: number | string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			class="cursor-pointer hover:underline"
			onClick={onClick}
		>
			{value}
		</button>
	);
}

interface DetailCol {
	head: string;
	width: string;
	render: (kind: DerivedMeta, set: SetAttr) => VNode;
}

// The extra table columns for a type-filtered view (the pill is dropped — the
// type is known from the filter): OS size class, cartridge subtype, disk
// geometry (sectors × bytes-per-sector, each clickable). Clicking a value sets
// that attribute filter. Each render guards on the kind, though the active
// filter guarantees it.
function detailCols(type: ImageType): DetailCol[] {
	switch (type) {
		case "os":
			return [
				{
					head: messages.library.columns.size,
					width: "w-14",
					render: (k, set) =>
						k.type === "os" ? (
							<FilterValue
								value={`${k.sizeClass}K`}
								onClick={() => set("sizeClass", k.sizeClass)}
							/>
						) : (
							<></>
						),
				},
			];
		case "cart":
			return [
				{
					head: messages.library.columns.type,
					width: "w-14",
					render: (k, set) =>
						k.type === "cart" ? (
							<FilterValue
								value={k.cartType}
								onClick={() => set("cartType", k.cartType)}
							/>
						) : (
							<></>
						),
				},
			];
		case "disk":
			return [
				{
					head: messages.library.detail.geometry,
					width: "w-24",
					render: (k, set) =>
						k.type === "disk" ? (
							<>
								<FilterValue
									value={k.sectors}
									onClick={() => set("sectors", k.sectors)}
								/>
								×
								<FilterValue
									value={k.sectorSize}
									onClick={() => set("bps", k.sectorSize)}
								/>
							</>
						) : (
							<></>
						),
				},
			];
		case "xex":
			return [];
	}
}

// Read a directory reader's entries — it returns them in batches, so call until
// it yields none.
function readEntries(
	reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
	return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

// Collect files from a dropped entry, recursing into directories.
async function walkEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
	if (entry.isFile) {
		out.push(
			await new Promise<File>((resolve, reject) =>
				(entry as FileSystemFileEntry).file(resolve, reject),
			),
		);
	} else if (entry.isDirectory) {
		const reader = (entry as FileSystemDirectoryEntry).createReader();
		let batch = await readEntries(reader);
		while (batch.length > 0) {
			await Promise.all(batch.map((child) => walkEntry(child, out)));
			batch = await readEntries(reader);
		}
	}
}

// Every file from a drop, recursing into any dropped folders. Entries are
// grabbed synchronously — the DataTransferItems are only valid during the drop
// event — then traversed async. Falls back to the flat file list where the
// entry API is unavailable.
async function filesFromDrop(transfer: DataTransfer): Promise<File[]> {
	const entries = Array.from(transfer.items)
		.map((item) => item.webkitGetAsEntry())
		.filter((entry): entry is FileSystemEntry => entry !== null);
	if (entries.length === 0) return Array.from(transfer.files);
	const out: File[] = [];
	await Promise.all(entries.map((entry) => walkEntry(entry, out)));
	return out;
}

export default function LibraryPage() {
	const { host } = useEmu();
	const inputRef = useRef<HTMLInputElement>(null);
	const folderInputRef = useRef<HTMLInputElement>(null);
	const [dragging, setDragging] = useState(false);

	// `webkitdirectory` makes the second picker choose a folder (all files in it).
	// Set imperatively — it isn't in the JSX input attribute types.
	useEffect(() => {
		if (folderInputRef.current) folderInputRef.current.webkitdirectory = true;
	}, []);
	const [params, setParams] = useUrlParams([
		"q",
		"type",
		"source",
		"page",
		"sizeClass",
		"cartType",
		"sectors",
		"bps",
	]);

	// Set / clear an attribute filter (a detail value, or its chip's ×). The
	// computed key is a known param, but TS can't see that through the union.
	const setAttr: SetAttr = (param, value) =>
		setParams({ [param]: String(value), page: null } as Parameters<
			typeof setParams
		>[0]);
	const clearAttr = (param: AttrParam): void =>
		setParams({ [param]: null, page: null } as Parameters<typeof setParams>[0]);

	// Pull the user's uploads into the merged list (built-ins are already there).
	useEffect(() => void readyLibrary(), []);

	// Orchestrate an import: show "Preparing…" immediately (the folder walk has no
	// count and can take a moment at thousands of files), collect the files, then
	// ingest them live. The top-level indicator (app.tsx) tracks it even if this
	// panel is closed mid-import; the summary toast reports the elapsed time.
	const runImport = async (collect: () => Promise<File[]>): Promise<void> => {
		if (importProgress.value) return; // an import is already running
		importProgress.value = { phase: "preparing" };
		const start = performance.now();
		let files: File[];
		try {
			files = await collect();
		} catch {
			importProgress.value = null;
			return;
		}
		if (files.length === 0) {
			importProgress.value = null;
			return;
		}
		const result = await addFiles(files); // takes over the indicator, clears it
		const seconds = (performance.now() - start) / 1000;
		host.toast(
			messages.library.uploaded(
				result.added,
				result.deduped,
				result.failed,
				seconds,
			),
			result.failed > 0 ? "warning" : "info",
		);
	};

	// Read view state from the URL, ignoring anything malformed.
	const typeFilter = TYPE_VALUES.includes(params.type as ImageType)
		? (params.type as ImageType)
		: "";
	const sourceFilter =
		params.source === "builtin" || params.source === "user"
			? params.source
			: "";
	const query = params.q.trim().toLowerCase();

	// Auto-added (transient) images are hidden from the curated list; recents
	// surface them later.
	const allEntries = libraryEntries.value;
	const entries = allEntries.filter((entry) => !entry.transient);
	const hasUploads = allEntries.some((entry) => entry.source === "user");

	// Fixed alphabetical order (sorting was dropped — direction wasn't
	// meaningful); filtering below preserves order, so typing never re-sorts.
	const sorted = useMemo(
		() =>
			[...entries].sort((a, b) =>
				a.user.displayName.localeCompare(b.user.displayName),
			),
		[entries],
	);

	const filtered = sorted.filter((e) => {
		if (typeFilter !== "" && e.derived.type !== typeFilter) return false;
		if (sourceFilter !== "" && e.source !== sourceFilter) return false;
		if (query !== "" && !e.user.displayName.toLowerCase().includes(query))
			return false;
		// Attribute filters — apply only to entries of the matching kind.
		const k = e.derived;
		if (params.sizeClass && k.type === "os")
			return String(k.sizeClass) === params.sizeClass;
		if (params.cartType && k.type === "cart")
			return String(k.cartType) === params.cartType;
		if (k.type === "disk") {
			if (params.sectors && String(k.sectors) !== params.sectors) return false;
			if (params.bps && String(k.sectorSize) !== params.bps) return false;
		}
		return true;
	});

	const total = filtered.length;
	const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
	const page = Math.min(Math.max(1, Number(params.page) || 1), pages);
	const start = (page - 1) * PAGE_SIZE;
	const rows = filtered.slice(start, start + PAGE_SIZE);

	const goToPage = (next: number): void =>
		setParams({ page: next > 1 ? String(next) : null });

	// All-types is a flat list with leading type pills; a type-filtered view is a
	// table whose extra columns carry that type's attributes.
	const cols = typeFilter === "" ? [] : detailCols(typeFilter);

	// Active attribute filters, as dismissable chips (only the current type's).
	const attrFilters: { param: AttrParam; label: string }[] = [];
	if (typeFilter === "os" && params.sizeClass)
		attrFilters.push({ param: "sizeClass", label: `${params.sizeClass}K` });
	if (typeFilter === "cart" && params.cartType)
		attrFilters.push({
			param: "cartType",
			label: `${messages.library.columns.type} ${params.cartType}`,
		});
	if (typeFilter === "disk" && params.sectors)
		attrFilters.push({
			param: "sectors",
			label: `${params.sectors} ${messages.library.detail.sectors}`,
		});
	if (typeFilter === "disk" && params.bps)
		attrFilters.push({
			param: "bps",
			label: `${params.bps} ${messages.library.detail.bps}`,
		});

	return (
		<PanelFrame title={messages.library.title}>
			<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
				<div
					class={`rounded border-2 border-dashed p-3 text-center text-sm ${
						dragging
							? "border-emerald-400 bg-emerald-50 text-emerald-700"
							: "border-neutral-300 text-neutral-500"
					}`}
					onDragOver={(event) => {
						event.preventDefault();
						setDragging(true);
					}}
					onDragLeave={() => setDragging(false)}
					onDrop={(event) => {
						event.preventDefault();
						// Keep the drop here — don't let it bubble to the window handler
						// that boots a dropped file (app.tsx).
						event.stopPropagation();
						setDragging(false);
						const transfer = event.dataTransfer;
						if (transfer) void runImport(() => filesFromDrop(transfer));
					}}
				>
					{messages.library.drop}{" "}
					<button
						type="button"
						class="font-medium text-neutral-800 underline hover:text-neutral-900"
						onClick={() => inputRef.current?.click()}
					>
						{messages.library.browse}
					</button>{" "}
					·{" "}
					<button
						type="button"
						class="font-medium text-neutral-800 underline hover:text-neutral-900"
						onClick={() => folderInputRef.current?.click()}
					>
						{messages.library.browseFolder}
					</button>
					<input
						ref={inputRef}
						type="file"
						multiple
						class="hidden"
						onChange={(event) => {
							const files = Array.from(event.currentTarget.files ?? []);
							event.currentTarget.value = ""; // allow re-picking the same file
							void runImport(async () => files);
						}}
					/>
					<input
						ref={folderInputRef}
						type="file"
						class="hidden"
						onChange={(event) => {
							const files = Array.from(event.currentTarget.files ?? []);
							event.currentTarget.value = "";
							void runImport(async () => files);
						}}
					/>
				</div>

				<div class="flex flex-col gap-2">
					<input
						type="text"
						value={params.q}
						placeholder={messages.library.search}
						autocapitalize="off"
						autocomplete="off"
						spellcheck={false}
						class="w-full rounded border border-neutral-300 px-2 py-1 text-sm text-neutral-900 placeholder-neutral-400 outline-none focus:border-neutral-500"
						onInput={(event) =>
							setParams({ q: event.currentTarget.value || null, page: null })
						}
					/>
					<div class="flex gap-2">
						<select
							aria-label={messages.library.columns.type}
							value={typeFilter}
							class="flex-1 rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-800"
							onChange={(event) =>
								// Changing the type clears any attribute filters — they
								// only apply within their own type.
								setParams({
									type: event.currentTarget.value || null,
									page: null,
									sizeClass: null,
									cartType: null,
									sectors: null,
									bps: null,
								})
							}
						>
							<option value="">{messages.library.allTypes}</option>
							{TYPE_VALUES.map((type) => (
								<option key={type} value={type}>
									{messages.library.typeName[type]}
								</option>
							))}
						</select>
						<select
							aria-label={messages.library.columns.source}
							value={sourceFilter}
							class="flex-1 rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-800"
							onChange={(event) =>
								setParams({
									source: event.currentTarget.value || null,
									page: null,
								})
							}
						>
							<option value="">{messages.library.allSources}</option>
							<option value="builtin">{messages.library.sourceBuiltin}</option>
							<option value="user">{messages.library.sourceUser}</option>
						</select>
					</div>
					{attrFilters.length > 0 && (
						<div class="flex flex-wrap gap-1.5">
							{attrFilters.map((f) => (
								<span
									key={f.param}
									class="inline-flex items-center gap-1 rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700"
								>
									{f.label}
									<button
										type="button"
										aria-label={messages.library.removeFilter}
										class="cursor-pointer text-neutral-400 hover:text-neutral-700"
										onClick={() => clearAttr(f.param)}
									>
										<Icon name="close" class="size-3" />
									</button>
								</span>
							))}
						</div>
					)}
				</div>

				{total === 0 ? (
					<p class="text-sm text-neutral-400">{messages.library.noMatches}</p>
				) : typeFilter === "" ? (
					<ul class="flex flex-col text-sm">
						{rows.map((entry) => (
							<li key={entry.id}>
								<button
									type="button"
									class="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-neutral-100"
									onClick={() =>
										navigate(`/a8/emu/library/${encodeURIComponent(entry.id)}`)
									}
								>
									<TypePill type={entry.derived.type} />
									<span
										class="min-w-0 flex-1 truncate text-neutral-800"
										title={entry.user.displayName}
									>
										{entry.user.displayName}
									</span>
								</button>
							</li>
						))}
					</ul>
				) : (
					<table class="w-full table-fixed border-collapse text-sm">
						<thead class="border-b border-neutral-200 text-left text-xs tracking-wide text-neutral-500 uppercase">
							<tr>
								<th class="px-2 py-1.5 font-medium">
									{messages.library.columns.name}
								</th>
								{cols.map((c) => (
									<th
										key={c.head}
										class={`px-2 py-1.5 text-right font-medium ${c.width}`}
									>
										{c.head}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{rows.map((entry) => (
								<tr key={entry.id} class="border-b border-neutral-100">
									<td class="truncate px-2 py-1" title={entry.user.displayName}>
										<button
											type="button"
											class="block w-full truncate text-left text-neutral-800 hover:underline"
											onClick={() =>
												navigate(
													`/a8/emu/library/${encodeURIComponent(entry.id)}`,
												)
											}
										>
											{entry.user.displayName}
										</button>
									</td>
									{cols.map((c) => (
										<td
											key={c.head}
											class="px-2 py-1 text-right tabular-nums text-neutral-500"
										>
											{c.render(entry.derived, setAttr)}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				)}

				{pages > 1 && (
					<div class="flex shrink-0 items-center justify-between gap-2 text-xs text-neutral-500">
						<span>
							{messages.library.range(start + 1, start + rows.length, total)}
						</span>
						<div class="flex gap-1">
							<button
								type="button"
								disabled={page <= 1}
								class="rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-100 disabled:opacity-40"
								onClick={() => goToPage(page - 1)}
							>
								{messages.library.prev}
							</button>
							<button
								type="button"
								disabled={page >= pages}
								class="rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-100 disabled:opacity-40"
								onClick={() => goToPage(page + 1)}
							>
								{messages.library.next}
							</button>
						</div>
					</div>
				)}

				{hasUploads && (
					<button
						type="button"
						class="mt-1 self-start text-xs text-red-600 hover:underline"
						onClick={() => host.clearLibrary()}
					>
						{messages.library.clear}
					</button>
				)}
			</div>
		</PanelFrame>
	);
}
