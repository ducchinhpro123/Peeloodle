/**
 * Shared download of a pinned catalog derivative for template use (P70/P71).
 *
 * Clone and layout insertion both need the exact bytes of a template's pinned
 * asset version. The published version must still be the pinned one: a replaced
 * asset is refused rather than silently substituted, and the bytes are verified
 * against the declared hash and size before they are handed to a caller.
 */

import { sha256Hex } from '$lib/hash';
import type { CatalogRepository } from '$lib/catalog/repository';

const SIGNED_URL_SECONDS = 120;

export type DerivativeErrorCode = 'missing_media' | 'offline' | 'invalid_media';

export class DerivativeError extends Error {
	readonly code: DerivativeErrorCode;
	readonly cause?: unknown;

	constructor(code: DerivativeErrorCode, message: string, cause?: unknown) {
		super(message);
		this.name = 'DerivativeError';
		this.code = code;
		this.cause = cause;
	}
}

export async function downloadCatalogDerivative(input: {
	catalog: CatalogRepository;
	fetch: typeof fetch;
	assetId: string;
	versionId: string;
}): Promise<Uint8Array> {
	let published;
	try {
		published = await input.catalog.getPublishedVersion(input.assetId);
	} catch (error) {
		throw new DerivativeError(
			'missing_media',
			'This template references artwork that is no longer published.',
			error
		);
	}
	if (published.id !== input.versionId)
		throw new DerivativeError(
			'missing_media',
			'This template references artwork that has been replaced.'
		);

	let url: string;
	try {
		url = await input.catalog.signedDerivativeUrl(published.derivativePath, SIGNED_URL_SECONDS);
	} catch (error) {
		throw new DerivativeError(
			'missing_media',
			'This template’s artwork could not be reached.',
			error
		);
	}

	let response: Response;
	try {
		response = await input.fetch(url);
	} catch (error) {
		throw new DerivativeError(
			'offline',
			'This template’s artwork could not be downloaded. Check the connection and try again.',
			error
		);
	}
	if (!response.ok)
		throw new DerivativeError(
			'missing_media',
			`This template’s artwork could not be downloaded (${response.status}).`
		);

	const bytes = new Uint8Array(await response.arrayBuffer());
	const sha256 = await sha256Hex(bytes);
	if (sha256 !== published.derivativeSha256 || bytes.length !== published.derivativeBytes)
		throw new DerivativeError(
			'invalid_media',
			'This template’s artwork no longer matches the published version.'
		);
	return bytes;
}
