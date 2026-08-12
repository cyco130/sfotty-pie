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
 * write outside the destination or produce something unopenable.
 *
 * The rules are the portable intersection, applied on every platform rather
 * than the host's own - the allowed set already excludes characters Linux
 * would take (":" among them), and a directory unpacked on one system gets
 * read on another, so the same disk has to give the same names everywhere.
 * On any well-formed name it does nothing.
 */
export function toHostName(name: string): string {
	const safe = name
		.replace(/[^a-z0-9._-]/gi, "_")
		// Windows drops trailing dots silently, which would fold "abc." onto
		// "abc" without anyone being told.
		.replace(/\.+$/, (dots) => "_".repeat(dots.length));
	return safe === "" ||
		safe.startsWith(".") ||
		safe.startsWith("-") ||
		RESERVED.test(safe)
		? `_${safe}`
		: safe;
}

/**
 * The DOS device names Windows still reserves, which it resolves before it
 * ever looks at the directory - and for any extension, so "CON.TXT" opens
 * the console rather than a file. Any of them is a legal Atari name.
 */
const RESERVED = /^(con|prn|aux|nul|(com|lpt)[0-9])(\.|$)/i;
