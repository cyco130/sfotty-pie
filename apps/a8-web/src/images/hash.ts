// SHA-256 of an image's canonical payload, hex-encoded — the library's content
// identifier (dedup detection + content-addressed blob refs). `crypto.subtle`
// is secure-context-only, which dev already runs under (HTTPS).

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	// `bytes` may be a subarray view, so its buffer type widens to
	// ArrayBufferLike; digest takes any ArrayBufferView at runtime.
	const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}
