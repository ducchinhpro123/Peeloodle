/**
 * Pure planning for persist-first inserts: each plan is the next document,
 * built without touching the editor or a repository, so the saver can write it
 * before the editor adopts it.
 */

import { serializePresentationDocument } from '../../../model/parse';
import { createImageElement } from '../../../model/factories';
import type {
	NormalizedCrop,
	PresentationAsset,
	PresentationDocument,
	Slide
} from '../../../model/types';
import { withRevision } from '../../history';
import { fitImageWithinSlide, type PreparedPresentationImage } from '../../insertImageAsset';
import { replaceableArea, slideInsertionRefusal } from '../rules';

export type ImageInsertPlan = { document: PresentationDocument; elementId: string };

/**
 * Builds the next document for an insert without touching the store or a
 * repository, so the same plan can be persisted first and adopted afterwards.
 * The plan carries the revision it will be written with.
 */
export function planImageInsert(
	document: PresentationDocument,
	image: PreparedPresentationImage,
	options: { slideId?: string | null } = {}
): ImageInsertPlan | null {
	const resolvedSlideId = options.slideId ?? document.slides[0]?.id ?? null;
	const slide = document.slides.find((candidate) => candidate.id === resolvedSlideId);
	if (!slide) return null;
	const draft = structuredClone(document);
	const target = draft.slides.find((candidate) => candidate.id === slide.id)!;
	const placement = fitImageWithinSlide(image.asset, draft.pageSize);
	const imageCount = target.elements.filter((element) => element.kind === 'image').length;
	const element = createImageElement({
		assetId: image.asset.id,
		name: imageCount === 0 ? 'Image' : `Image ${imageCount + 1}`,
		alt: image.asset.provenance.label,
		x: placement.x,
		y: placement.y,
		width: placement.width,
		height: placement.height
	});
	const knownAsset = draft.assets.some((asset) => asset.id === image.asset.id);
	if (!knownAsset) draft.assets.push(structuredClone(image.asset));
	target.elements.push(structuredClone(element));
	return {
		document: serializePresentationDocument(withRevision(document, draft)),
		elementId: element.id
	};
}

export type ImageReplacePlan = { document: PresentationDocument; elementId: string };

/**
 * A centered crop of the new image that fills the element's box without
 * stretching, so a replacement preserves the intended placement and aspect.
 */
export function coverCrop(
	image: PreparedPresentationImage,
	box: { width: number; height: number }
): NormalizedCrop {
	const imageAspect = image.asset.width / image.asset.height;
	const boxAspect = box.width / box.height;
	if (
		!Number.isFinite(imageAspect) ||
		imageAspect <= 0 ||
		!Number.isFinite(boxAspect) ||
		boxAspect <= 0
	) {
		return { x: 0, y: 0, width: 1, height: 1 };
	}
	if (imageAspect > boxAspect) {
		const width = boxAspect / imageAspect;
		return { x: (1 - width) / 2, y: 0, width, height: 1 };
	}
	const height = imageAspect / boxAspect;
	return { x: 0, y: (1 - height) / 2, width: 1, height };
}

/**
 * Builds the next document for a replacement: the element keeps its id,
 * placement, rotation, opacity and flips; only the asset, alt text and a fresh
 * centered cover crop change. Crop stays non-destructive document data. A
 * rectangular shape area becomes a real image element at identical geometry;
 * the same id survives so selection, history, and any raced replay still match.
 */
export function planImageReplacement(
	document: PresentationDocument,
	elementId: string,
	image: PreparedPresentationImage
): ImageReplacePlan | null {
	const draft = structuredClone(document);
	const slide = draft.slides.find((candidate) =>
		candidate.elements.some((element) => element.id === elementId)
	);
	const index = slide?.elements.findIndex((element) => element.id === elementId) ?? -1;
	const target = index === -1 ? undefined : slide!.elements[index];
	if (!replaceableArea(target)) return null;
	const knownAsset = draft.assets.some((asset) => asset.id === image.asset.id);
	if (!knownAsset) draft.assets.push(structuredClone(image.asset));
	const replacement = createImageElement({
		id: target.id,
		name: target.name,
		x: target.x,
		y: target.y,
		width: target.width,
		height: target.height,
		rotation: target.rotation,
		opacity: target.opacity,
		visible: target.visible,
		locked: false,
		assetId: image.asset.id,
		alt: image.asset.provenance.label,
		crop: coverCrop(image, target),
		...(target.kind === 'image' ? { flipX: target.flipX, flipY: target.flipY } : {})
	});
	slide!.elements[index] = replacement;
	return {
		document: serializePresentationDocument(withRevision(document, draft)),
		elementId
	};
}

export type SlideInsertionPlan = {
	document: PresentationDocument;
	/** Inserted slide ids in order; the first one becomes active. */
	slideIds: string[];
	/** The exact prepared slides/assets, kept so a raced write can be replayed. */
	slides: Slide[];
	assets: PresentationAsset[];
	afterSlideId: string | null;
};

/**
 * Builds the next document for a template-layout insertion without touching the
 * store: fresh-id slides and assets are inserted after the anchor (or at the
 * end), and the plan carries the prepared content for a raced-write replay.
 */
export function planSlideInsertion(
	document: PresentationDocument,
	slides: Slide[],
	assets: PresentationAsset[],
	options: { afterSlideId?: string | null } = {}
): SlideInsertionPlan | null {
	if (slides.length === 0) return null;
	if (slideInsertionRefusal(document, slides, assets)) return null;
	const draft = structuredClone(document);
	for (const asset of assets) {
		if (!draft.assets.some((existing) => existing.id === asset.id))
			draft.assets.push(structuredClone(asset));
	}
	const afterSlideId = options.afterSlideId ?? null;
	const anchorIndex = afterSlideId
		? draft.slides.findIndex((slide) => slide.id === afterSlideId)
		: -1;
	const insertAt = anchorIndex === -1 ? draft.slides.length : anchorIndex + 1;
	const copies = slides.map((slide) => structuredClone(slide));
	draft.slides.splice(insertAt, 0, ...copies);
	return {
		document: serializePresentationDocument(withRevision(document, draft)),
		slideIds: copies.map((slide) => slide.id),
		slides: copies,
		assets,
		afterSlideId
	};
}
