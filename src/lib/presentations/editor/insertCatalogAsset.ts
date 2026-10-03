/**
 * Catalog artwork copy for presentation insertion (P63).
 *
 * A catalog image is downloaded and stored *before* anything is committed: the
 * prepared bytes are handed to the same persist-then-adopt path as an upload, so
 * a failed download leaves the document untouched and the copy stops depending on
 * the catalog afterwards. Archiving or replacing the catalog item later cannot
 * break, or silently change, an inserted copy.
 *
 * Validation reuses `validateUpload` (the existing trust boundary) over the
 * downloaded bytes: the derivative is re-decoded on this device, so a truncated
 * or mislabelled object is refused instead of becoming an unreadable layer.
 */

import { blobToArrayBuffer } from '#lib/blob.js';
import { sha256Hex } from '#lib/hash.js';
import { UploadValidationError, validateUpload } from '#lib/assets/validateUpload.js';
import type { PresentationMediaRecord } from '../persistence/repository';
import type { PresentationAsset } from '../model/types';
import type { PreparedPresentationImage } from './insertImageAsset';

/** The published catalog item an insertion copies. */
export type CatalogInsertSource = {
	assetId: string;
	assetName: string;
	collectionId: string | null;
	/** Published derivative to copy (the approved PNG/WebP, not the source file). */
	derivativePath: string;
	derivativeSha256: string;
	versionId: string;
};

export type CatalogInsertErrorCode =
	'not_configured' | 'offline' | 'download_failed' | 'invalid_media';

export class CatalogInsertError extends Error {
	readonly code: CatalogInsertErrorCode;

	constructor(code: CatalogInsertErrorCode, message: string) {
		super(message);
		this.name = 'CatalogInsertError';
		this.code = code;
	}
}

export type CatalogMediaReader = {
	signedDerivativeUrl(path: string, expiresInSeconds?: number): Promise<string>;
};

/** Short-lived by design: the download starts immediately after it is minted. */
const SIGNED_URL_SECONDS = 120;

export async function prepareCatalogAsset(
	repository: CatalogMediaReader | null,
	source: CatalogInsertSource
): Promise<PreparedPresentationImage> {
	if (!repository)
		throw new CatalogInsertError(
			'not_configured',
			'The catalog is not configured for this site, so catalog images cannot be added.'
		);

	let url: string;
	try {
		url = await repository.signedDerivativeUrl(source.derivativePath, SIGNED_URL_SECONDS);
	} catch {
		throw new CatalogInsertError('download_failed', 'The catalog image could not be reached.');
	}

	let response: Response;
	try {
		response = await fetch(url);
	} catch {
		throw new CatalogInsertError(
			'offline',
			'The catalog image could not be downloaded. Check the connection and try again.'
		);
	}
	if (!response.ok)
		throw new CatalogInsertError(
			'download_failed',
			`The catalog image could not be downloaded (${response.status}).`
		);

	const blob = await response.blob();
	const file = new File([blob], `${source.assetName}.png`, {
		type: blob.type || 'image/png'
	});
	let validated;
	try {
		validated = await validateUpload(file);
	} catch (error) {
		const message =
			error instanceof UploadValidationError
				? `The catalog image was refused: ${error.message}`
				: 'The catalog image could not be read on this device.';
		throw new CatalogInsertError('invalid_media', message);
	}

	const bytes = new Uint8Array(await blobToArrayBuffer(validated.blob));
	let sha256: string;
	try {
		sha256 = await sha256Hex(bytes);
	} catch {
		throw new CatalogInsertError(
			'invalid_media',
			'The catalog image could not be read on this device.'
		);
	}

	const asset: PresentationAsset = {
		id: `asset-${sha256}`,
		blobKey: `catalog/${sha256}`,
		mimeType: validated.mimeType,
		width: validated.width,
		height: validated.height,
		sha256,
		byteLength: bytes.length,
		// The document model's catalog provenance fields; `derivativeSha256` is
		// already the asset's own content hash, so it is not duplicated here.
		provenance: {
			source: 'catalog',
			catalogItemId: source.assetId,
			catalogVersionId: source.versionId,
			label: source.assetName.slice(0, 500)
		}
	};

	const media: PresentationMediaRecord = {
		assetId: asset.id,
		bytes,
		mimeType: validated.mimeType
	};
	return { asset, media };
}
