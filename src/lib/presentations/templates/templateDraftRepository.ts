/**
 * Presentation-persistence adapter for the shared editor in template mode (P66).
 *
 * The editor's document/media contracts do not change: this adapter replaces the
 * local IndexedDB repository for one template, so all editing, history, text and
 * canvas code stays the same. It loads the newest immutable template version,
 * serves each asset's derivative bytes through the administrator's signed URL,
 * and appends a new immutable pending version on save against the template
 * revision it read. Only catalog-backed artwork is allowed: a template draft's
 * images were pinned to validated catalog versions before the draft existed, so
 * a document carrying any other provenance is refused with a clear message
 * rather than written (local media enters templates through P65's
 * “Save as template” flow, which uploads it first).
 *
 * A concurrent save by another administrator comes back as a
 * `revision_conflict`; the adapter adopts the server's current revision and
 * throws the same `PersistenceError` code the local saver already understands,
 * so the shared conflict UI runs unchanged and an explicit second Save replaces
 * the newer version.
 */

import { sha256Hex } from '#lib/hash.js';
import { PersistenceError, isPersistenceError } from '#lib/persistence/repository.js';
import type { CatalogAdminRepository } from '#lib/catalog/repository.js';
import type { CatalogTemplate, CatalogTemplateVersion } from '#lib/catalog/types.js';
import { parsePresentationDocument, presentationDocumentToJson } from '../model/parse';
import type { PresentationAsset, PresentationDocument } from '../model/types';
import type {
	PresentationMediaRecord,
	PresentationRepository,
	SavePresentationOptions
} from '../persistence/repository';
import { collectFontRequirements } from './saveAsTemplateDraft';

/** Short-lived by design: the download starts immediately after it is minted. */
const SIGNED_URL_SECONDS = 120;

export const TEMPLATE_SAVE_CONFLICT_MESSAGE =
	'Another administrator saved a newer draft first. Your changes are still here. Press Save again to replace that version, or reload the draft to edit theirs.';

const TEMPLATE_SAVE_FAILED_MESSAGE =
	'This draft could not be saved. Your changes are still here and stay editable — press Save to try again.';

/**
 * The message a failed template-mode save shows. The local-storage wording of
 * `presentationSaving` would be wrong here, so the page passes this instead.
 */
export function describeTemplateSaveFailure(error: unknown): string {
	if (isPersistenceError(error)) {
		if (error.code === 'not_found') return error.message || 'This template no longer exists.';
		if (error.code === 'invalid_asset' || error.code === 'invalid_document') return error.message;
		if (error.code === 'transaction_failed')
			return `The draft could not be saved. ${error.message}`;
	}
	return TEMPLATE_SAVE_FAILED_MESSAGE;
}

export type TemplateDraftRepositoryInput = {
	catalog: CatalogAdminRepository;
	templateId: string;
	/** Test seam; defaults to the global `fetch`. */
	fetch?: typeof fetch;
};

export class TemplateDraftRepository implements PresentationRepository {
	#catalog: CatalogAdminRepository;
	#templateId: string;
	#fetch: typeof fetch;

	/** The template revision the newest load observed; compare-and-set on save. */
	#expectedRevision: number | null = null;
	#document: PresentationDocument | null = null;
	/** One in-flight load, so concurrent first reads do not double-fetch. */
	#loading: Promise<PresentationDocument> | null = null;
	#media = new Map<string, PresentationMediaRecord>();
	#head: { template: CatalogTemplate; version: CatalogTemplateVersion } | null = null;

	constructor(input: TemplateDraftRepositoryInput) {
		this.#catalog = input.catalog;
		this.#templateId = input.templateId;
		this.#fetch = input.fetch ?? fetch;
	}

	get templateId(): string {
		return this.#templateId;
	}

	/** Drops the cache so the next read observes another tab's newer version. */
	invalidate(): void {
		this.#expectedRevision = null;
		this.#document = null;
		this.#loading = null;
		this.#media.clear();
		this.#head = null;
	}

	async listPresentations() {
		return [];
	}

	async getPresentation(id: string): Promise<PresentationDocument> {
		if (id !== this.#templateId)
			throw new PersistenceError('not_found', `Template ${id} was not found`);
		return structuredClone(await this.#load());
	}

	async savePresentation(
		document: PresentationDocument,
		media: PresentationMediaRecord[] = [],
		options: SavePresentationOptions = {}
	): Promise<void> {
		// Template saves never carry bytes: every referenced asset must already be
		// a validated catalog version, and the server re-checks that below. The
		// parameters stay for interface compatibility (the editor's persist-first
		// insert path calls this shape).
		void media;
		void options;
		if (document.id !== this.#templateId)
			throw new PersistenceError('not_found', 'This draft belongs to another template.');
		await this.#load();

		const foreign = document.assets.find(
			(asset) =>
				asset.provenance.source !== 'catalog' ||
				!asset.provenance.catalogItemId ||
				!asset.provenance.catalogVersionId
		);
		if (foreign)
			throw new PersistenceError(
				'invalid_asset',
				'Template drafts can only use catalog images. Create the template from a presentation to upload local artwork first.'
			);

		const json = presentationDocumentToJson(document);
		const bytes = new TextEncoder().encode(json);
		let result: Awaited<ReturnType<CatalogAdminRepository['saveTemplateVersion']>>;
		try {
			result = await this.#catalog.saveTemplateVersion({
				templateId: this.#templateId,
				expectedRevision: this.#expectedRevision ?? 0,
				document: JSON.parse(json),
				documentSha256: await sha256Hex(bytes),
				documentBytes: bytes.length,
				fontRequirements: collectFontRequirements(document)
			});
		} catch (error) {
			throw new PersistenceError(
				'transaction_failed',
				error instanceof Error ? error.message : 'The catalog could not be reached.',
				error
			);
		}

		if (!result.ok) {
			if (result.reason === 'revision_conflict') {
				// Adopt the revision the server reported so an explicit second Save
				// replaces the other administrator's version; the shared conflict UI
				// asks for exactly that.
				if (result.detail.template) this.#expectedRevision = result.detail.template.revision;
				throw new PersistenceError('revision_conflict', TEMPLATE_SAVE_CONFLICT_MESSAGE);
			}
			if (result.reason === 'archived')
				throw new PersistenceError(
					'not_found',
					'This template was archived while it was open. Your changes are still here.'
				);
			if (result.reason === 'not_found')
				throw new PersistenceError('not_found', 'This template no longer exists.');
			if (result.reason === 'dependency_unavailable')
				throw new PersistenceError(
					'invalid_asset',
					'This draft references artwork that is no longer a valid catalog version. Reload the draft and add the image again.'
				);
			throw new PersistenceError(
				'invalid_document',
				'This draft is not a valid template document, so it was not saved.'
			);
		}

		this.#expectedRevision = result.item.template.revision;
		this.#document = structuredClone(document);
		this.#head = {
			template: structuredClone(result.item.template),
			version: structuredClone(result.item.version)
		};
	}

	async deletePresentation(): Promise<void> {
		throw new PersistenceError(
			'transaction_failed',
			'Template drafts are not local presentations and cannot be deleted here.'
		);
	}

	async duplicatePresentation(): Promise<PresentationDocument> {
		throw new PersistenceError(
			'transaction_failed',
			'Template drafts are not local presentations and cannot be duplicated here.'
		);
	}

	async getMedia(assetId: string): Promise<PresentationMediaRecord> {
		const cached = this.#media.get(assetId);
		if (cached) return { ...cached, bytes: cached.bytes.slice() };
		const document = await this.#load();
		const asset = document.assets.find((candidate) => candidate.id === assetId);
		if (!asset) throw new PersistenceError('not_found', `Artwork ${assetId} was not found`);
		const record = await this.#downloadDerivative(asset);
		this.#media.set(assetId, record);
		return { ...record, bytes: record.bytes.slice() };
	}

	/**
	 * The newest draft version and its stable template, for preview generation
	 * (P67): the caller needs the exact version id, document hash and revision
	 * the commit RPC compares against, not only the parsed document.
	 */
	async getDraftHead(): Promise<{
		document: PresentationDocument;
		version: CatalogTemplateVersion;
		template: CatalogTemplate;
	}> {
		const document = await this.#load();
		if (!this.#head) throw new PersistenceError('not_found', 'This template has no draft version.');
		return {
			document: structuredClone(document),
			version: structuredClone(this.#head.version),
			template: structuredClone(this.#head.template)
		};
	}

	/**
	 * The catalog already stores every asset a template may reference, so the
	 * editor never has bytes to submit; this answers the insert path's
	 * “do I need to send these bytes?” probe.
	 */
	async hasMedia(): Promise<boolean> {
		return true;
	}

	/** Loads the newest version once; concurrent callers share the same read. */
	#load(): Promise<PresentationDocument> {
		if (this.#document) return Promise.resolve(this.#document);
		if (this.#loading) return this.#loading;
		this.#loading = this.#readLatest().finally(() => {
			this.#loading = null;
		});
		return this.#loading;
	}

	async #readLatest(): Promise<PresentationDocument> {
		let template;
		let version;
		try {
			template = await this.#catalog.getTemplateForAdmin(this.#templateId);
			version = await this.#catalog.getLatestTemplateVersionForAdmin(this.#templateId);
		} catch (error) {
			if (error instanceof Error && 'code' in error && error.code === 'not_found')
				throw new PersistenceError('not_found', 'This template no longer exists.');
			throw new PersistenceError(
				'transaction_failed',
				error instanceof Error ? error.message : 'The catalog could not be reached.',
				error
			);
		}
		if (!version)
			throw new PersistenceError('not_found', 'This template has no draft version yet.');
		// The editor identity is the route's template id; the document keeps its
		// own snapshot id in storage, but the mounted editor must address it by the
		// id it loaded. Cloning (P70) assigns fresh ids, so this is not a pointer.
		const parsed = parsePresentationDocument(version.document);
		const document: PresentationDocument = { ...parsed, id: this.#templateId };
		this.#document = document;
		this.#expectedRevision = template.revision;
		this.#head = { template, version };
		return document;
	}

	async #downloadDerivative(asset: PresentationAsset): Promise<PresentationMediaRecord> {
		const { catalogItemId, catalogVersionId } = asset.provenance;
		if (!catalogItemId || !catalogVersionId)
			throw new PersistenceError(
				'invalid_asset',
				'This draft has an image without a catalog version.'
			);
		let version;
		try {
			version = await this.#catalog.getAssetVersion(catalogItemId, catalogVersionId);
			const url = await this.#catalog.signedDerivativeUrl(
				version.derivativePath,
				SIGNED_URL_SECONDS
			);
			const response = await this.#fetch(url);
			if (!response.ok)
				throw new PersistenceError(
					'missing_asset',
					`The catalog artwork could not be downloaded (${response.status}).`
				);
			const bytes = new Uint8Array(await response.arrayBuffer());
			const sha256 = await sha256Hex(bytes);
			if (sha256 !== version.derivativeSha256 || bytes.length !== version.derivativeBytes)
				throw new PersistenceError(
					'invalid_asset',
					'The catalog artwork no longer matches the version this draft pins.'
				);
			return { assetId: asset.id, bytes, mimeType: version.derivativeMime };
		} catch (error) {
			if (isPersistenceError(error)) throw error;
			throw new PersistenceError(
				'missing_asset',
				error instanceof Error
					? error.message
					: 'The catalog artwork could not be read on this device.',
				error
			);
		}
	}
}
