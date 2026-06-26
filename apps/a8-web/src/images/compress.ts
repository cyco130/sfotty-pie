// Compression at rest for user blobs. `deflate-raw` has the least per-blob
// overhead, and the library content-hashes the *uncompressed* payload, so the
// compressed form is purely a storage encoding that nothing above the blob
// store ever sees. Native streams — zero-dep, available in every browser the
// app targets. Disk images are mostly zeroed sectors, exactly what deflate
// crushes; ROMs barely move, which is why the blob store keeps whichever is
// smaller.

async function pump(
	bytes: Uint8Array,
	stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array<ArrayBuffer>> {
	const writer = stream.writable.getWriter();
	// Drain and fill concurrently so a large blob can't deadlock on backpressure.
	const written = writer
		.write(bytes as BufferSource)
		.then(() => writer.close());
	const read = new Response(stream.readable).arrayBuffer();
	const [, buffer] = await Promise.all([written, read]);
	return new Uint8Array(buffer);
}

export function deflateRaw(
	bytes: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
	return pump(bytes, new CompressionStream("deflate-raw"));
}

export function inflateRaw(
	bytes: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
	return pump(bytes, new DecompressionStream("deflate-raw"));
}
