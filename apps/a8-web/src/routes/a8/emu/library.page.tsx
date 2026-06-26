import { useEffect, useRef, useState } from "preact/hooks";
import {
	addImage,
	libraryEntries,
	readyLibrary,
} from "../../../images/library.ts";
import type { ImageEntry, ImageType } from "../../../images/metadata.ts";
import { messages } from "../../../messages.ts";
import { useEmu } from "./emu-context.ts";
import { PanelFrame } from "./panel-frame.tsx";

// /a8/emu/library — the image library: an uploader plus a read-only list of
// every image (built-in ∪ your uploads), grouped by type and sorted by name.
// Deliberately minimal — the seed of what will become a unified
// view/edit/filter/sort table. Selecting which image fills a slot is the
// separate ROM-preferences panel.

const TYPE_ORDER: ImageType[] = ["os", "cart", "disk", "xex"];

function sizeLabel(bytes: number): string {
	return `${Math.round(bytes / 1024)}K`;
}

function Row({ entry }: { entry: ImageEntry }) {
	return (
		<li class="flex items-baseline justify-between gap-2 text-sm">
			<span class="flex min-w-0 items-center gap-1.5 text-neutral-800">
				<span class="truncate">{entry.user.displayName}</span>
				{entry.source === "builtin" && (
					<span class="shrink-0 rounded bg-neutral-100 px-1.5 text-[10px] font-medium tracking-wide text-neutral-500 uppercase">
						{messages.library.builtin}
					</span>
				)}
			</span>
			<span class="shrink-0 text-xs text-neutral-400">
				{sizeLabel(entry.size)}
			</span>
		</li>
	);
}

export default function LibraryPage() {
	const { host } = useEmu();
	const inputRef = useRef<HTMLInputElement>(null);
	const [dragging, setDragging] = useState(false);

	// Pull the user's uploads into the merged list (built-ins are already there).
	useEffect(() => void readyLibrary(), []);

	const handleFiles = async (files: FileList | null): Promise<void> => {
		if (!files || files.length === 0) return;
		let added = 0;
		let deduped = 0;
		const failed: string[] = [];
		for (const file of Array.from(files)) {
			try {
				const bytes = new Uint8Array(await file.arrayBuffer());
				const result = await addImage(bytes, file.name);
				added += result.added.length;
				deduped += result.deduped;
			} catch {
				failed.push(file.name); // unrecognized — canonicalize threw
			}
		}
		host.toast(
			messages.library.uploaded(added, deduped, failed.length),
			failed.length > 0 ? "warning" : "info",
		);
	};

	const entries = libraryEntries.value;
	const sections = TYPE_ORDER.map((type) => ({
		type,
		items: entries
			.filter((entry) => entry.derived.type === type)
			.sort((a, b) => a.user.displayName.localeCompare(b.user.displayName)),
	})).filter((section) => section.items.length > 0);

	return (
		<PanelFrame title={messages.library.title}>
			<div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
				<div
					class={`rounded border-2 border-dashed p-4 text-center text-sm ${
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
						setDragging(false);
						void handleFiles(event.dataTransfer?.files ?? null);
					}}
				>
					{messages.library.drop}{" "}
					<button
						type="button"
						class="font-medium text-neutral-800 underline hover:text-neutral-900"
						onClick={() => inputRef.current?.click()}
					>
						{messages.library.browse}
					</button>
					<input
						ref={inputRef}
						type="file"
						multiple
						class="hidden"
						onChange={(event) => {
							void handleFiles(event.currentTarget.files);
							event.currentTarget.value = ""; // allow re-picking the same file
						}}
					/>
				</div>

				{sections.length === 0 ? (
					<p class="text-sm text-neutral-400">{messages.library.empty}</p>
				) : (
					sections.map((section) => (
						<section key={section.type}>
							<h2 class="mb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
								{messages.library.sections[section.type]}
							</h2>
							<ul class="flex flex-col gap-1">
								{section.items.map((entry) => (
									<Row key={entry.id} entry={entry} />
								))}
							</ul>
						</section>
					))
				)}
			</div>
		</PanelFrame>
	);
}
