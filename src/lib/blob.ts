/**
 * One Blob→bytes read for every boundary: upload validation, ZIP export, cloud
 * upload and IndexedDB storage. Engines without `Blob.arrayBuffer()` fall back
 * to FileReader, so the fallback exists once instead of four times.
 */

export function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
	if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as ArrayBuffer);
		reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
		reader.readAsArrayBuffer(blob);
	});
}

export async function blobBytes(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
	return new Uint8Array(await blobToArrayBuffer(blob));
}
