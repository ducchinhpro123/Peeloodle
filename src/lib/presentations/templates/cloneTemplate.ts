/**
 * P70: clone a published presentation template into an independent local deck.
 *
 * Every dependency is downloaded and verified before the local write, so a
 * failure leaves no half-created presentation; the clone then remaps document,
 * slide, element and asset ids, and commits the document plus all media in one
 * repository save. The template document and the catalog are never modified, so
 * two clones (and the source) share no mutable state.
 */

import type { CatalogRepository } from '$lib/catalog/repository';
import { DerivativeError, downloadCatalogDerivative } from './catalogDerivative';
import { clonePresentationDocumentWithNewIds } from '../model/factories';
import { parsePresentationDocument } from '../model/parse';
import type { PresentationMediaRecord, PresentationRepository } from '../persistence/repository';
import type { PresentationDocument } from '../model/types';

export type CloneTemplateErrorCode =
	| 'not_available'
	| 'invalid_document'
	| 'missing_media'
	| 'invalid_media'
	| 'offline'
	| 'save_failed';

export class CloneTemplateError extends Error {
	readonly code: CloneTemplateErrorCode;
	readonly cause?: unknown;

	constructor(code: CloneTemplateErrorCode, message: string, cause?: unknown) {
		super(message);
		this.name = 'CloneTemplateError';
		this.code = code;
		this.cause = cause;
	}
}

export type CloneTemplateInput = {
	catalogRepository: CatalogRepository;
	presentationRepository: PresentationRepository;
	templateId: string;
	/** Defaults to the stable template title. */
	title?: string;
	/** Test seam; defaults to the global `fetch`. */
	fetch?: typeof fetch;
};

export async function cloneTemplate(input: CloneTemplateInput): Promise<PresentationDocument> {
	const fetchImpl = input.fetch ?? fetch;
	const { catalogRepository } = input;

	let template;
	let version;
	try {
		template = await catalogRepository.getTemplate(input.templateId);
		version = await catalogRepository.getTemplateVersion(input.templateId);
	} catch (error) {
		throw new CloneTemplateError(
			'not_available',
			'This template is not available right now. Check the connection and try again.',
			error
		);
	}

	let document: PresentationDocument;
	try {
		document = parsePresentationDocument(version.document);
	} catch (error) {
		throw new CloneTemplateError(
			'invalid_document',
			'This template could not be read safely, so nothing was created.',
			error
		);
	}

	const dependencies = await catalogRepository.getDependencies(version.id);
	const clone = clonePresentationDocumentWithNewIds(document, {
		title: input.title ?? template.title
	});

	const media: PresentationMediaRecord[] = [];
	for (const [index, asset] of document.assets.entries()) {
		const provenance = asset.provenance;
		const itemId = provenance.catalogItemId;
		const versionId = provenance.catalogVersionId;
		const target = clone.assets[index];
		if (provenance.source !== 'catalog' || !itemId || !versionId || !target)
			throw new CloneTemplateError(
				'missing_media',
				'This template references artwork it does not ship, so nothing was created.'
			);
		const pin = dependencies.find(
			(dependency) => dependency.assetId === itemId && dependency.assetVersionId === versionId
		);
		if (!pin)
			throw new CloneTemplateError(
				'missing_media',
				'This template references artwork it does not ship, so nothing was created.'
			);
		try {
			media.push({
				assetId: target.id,
				bytes: await downloadCatalogDerivative({
					catalog: catalogRepository,
					fetch: fetchImpl,
					assetId: itemId,
					versionId
				}),
				mimeType: asset.mimeType
			});
		} catch (error) {
			if (error instanceof DerivativeError)
				throw new CloneTemplateError(error.code, error.message, error);
			throw error;
		}
	}

	try {
		await input.presentationRepository.savePresentation(clone, media);
	} catch (error) {
		throw new CloneTemplateError(
			'save_failed',
			'This template was downloaded, but it could not be saved on this device. Nothing was created.',
			error
		);
	}
	return clone;
}
