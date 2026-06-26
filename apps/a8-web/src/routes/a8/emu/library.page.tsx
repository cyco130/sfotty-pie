import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
	addFiles,
	importProgress,
	libraryEntries,
	readyLibrary,
} from "../../../images/library.ts";
import type { ImageEntry, ImageType } from "../../../images/metadata.ts";
import { messages } from "../../../messages.ts";
import { navigate } from "../../../navigate.ts";
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

type SortKey = "name" | "type";
const SORT_KEYS: readonly SortKey[] = ["name", "type"];
const TYPE_VALUES: readonly ImageType[] = ["os", "cart", "disk", "xex"];

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

// Compare by the chosen key, then by name as a stable tiebreak.
function comparator(key: SortKey): (a: ImageEntry, b: ImageEntry) => number {
	const byName = (a: ImageEntry, b: ImageEntry) =>
		a.user.displayName.localeCompare(b.user.displayName);
	switch (key) {
		case "name":
			return byName;
		case "type":
			return (a, b) =>
				a.derived.type.localeCompare(b.derived.type) || byName(a, b);
	}
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
		"sort",
		"dir",
		"page",
	]);

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
	const sortKey: SortKey = SORT_KEYS.includes(params.sort as SortKey)
		? (params.sort as SortKey)
		: "name";
	const desc = params.dir === "desc";
	const typeFilter = TYPE_VALUES.includes(params.type as ImageType)
		? (params.type as ImageType)
		: "";
	const sourceFilter =
		params.source === "builtin" || params.source === "user"
			? params.source
			: "";
	const query = params.q.trim().toLowerCase();

	const entries = libraryEntries.value;

	// Sort once per (entries, key, dir); filtering below preserves order, so
	// typing in the filter never re-sorts.
	const sorted = useMemo(() => {
		const cmp = comparator(sortKey);
		const arr = [...entries].sort(cmp);
		return desc ? arr.reverse() : arr;
	}, [entries, sortKey, desc]);

	const filtered = sorted.filter(
		(e) =>
			(typeFilter === "" || e.derived.type === typeFilter) &&
			(sourceFilter === "" || e.source === sourceFilter) &&
			(query === "" || e.user.displayName.toLowerCase().includes(query)),
	);

	const total = filtered.length;
	const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
	const page = Math.min(Math.max(1, Number(params.page) || 1), pages);
	const start = (page - 1) * PAGE_SIZE;
	const rows = filtered.slice(start, start + PAGE_SIZE);

	const toggleSort = (key: SortKey): void => {
		const nextDesc = key === sortKey ? !desc : false;
		setParams({ sort: key, dir: nextDesc ? "desc" : null, page: null });
	};
	const goToPage = (next: number): void =>
		setParams({ page: next > 1 ? String(next) : null });

	const sortHeader = (
		key: SortKey,
		label: string,
		cls = "",
	): preact.JSX.Element => (
		<th class={`px-2 py-1.5 font-medium ${cls}`}>
			<button
				type="button"
				class="inline-flex items-center gap-1 hover:text-neutral-800"
				onClick={() => toggleSort(key)}
			>
				{label}
				{sortKey === key && (
					<span aria-hidden class="text-[9px]">
						{desc ? "▼" : "▲"}
					</span>
				)}
			</button>
		</th>
	);

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
								setParams({
									type: event.currentTarget.value || null,
									page: null,
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
				</div>

				{total === 0 ? (
					<p class="text-sm text-neutral-400">{messages.library.noMatches}</p>
				) : (
					<table class="w-full table-fixed border-collapse text-sm">
						<thead class="border-b border-neutral-200 text-left text-xs tracking-wide text-neutral-500 uppercase">
							<tr>
								{sortHeader("name", messages.library.columns.name)}
								{sortHeader("type", messages.library.columns.type, "w-16")}
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
									<td class="px-2 py-1 text-neutral-500">
										{messages.library.typeShort[entry.derived.type]}
									</td>
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
			</div>
		</PanelFrame>
	);
}
