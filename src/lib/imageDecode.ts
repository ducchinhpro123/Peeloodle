/**
 * One EXIF-orientation policy for every `createImageBitmap` site (upload
 * validation, backup verification, export rendering, the presentation editor and
 * library thumbnails): a rotated phone photo must not draw with swapped axes.
 *
 * The oriented call is preferred; a bare call is the fallback for engines that
 * reject the option. Callers that can also use an `<img>` fallback catch the
 * rejection from here and try that next.
 */

/** Extra bitmap hints beyond the shared orientation policy. */
export type DecodeImageBitmapOptions = Pick<
	ImageBitmapOptions,
	'resizeQuality' | 'premultiplyAlpha'
>;

export async function decodeImageBitmap(
	blob: Blob,
	options?: DecodeImageBitmapOptions
): Promise<ImageBitmap> {
	if (typeof createImageBitmap !== 'function')
		throw new Error('This browser cannot decode image files');
	try {
		return await createImageBitmap(blob, { imageOrientation: 'from-image', ...options });
	} catch {
		return await createImageBitmap(blob);
	}
}
