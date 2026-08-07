// Host-side file naming policy: the skeleton is generic (a portable
// character set), families feed it their decoded names.

/**
 * Makes a decoded native name safe to write on a host filesystem:
 * characters outside a portable set become "_", and names that would start
 * with "." or "-" (hidden files, option-lookalikes) get a "_" prefix.
 *
 * This is a safety guard, not a way of fitting a name to a shape - nothing
 * mangles a name to make it fit, and a name that does not fit is refused. It
 * exists because a damaged directory decodes to whatever bytes are in it, so
 * a native name can hold a path separator or control characters, which would
 * write outside the destination or produce something unopenable. On any
 * well-formed name it does nothing.
 */
export function toHostName(name: string): string {
	const safe = name.replace(/[^a-z0-9._-]/gi, "_");
	return safe === "" || safe.startsWith(".") || safe.startsWith("-")
		? `_${safe}`
		: safe;
}
