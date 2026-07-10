// Starred games - the game picker's shelf (see favorites-menu.tsx). A global
// (cross-tab) ordered id list in localStorage, like the recents history;
// entries resolve against the library when rendered, skipping any that no
// longer exist. Starring happens in the menu's Recents list, which includes
// every built-in plus anything you've booted.

import { computed, signal } from "@preact/signals";
import { getImage } from "./images/library.ts";
import type { ImageEntry } from "./images/metadata.ts";
import { loadLocal, saveLocal } from "./persist.ts";

const FAVORITES_KEY = "favorites";

function load(): string[] {
	const raw = loadLocal(FAVORITES_KEY);
	if (!Array.isArray(raw)) return [];
	return raw.filter((x): x is string => typeof x === "string");
}

/** The starred ids, in starring order. */
export const favoriteIds = signal<string[]>(load());

export function isFavorite(id: string): boolean {
	return favoriteIds.value.includes(id);
}

/** Star/unstar an image (persisted). */
export function toggleFavorite(id: string): void {
	const current = favoriteIds.value;
	const next = current.includes(id)
		? current.filter((x) => x !== id)
		: [...current, id];
	favoriteIds.value = next;
	saveLocal(FAVORITES_KEY, next);
}

/** The starred games, resolved (stale ids skipped), in starring order. */
export const favoritesView = computed<ImageEntry[]>(() =>
	favoriteIds.value
		.map((id) => getImage(id))
		.filter((e): e is ImageEntry => e !== undefined),
);
