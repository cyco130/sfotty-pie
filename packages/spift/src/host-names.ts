// Host-side file naming policy for extraction: the skeleton is generic
// (portable character set, deterministic collision suffixing); families feed
// it their decoded names.

/**
 * Makes a decoded native name safe for host filesystems: characters outside
 * a portable set become "_", and names that would start with "." or "-"
 * (hidden files, option-lookalikes) get a "_" prefix.
 */
export function toHostName(name: string): string {
	const safe = name.replace(/[^a-z0-9._-]/gi, "_");
	return safe === "" || safe.startsWith(".") || safe.startsWith("-")
		? `_${safe}`
		: safe;
}

/**
 * Resolves collisions in a list of host names (which mangling or damaged
 * directories can produce) by inserting "~2", "~3", ... before the extension
 * of later duplicates. Deterministic: earlier names win their spelling.
 */
export function uniqueHostNames(names: readonly string[]): string[] {
	const used = new Set<string>();
	return names.map((name) => {
		let candidate = name;
		for (let n = 2; used.has(candidate); n++) {
			const dot = name.lastIndexOf(".");
			candidate =
				dot <= 0
					? `${name}~${n}`
					: `${name.slice(0, dot)}~${n}${name.slice(dot)}`;
		}
		used.add(candidate);
		return candidate;
	});
}
