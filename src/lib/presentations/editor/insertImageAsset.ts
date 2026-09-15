/**
 * Personal image preparation for presentation insertion (P18).
 *
 * Turns a user-selected file into an immutable, content-addressed
 * `PresentationAsset` plus the media record a repository save needs.
 *
 * Validation is deliberately *not* reimplemented here: `validateUpload` is the
 * existing trust boundary (magic-byte sniffing, declared/sniffed MIME agreement,
 * animation and SVG rejection, 15 MB / 25 MP limits, decode sizing). This module
 * adds only what presentation assets require — a stable id, a content-addressed
 * blob key, and the SHA-256 the document stores.
 *
 * The bytes stay outside the document: `PreparedPresentationImage.media` is what
 * the store holds until a save persists it.
 */

import { blobToArrayBuffer } from '$lib/blob';
import { sha256Hex } from '$lib/hash';
import type { PresentationMediaRecord } from '../persistence/repository';
import {
	UploadValidationError,
	validateUpload,
	type ValidatedUpload
} from '$lib/assets/validateUpload';
import type { PresentationAsset } from '../model/types';

export type PreparedPresentationImage = {
	asset: PresentationAsset;
	media: PresentationMediaRecord;
};

export type PrepareImageErrorCode =
	'unsupported_type' | 'too_large' | 'too_many_pixels' | 'decode_failed';

export class PrepareImageError extends Error {
	readonly code: PrepareImageErrorCode;

	constructor(code: PrepareImageErrorCode, message: string) {
		super(message);
		this.name = 'PrepareImageError';
		this.code = code;
	}
}

/** Document units between an inserted image and the slide edge. */
export const IMAGE_INSERT_MARGIN = 48;

/**
 * Insertion policy: an image is never upscaled past its own pixel size and never
 * placed outside the slide, so a small upload stays small and a large photo is
 * scaled down to fit. Aspect ratio is preserved and the result is centred.
 */
export function fitImageWithinSlide(
	asset: Pick<PresentationAsset, 'width' | 'height'>,
	pageSize: { width: number; height: number },
	margin = IMAGE_INSERT_MARGIN
): { x: number; y: number; width: number; height: number } {
	const maxWidth = Math.max(1, pageSize.width - margin * 2);
	const maxHeight = Math.max(1, pageSize.height - margin * 2);
	const scale = Math.min(1, maxWidth / asset.width, maxHeight / asset.height);
	const width = asset.width * scale;
	const height = asset.height * scale;
	return { x: (pageSize.width - width) / 2, y: (pageSize.height - height) / 2, width, height };
}

export async function preparePresentationImage(file: File): Promise<PreparedPresentationImage> {
	const validated = await validatedUploadOrThrow(file);
	const bytes = new Uint8Array(await blobToArrayBuffer(validated.blob));

	let sha256: string;
	try {
		sha256 = await sha256Hex(bytes);
	} catch {
		throw new PrepareImageError('decode_failed', 'This image could not be read on this device');
	}

	const asset: PresentationAsset = {
		id: `asset-${sha256}`,
		blobKey: `uploads/${sha256}`,
		mimeType: validated.mimeType,
		width: validated.width,
		height: validated.height,
		sha256,
		byteLength: bytes.length,
		provenance: { source: 'upload', label: file.name.slice(0, 500) }
	};

	return { asset, media: { assetId: asset.id, bytes, mimeType: validated.mimeType } };
}

async function validatedUploadOrThrow(file: File): Promise<ValidatedUpload> {
	try {
		return await validateUpload(file);
	} catch (error) {
		if (error instanceof UploadValidationError)
			throw new PrepareImageError(mapUploadErrorCode(error.code), error.message);
		throw new PrepareImageError('decode_failed', 'This image could not be read');
	}
}

/**
 * The four insertion codes the editor switches its copy on. The upload boundary
 * has finer codes; its message is preserved so the user still sees whether the
 * file was animated, SVG, a GIF, or simply too big.
 */
function mapUploadErrorCode(code: UploadValidationError['code']): PrepareImageErrorCode {
	switch (code) {
		case 'file_too_large':
			return 'too_large';
		case 'too_many_pixels':
			return 'too_many_pixels';
		case 'unsupported_type':
		case 'animated_image':
		case 'svg_not_allowed':
			return 'unsupported_type';
		case 'decode_failed':
			return 'decode_failed';
	}
}
