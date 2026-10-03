/**
 * P71: load selected layout slides from a published template.
 *
 * The chosen slides are cloned with fresh slide/element/asset ids, every asset
 * they reference is downloaded and verified (the same pinned-version rule as
 * P70's full clone), and the result is a prepared `{slides, assets, media}`
 * batch the editor persists in one transaction before adopting it. Only the
 * assets the chosen slides actually draw are downloaded, so inserting one
 * layout from a large template does not fetch the whole deck.
 */

import type { CatalogRepository } from '#lib/catalog/repository.js';
import { clonePresentationDocumentWithNewIds } from '../model/factories';
import { parsePresentationDocument } from '../model/parse';
import { DerivativeError, downloadCatalogDerivative } from './catalogDerivative';
import type { PresentationMediaRecord } from '../persistence/repository';
import type { PresentationAsset, Slide } from '../model/types';

export type LayoutInsertErrorCode =
	| 'not_available'
	| 'no_slides'
	| 'invalid_document'
	| 'missing_media'
	| 'offline'
	| 'invalid_media';

export class LayoutInsertError extends Error {
	readonly code: LayoutInsertErrorCode;

	constructor(code: LayoutInsertErrorCode, message: string) {
		super(message);
		this.name = 'LayoutInsertError';
		this.code = code;
	}
}

export type LoadedTemplateLayout = {
	slides: Slide[];
	assets: PresentationAsset[];
	media: PresentationMediaRecord[];
};

export async function loadTemplateLayout(input: {
	catalogRepository: CatalogRepository;
	templateId: string;
	/** Zero-based slide positions in the published template document. */
	slideOrdinals: number[];
	/** Test seam; defaults to the global `fetch`. */
	fetch?: typeof fetch;
}): Promise<LoadedTemplateLayout> {
	const fetchImpl = input.fetch ?? fetch;

	let version;
	try {
		version = await input.catalogRepository.getTemplateVersion(input.templateId);
	} catch {
		throw new LayoutInsertError(
			'not_available',
			'This template is not available right now. Check the connection and try again.'
		);
	}

	let document;
	try {
		document = parsePresentationDocument(version.document);
	} catch {
		throw new LayoutInsertError(
			'invalid_document',
			'This template could not be read safely, so no slides were inserted.'
		);
	}

	const ordinals = [...new Set(input.slideOrdinals)].sort((left, right) => left - right);
	if (
		ordinals.length === 0 ||
		ordinals.some(
			(ordinal) => !Number.isInteger(ordinal) || ordinal < 0 || ordinal >= document.slides.length
		)
	)
		throw new LayoutInsertError('no_slides', 'Choose at least one slide to insert.');

	const clone = clonePresentationDocumentWithNewIds(document);
	const slides = ordinals.map((ordinal) => clone.slides[ordinal]!);
	const usedAssetIds = new Set<string>();
	for (const slide of slides)
		for (const element of slide.elements)
			if (element.kind === 'image') usedAssetIds.add(element.assetId);
	const assets = clone.assets.filter((asset) => usedAssetIds.has(asset.id));

	let dependencies;
	try {
		dependencies = await input.catalogRepository.getDependencies(version.id);
	} catch {
		throw new LayoutInsertError(
			'missing_media',
			'This template’s artwork list could not be read, so no slides were inserted.'
		);
	}

	const media: PresentationMediaRecord[] = [];
	for (const asset of assets) {
		const source = document.assets[clone.assets.indexOf(asset)];
		const provenance = source?.provenance;
		const itemId = provenance?.catalogItemId;
		const versionId = provenance?.catalogVersionId;
		if (!source || provenance?.source !== 'catalog' || !itemId || !versionId)
			throw new LayoutInsertError(
				'missing_media',
				'This template references artwork it does not ship, so no slides were inserted.'
			);
		const pinned = dependencies.some(
			(dependency) => dependency.assetId === itemId && dependency.assetVersionId === versionId
		);
		if (!pinned)
			throw new LayoutInsertError(
				'missing_media',
				'This template references artwork it does not ship, so no slides were inserted.'
			);
		try {
			media.push({
				assetId: asset.id,
				bytes: await downloadCatalogDerivative({
					catalog: input.catalogRepository,
					fetch: fetchImpl,
					assetId: itemId,
					versionId
				}),
				mimeType: asset.mimeType
			});
		} catch (error) {
			if (error instanceof DerivativeError)
				throw new LayoutInsertError(error.code, `${error.message} No slides were inserted.`);
			throw error;
		}
	}

	return { slides, assets, media };
}
