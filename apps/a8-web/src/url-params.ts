import { useLocation } from "preact-iso";

/**
 * Two-way bind a set of query-string params to the URL, so view state (a
 * table's sort / filter / page) survives reload and is shareable. Returns the
 * current values (a missing param reads as "") and a setter that merges updates
 * — `null`/`""` deletes a param — and *replaces* the URL, so filtering doesn't
 * spam history. Reactive: a URL change re-renders the caller.
 */
export function useUrlParams<K extends string>(
	keys: readonly K[],
): [Record<K, string>, (updates: Partial<Record<K, string | null>>) => void] {
	const { query, path, route } = useLocation();
	const params = {} as Record<K, string>;
	for (const key of keys) params[key] = query[key] ?? "";

	const set = (updates: Partial<Record<K, string | null>>): void => {
		const next = new URLSearchParams(query);
		for (const key of Object.keys(updates) as K[]) {
			const value = updates[key];
			if (value === null || value === undefined || value === "") {
				next.delete(key);
			} else {
				next.set(key, value);
			}
		}
		const qs = next.toString();
		route(qs ? `${path}?${qs}` : path, true); // replace — view state, not history
	};

	return [params, set];
}
