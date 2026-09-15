/**
 * SHA-256 of raw bytes as lowercase hex. One spelling for backup manifests,
 * restore verification and content-addressed presentation assets, so an asset id
 * can never be computed differently from the checksum that verifies it.
 */

export type HashFn = (bytes: Uint8Array) => Promise<string>;

export const sha256Hex: HashFn = async (bytes) => {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) throw new Error('SHA-256 is unavailable in this environment');
	const digest = await subtle.digest('SHA-256', bytes as unknown as BufferSource);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
