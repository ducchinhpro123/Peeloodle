/**
 * Export snapshot and preflight (P35).
 *
 * The caller captures one reference to the live document (after flushing any
 * open text session), then all asynchronous work — awaiting fonts, loading and
 * decoding artwork — runs against that captured object. A command that lands
 * while the export is preparing therefore cannot mix revisions into the output:
 * the snapshot keeps the document it was captured from.
 *
 * Preflight is honest: a referenced image that is not stored is reported with
 * the asset label, text overflow and unknown fonts become warnings the caller
 * can show, and decode failures release every bitmap that was already decoded.
 */

import type { PresentationMediaRecord, PresentationRepository } from '../persistence/repository';
import {
	decodeArtworkBatch,
	decodeMediaBitmap,
	type ArtworkBytes,
	type DecodeMedia
} from '../rendering/decodedArtwork';
import { ensurePresentationFonts } from '../rendering/fonts';
import { layoutTextElement, type MeasureText } from '../rendering/textLayout';
import type { PresentationImageSources } from '../rendering/renderSlide';

import { measureTextWidth } from '../editor/textMeasure';
import type { PresentationAsset, PresentationDocument } from '../model/types';

export type ExportWarningCode = 'text-overflow' | 'missing-font';

export type ExportWarning = {
	code: ExportWarningCode;
	slideId: string;
	elementId: string;
	/** Plain-language, actionable text ready for the UI. */
	message: string;
};

export type PresentationExportSnapshot = {
	/** The exact document the export renders; its revision never mixes with later edits. */
	document: PresentationDocument;
	revision: number;
	images: PresentationImageSources;
	/** Original bytes per asset, for exports that embed the source image (PPTX keep-original-crop). */
	media: ReadonlyMap<string, PresentationMediaRecord>;
	warnings: ExportWarning[];
	/** Releases the decoded bitmaps; safe to call more than once. */
	dispose(): void;
};

export type PresentationPreflightErrorCode = 'missing-media' | 'decode-failed';

export class PresentationPreflightError extends Error {
	readonly code: PresentationPreflightErrorCode;

	constructor(code: PresentationPreflightErrorCode, message: string) {
		super(message);
		this.name = 'PresentationPreflightError';
		this.code = code;
	}
}

export type CreateExportSnapshotOptions = {
	repository: PresentationRepository;
	/** Override for tests or Node: loads one stored asset's bytes. */
	getMedia?: (assetId: string) => Promise<PresentationMediaRecord>;
	/** Fonts must be loaded before measuring or rasterizing. */
	ensureFonts?: () => Promise<void>;
	/** Layout measure for overflow warnings; defaults to the editor's canvas measure. */
	measure?: MeasureText;
	/** Decode hook for tests; defaults to the shared decode policy. */
	decode?: (record: ArtworkBytes) => Promise<ImageBitmap>;
};

/** The assets the slides actually draw, in document order, de-duplicated. */
export function referencedAssets(document: PresentationDocument): PresentationAsset[] {
	const byId = new Map(document.assets.map((asset) => [asset.id, asset]));
	const seen = new Set<string>();
	const referenced: PresentationAsset[] = [];
	for (const slide of document.slides) {
		for (const element of slide.elements) {
			if (element.kind !== 'image' || seen.has(element.assetId)) continue;
			const asset = byId.get(element.assetId);
			if (asset) {
				seen.add(asset.id);
				referenced.push(asset);
			}
		}
	}
	return referenced;
}

/** One plain-language entry per text element with overflow or an unknown font. */
export function collectExportWarnings(
	document: PresentationDocument,
	measure: MeasureText = measureTextWidth
): ExportWarning[] {
	const warnings: ExportWarning[] = [];
	document.slides.forEach((slide, slideIndex) => {
		for (const element of slide.elements) {
			if (element.kind !== 'text' || !element.visible) continue;
			const layout = layoutTextElement(element, measure);
			const label = element.name || 'Text';
			if (layout.overflow) {
				const overflow = Math.max(
					1,
					Math.ceil(layout.contentHeight - Math.max(0, element.height - element.padding * 2))
				);
				warnings.push({
					code: 'text-overflow',
					slideId: slide.id,
					elementId: element.id,
					message: `Slide ${slideIndex + 1} (“${slide.name}”): “${label}” overflows its box by about ${overflow} units. Grow the box or shorten the text before exporting.`
				});
			}
			if (layout.missingFontIds.length > 0) {
				warnings.push({
					code: 'missing-font',
					slideId: slide.id,
					elementId: element.id,
					message: `Slide ${slideIndex + 1} (“${slide.name}”): “${label}” uses a font this app does not bundle (${layout.missingFontIds.join(', ')}). It will fall back to a default face.`
				});
			}
		}
	});
	return warnings;
}

/**
 * Preflights one presentation for export: awaits fonts, resolves every
 * referenced image from held bytes or storage, decodes them, and reports
 * actionable warnings. The caller owns the returned snapshot and must dispose it.
 */
export async function createExportSnapshot(
	document: PresentationDocument,
	options: CreateExportSnapshotOptions
): Promise<PresentationExportSnapshot> {
	const loadMedia = options.getMedia ?? ((assetId: string) => options.repository.getMedia(assetId));
	const assets = referencedAssets(document);

	const loaded = await Promise.all(
		assets.map(
			async (
				asset
			): Promise<
				| { asset: PresentationAsset; record: PresentationMediaRecord }
				| { asset: PresentationAsset; error: true }
			> => {
				try {
					return { asset, record: await loadMedia(asset.id) };
				} catch {
					return { asset, error: true };
				}
			}
		)
	);

	const missing = loaded.find(
		(entry): entry is { asset: PresentationAsset; error: true } => 'error' in entry
	);
	if (missing) {
		throw new PresentationPreflightError(
			'missing-media',
			`“${missing.asset.provenance.label}” is not stored in this browser, so the presentation cannot be exported. Reopen the presentation or restore its artwork, then try again.`
		);
	}
	const resolved = loaded.filter(
		(entry): entry is { asset: PresentationAsset; record: PresentationMediaRecord } =>
			'record' in entry
	);

	await (options.ensureFonts ?? ensurePresentationFonts)();

	// The batch closes every fulfilled bitmap before rethrowing, so a decode
	// failure never strands the artwork that did decode.
	const decode: DecodeMedia = options.decode
		? async (record) => {
				const bitmap = await options.decode!(record);
				return { source: bitmap, dispose: () => bitmap.close() };
			}
		: decodeMediaBitmap;
	let artwork;
	try {
		artwork = await decodeArtworkBatch(
			resolved.map((entry) => entry.record),
			decode
		);
	} catch {
		throw new PresentationPreflightError(
			'decode-failed',
			'Some artwork could not be decoded, so the presentation cannot be exported. Replace the unreadable image or restore it from a backup.'
		);
	}

	const media = new Map(resolved.map((entry) => [entry.asset.id, entry.record]));

	return {
		document,
		revision: document.revision,
		images: artwork.images,
		media,
		warnings: collectExportWarnings(document, options.measure),
		dispose: artwork.dispose
	};
}

/**
 * Preflight and return a snapshot ready to render or package. The caller owns
 * capturing `document` (after flushing any open text session), so this module
 * never reads the editor store.
 */
export async function prepareExportSnapshot(
	repository: PresentationRepository,
	document: PresentationDocument,
	options: Omit<CreateExportSnapshotOptions, 'repository'> = {}
): Promise<PresentationExportSnapshot> {
	return createExportSnapshot(document, { ...options, repository });
}
