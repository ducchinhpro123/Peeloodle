/**
 * Presentation limits as refusal reasons.
 *
 * Pure: the UI explains a refusal and the commands refuse for the same reason,
 * always before anything is mutated.
 */

import { PRESENTATION_LIMITS } from '../../model/limits';
import type {
	Element,
	ImageElement,
	PresentationAsset,
	PresentationDocument,
	ShapeElement,
	Slide
} from '../../model/types';
import type { PreparedPresentationImage } from '../insertImageAsset';

export type ImageInsertRefusalReason =
	'media-limit' | 'no-slide' | 'no-image' | 'slide-element-cap' | 'slide-full' | 'asset-cap';
export type ImageInsertRefusal = { reason: ImageInsertRefusalReason; message: string };
export type ImageInsertCheck = { ok: true } | ({ ok: false } & ImageInsertRefusal);

export function formatMediaSize(bytes: number): string {
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Stored bytes for the assets the document currently references. */
export function totalMediaBytes(document: PresentationDocument): number {
	let total = 0;
	for (const asset of document.assets) total += asset.byteLength;
	return total;
}

/**
 * Why an insert would be refused. Pure, so the UI can explain the refusal and the
 * store can refuse for the same reason without either path guessing, and always
 * resolved before anything is mutated.
 */
export function imageInsertRefusal(
	document: PresentationDocument,
	image: PreparedPresentationImage,
	slideId: string | null
): ImageInsertRefusal | null {
	const resolvedSlideId = slideId ?? document.slides[0]?.id ?? null;
	const slide = document.slides.find((candidate) => candidate.id === resolvedSlideId);
	if (!slide) return { reason: 'no-slide', message: 'There is no slide to add this image to.' };
	if (slide.elements.length >= PRESENTATION_LIMITS.maxElementsPerSlide) {
		return {
			reason: 'slide-element-cap',
			message: `This slide already holds the maximum of ${PRESENTATION_LIMITS.maxElementsPerSlide} elements. Remove one before adding an image.`
		};
	}
	const elementCount = document.slides.reduce(
		(sum, candidate) => sum + candidate.elements.length,
		0
	);
	if (elementCount >= PRESENTATION_LIMITS.maxElements) {
		return {
			reason: 'slide-full',
			message: `This presentation already holds the maximum of ${PRESENTATION_LIMITS.maxElements} elements. Remove one before adding an image.`
		};
	}
	// Re-inserting identical bytes reuses the asset record, so neither the asset cap
	// nor the byte budget is charged twice for the same content.
	const knownAsset = document.assets.some((asset) => asset.id === image.asset.id);
	if (!knownAsset && document.assets.length >= PRESENTATION_LIMITS.maxAssets) {
		return {
			reason: 'asset-cap',
			message: `This presentation already holds the maximum of ${PRESENTATION_LIMITS.maxAssets} images. Remove one before adding another.`
		};
	}
	if (!knownAsset) {
		const size = image.media.bytes.length;
		const stored = totalMediaBytes(document);
		if (stored + size > PRESENTATION_LIMITS.maxMediaBytes) {
			return {
				reason: 'media-limit',
				message: `Adding "${image.asset.provenance.label}" would take this presentation's artwork past the ${formatMediaSize(PRESENTATION_LIMITS.maxMediaBytes)} limit — ${formatMediaSize(stored)} is already stored and this image is ${formatMediaSize(size)}. Remove some artwork, or add it to a new presentation.`
			};
		}
	}
	return null;
}

/** Elements an image can fill in place: an image, or an unlocked rectangular area. */
export function replaceableArea(
	element: Element | undefined
): element is ImageElement | ShapeElement {
	if (!element || element.locked) return false;
	if (element.kind === 'image') return true;
	return element.kind === 'shape' && ['rectangle', 'rounded-rectangle'].includes(element.shape);
}

/** Why a replacement would be refused: the same asset cap and byte budget as an insert. */
export function imageReplaceRefusal(
	document: PresentationDocument,
	image: PreparedPresentationImage,
	elementId: string
): ImageInsertRefusal | null {
	const element = document.slides
		.flatMap((slide) => slide.elements)
		.find((candidate) => candidate.id === elementId);
	if (element?.locked) {
		return {
			reason: 'no-image',
			message: 'Unlock this element before replacing its artwork.'
		};
	}
	if (!replaceableArea(element))
		return { reason: 'no-image', message: 'Select an image before replacing it.' };
	const knownAsset = document.assets.some((asset) => asset.id === image.asset.id);
	if (!knownAsset && document.assets.length >= PRESENTATION_LIMITS.maxAssets) {
		return {
			reason: 'asset-cap',
			message: `This presentation already holds the maximum of ${PRESENTATION_LIMITS.maxAssets} images. Remove one before replacing artwork.`
		};
	}
	if (!knownAsset) {
		const size = image.media.bytes.length;
		const stored = totalMediaBytes(document);
		if (stored + size > PRESENTATION_LIMITS.maxMediaBytes) {
			return {
				reason: 'media-limit',
				message: `Replacing with "${image.asset.provenance.label}" would take this presentation's artwork past the ${formatMediaSize(PRESENTATION_LIMITS.maxMediaBytes)} limit — ${formatMediaSize(stored)} is already stored and this image is ${formatMediaSize(size)}.`
			};
		}
	}
	return null;
}

export type SlideInsertionRefusalReason = 'slide-cap' | 'element-cap' | 'asset-cap';
export type SlideInsertionRefusal = { reason: SlideInsertionRefusalReason; message: string };

/** Why inserting prepared slides/assets would be refused, resolved before any mutation. */
export function slideInsertionRefusal(
	document: PresentationDocument,
	slides: Slide[],
	assets: PresentationAsset[]
): SlideInsertionRefusal | null {
	if (document.slides.length + slides.length > PRESENTATION_LIMITS.maxSlides) {
		return {
			reason: 'slide-cap',
			message: `This presentation already holds the maximum of ${PRESENTATION_LIMITS.maxSlides} slides.`
		};
	}
	const existing = document.slides.reduce((sum, slide) => sum + slide.elements.length, 0);
	const incoming = slides.reduce((sum, slide) => sum + slide.elements.length, 0);
	if (existing + incoming > PRESENTATION_LIMITS.maxElements) {
		return {
			reason: 'element-cap',
			message: `Inserting these slides would take the presentation past ${PRESENTATION_LIMITS.maxElements} elements. Remove some content first.`
		};
	}
	const known = document.assets.map((asset) => asset.id);
	const added = assets.filter((asset) => !known.includes(asset.id)).length;
	if (document.assets.length + added > PRESENTATION_LIMITS.maxAssets) {
		return {
			reason: 'asset-cap',
			message: `Inserting these slides would take the presentation past ${PRESENTATION_LIMITS.maxAssets} images.`
		};
	}
	return null;
}
