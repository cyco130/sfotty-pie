// The recently-booted images, newest first — a global (cross-tab) history kept
// in localStorage, capped. Entries are unified library ids; they're resolved
// against the library when rendered, skipping any that no longer exist. The
// menu's "Recents" section is this history followed by the built-in software
// you haven't booted, so it's never empty.

import { computed, signal } from "@preact/signals";
import { builtinSoftware, getImage } from "./images/library.ts";
import type { ImageEntry } from "./images/metadata.ts";
import { loadLocal, saveLocal } from "./persist.ts";

const RECENTS_KEY = "recents";
export const RECENTS_CAP = 10;

function load(): string[] {
	const raw = loadLocal(RECENTS_KEY);
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((x): x is string => typeof x === "string")
		.slice(0, RECENTS_CAP);
}

/** The MRU history (unified ids, newest first). */
export const recentIds = signal<string[]>(load());

/** Mark an image as just-used: move it to the front, dedup, cap, persist. */
export function touchRecent(id: string): void {
	const next = [id, ...recentIds.value.filter((x) => x !== id)].slice(
		0,
		RECENTS_CAP,
	);
	recentIds.value = next;
	saveLocal(RECENTS_KEY, next);
}

/** Drop an image from the recents history (persisted). */
export function removeRecent(id: string): void {
	if (!recentIds.value.includes(id)) return;
	const next = recentIds.value.filter((x) => x !== id);
	recentIds.value = next;
	saveLocal(RECENTS_KEY, next);
}

/** A recents row: the resolved entry, and whether it's in the MRU history. */
export interface RecentItem {
	entry: ImageEntry;
	/** In the MRU history (vs an appended, not-yet-booted built-in). */
	recent: boolean;
}

/**
 * The menu's recents view: the MRU history (resolved, newest first) followed by
 * built-in software not already in it (alphabetical). Stale ids are skipped.
 */
export const recentsView = computed<RecentItem[]>(() => {
	const ids = recentIds.value;
	const mru: RecentItem[] = ids
		.map((id) => getImage(id))
		.filter((e): e is ImageEntry => e !== undefined)
		.map((entry) => ({ entry, recent: true }));
	const inMru = new Set(ids);
	const seeds: RecentItem[] = builtinSoftware.value
		.filter((e) => !inMru.has(e.id))
		.map((entry) => ({ entry, recent: false }));
	return [...mru, ...seeds];
});
