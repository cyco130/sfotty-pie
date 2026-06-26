// Fetch an image's raw bytes from its asset URL. Kept free of the asset-folder
// `import.meta.glob` (which lives in ../library.ts) so the image library can
// import it without pulling that glob into non-Vite contexts (e.g. unit tests).

/**
 * Fetch an image's raw bytes from its (possibly fragmented) asset URL.
 *
 * A `#start-end` URL fragment (hex byte offsets, end-exclusive) selects a slice
 * of the asset — e.g. one ROM carved out of a combined dump. The fragment is
 * stripped before the fetch, so a combined's slices all share one cached
 * download and each is a `subarray` view into it. No fragment ⇒ the whole file.
 */
export async function loadImageBytes(
	url: string,
	label = url,
): Promise<Uint8Array> {
	const hash = url.indexOf("#");
	const base = hash < 0 ? url : url.slice(0, hash);
	const response = await fetch(base);
	if (!response.ok) {
		throw new Error(`Failed to load ${label} (${response.status})`);
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (hash < 0) return bytes;
	const [start, end] = url
		.slice(hash + 1)
		.split("-")
		.map((h) => parseInt(h, 16));
	return bytes.subarray(start, end);
}
