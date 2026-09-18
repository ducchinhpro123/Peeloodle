/**
 * Presentation-to-template orchestration (P65).
 *
 * One pure service: it clones the caller's presentation with fresh IDs, resolves
 * every catalog-backed image against the exact validated version, sends local
 * media through the existing upload/processing pipeline, and calls the guarded
 * draft RPC last. The source presentation and its stored media are read-only —
 * no call here writes through `PresentationRepository`.
 *
 * Errors are domain codes, not transport noise: `collection_required`,
 * `missing_media`, `dependency_mismatch`, `upload_failed` and `draft_refused`
 * map one-to-one to the dialog's failure messages.
 */
import { sha256Hex } from '$lib/hash';
import type { CatalogAdminRepository, CatalogTemplateInput } from '$lib/catalog/repository';
import type { CatalogTemplateDraft, CatalogAssetVersion } from '$lib/catalog/types';
import { clonePresentationDocumentWithNewIds } from '$lib/presentations/model/factories';
import { presentationDocumentToJson } from '$lib/presentations/model/parse';
import type { PresentationAsset, PresentationDocument } from '$lib/presentations/model/types';
import type {
	PresentationMediaRecord,
	PresentationRepository
} from '$lib/presentations/persistence/repository';

export type SaveAsTemplateDraftInput = {
	sourceDocument: PresentationDocument;
	presentationRepository: PresentationRepository;
	catalogRepository: CatalogAdminRepository;
	collectionId: string | null;
	metadata: CatalogTemplateInput;
};

export type TemplateDraftErrorCode =
	| 'collection_required'
	| 'missing_media'
	| 'dependency_mismatch'
	| 'upload_failed'
	| 'draft_refused';

export class TemplateDraftError extends Error {
	readonly code: TemplateDraftErrorCode;

	constructor(code: TemplateDraftErrorCode, message: string) {
		super(message);
		this.name = 'TemplateDraftError';
		this.code = code;
	}
}

export function collectFontRequirements(document: PresentationDocument): { fontId: string }[] {
	const ids = new Set([document.theme.headingFontId, document.theme.bodyFontId]);
	for (const slide of document.slides)
		for (const element of slide.elements)
			if (element.kind === 'text')
				for (const paragraph of element.paragraphs)
					for (const run of paragraph.runs) ids.add(run.fontId);
	return [...ids].sort().map((fontId) => ({ fontId }));
}

function uploadName(index: number, mime: PresentationAsset['mimeType']): string {
	const extension = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]!;
	return `template-asset-${String(index + 1).padStart(3, '0')}.${extension}`;
}

/**
 * A catalog-provenance asset matches its pinned version only when every
 * derivative fact agrees; anything else is refused before any write happens.
 */
function matchesVersion(asset: PresentationAsset, version: CatalogAssetVersion): boolean {
	return (
		version.validationState === 'validated' &&
		version.derivativeSha256 === asset.sha256 &&
		version.derivativeBytes === asset.byteLength &&
		version.derivativeMime === asset.mimeType &&
		version.derivativeWidth === asset.width &&
		version.derivativeHeight === asset.height
	);
}

function assetFromVersion(assetId: string, version: CatalogAssetVersion): PresentationAsset {
	return {
		id: assetId,
		blobKey: `catalog/${version.derivativeSha256}`,
		mimeType: version.derivativeMime,
		width: version.derivativeWidth,
		height: version.derivativeHeight,
		sha256: version.derivativeSha256,
		byteLength: version.derivativeBytes,
		provenance: {
			source: 'catalog',
			label: 'Catalog asset',
			catalogItemId: version.assetId,
			catalogVersionId: version.id
		}
	};
}

export async function saveAsTemplateDraft(
	input: SaveAsTemplateDraftInput
): Promise<CatalogTemplateDraft> {
	const { sourceDocument, presentationRepository, catalogRepository, collectionId, metadata } =
		input;
	const templateDocument = clonePresentationDocumentWithNewIds(sourceDocument);

	// The rewrite targets the *cloned* assets; the source is never touched.
	const clonesById = new Map(templateDocument.assets.map((asset) => [asset.id, asset]));
	const sourceByCloneId = new Map<string, PresentationAsset>(
		sourceDocument.assets.map((asset, index) => [templateDocument.assets[index]!.id, asset])
	);

	const localAssets: { source: PresentationAsset; clone: PresentationAsset }[] = [];

	for (const [cloneId, source] of sourceByCloneId) {
		const clone = clonesById.get(cloneId)!;
		const provenance = source.provenance;
		if (provenance.source === 'catalog') {
			if (!provenance.catalogItemId || !provenance.catalogVersionId)
				throw new TemplateDraftError(
					'dependency_mismatch',
					'A catalog image is missing its item or version reference.'
				);
			let version: CatalogAssetVersion;
			try {
				version = await catalogRepository.getAssetVersion(
					provenance.catalogItemId,
					provenance.catalogVersionId
				);
			} catch {
				throw new TemplateDraftError(
					'dependency_mismatch',
					'A catalog image no longer matches the version in the presentation.'
				);
			}
			if (!matchesVersion(source, version))
				throw new TemplateDraftError(
					'dependency_mismatch',
					'A catalog image no longer matches the validated version it came from.'
				);
			templateDocument.assets[templateDocument.assets.indexOf(clone)] = assetFromVersion(
				clone.id,
				version
			);
			continue;
		}
		localAssets.push({ source, clone });
	}

	if (localAssets.length > 0) {
		if (!collectionId)
			throw new TemplateDraftError(
				'collection_required',
				'Choose a catalog collection for the template images.'
			);

		const media = new Map<string, PresentationMediaRecord>();
		for (const { source } of localAssets) {
			try {
				media.set(source.id, await presentationRepository.getMedia(source.id));
			} catch {
				throw new TemplateDraftError(
					'missing_media',
					'A presentation image is missing from this device.'
				);
			}
		}

		let batchId: string | null = null;
		try {
			const created = await catalogRepository.createUploadBatch({
				collectionId,
				files: localAssets.map(({ source }, index) => ({
					name: uploadName(index, source.mimeType),
					mime: source.mimeType,
					bytes: source.byteLength
				}))
			});
			if (!created.ok)
				throw new TemplateDraftError(
					'upload_failed',
					'The upload batch could not be created for the template images.'
				);
			batchId = created.item.batch.id;
			const jobs = [...created.item.jobs].sort((left, right) => left.position - right.position);

			for (const [index, job] of jobs.entries()) {
				const record = media.get(localAssets[index]!.source.id)!;
				const blob = new Blob([record.bytes.slice()], { type: record.mimeType });
				await catalogRepository.uploadSource(job.sourcePath, blob, job.claimedMime);
			}

			for (let start = 0; start < jobs.length; start += 2) {
				const slice = jobs.slice(start, start + 2);
				const outcomes = await Promise.all(
					slice.map((job) => catalogRepository.processUploadJob(job.id))
				);
				for (const [offset, outcome] of outcomes.entries()) {
					const job = slice[offset]!;
					if (outcome.status !== 'processed')
						throw new TemplateDraftError(
							'upload_failed',
							`A template image could not be processed${
								outcome.status === 'failed' ? ` (${outcome.message})` : ''
							}.`
						);
					const version = await catalogRepository.getAssetVersion(job.assetId!, outcome.versionId);
					const clone = localAssets[job.position]!.clone;
					templateDocument.assets[templateDocument.assets.indexOf(clone)] = assetFromVersion(
						clone.id,
						version
					);
				}
			}

			const closed = await catalogRepository.closeUploadBatch(batchId);
			if (!closed.ok)
				throw new TemplateDraftError(
					'upload_failed',
					'The template image upload batch could not be closed.'
				);
			batchId = null;
		} catch (error) {
			if (batchId) {
				try {
					await catalogRepository.closeUploadBatch(batchId);
				} catch {
					// The original failure matters more than a best-effort close.
				}
			}
			if (error instanceof TemplateDraftError) throw error;
			throw new TemplateDraftError(
				'upload_failed',
				error instanceof Error ? error.message : 'The template images could not be uploaded.'
			);
		}
	}

	const json = presentationDocumentToJson(templateDocument);
	const bytes = new TextEncoder().encode(json);
	const result = await catalogRepository.createTemplateDraft({
		metadata,
		document: JSON.parse(json),
		documentSha256: await sha256Hex(bytes),
		documentBytes: bytes.length,
		fontRequirements: collectFontRequirements(templateDocument)
	});
	if (!result.ok)
		throw new TemplateDraftError('draft_refused', `Template draft was refused (${result.reason}).`);
	return result.item;
}
