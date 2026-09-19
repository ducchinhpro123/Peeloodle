/**
 * Presentation command store (P11).
 *
 * The serializable document is the single source of truth; Konva/DOM layers
 * read from it. All document mutations go through commands that create a new
 * validated revision and one undo entry (optionally grouped so one drag or
 * slider gesture produces one entry). Selection, zoom, pan and slide navigation
 * live in `view` and never dirty the document.
 */

import { PRESENTATION_LIMITS } from '../model/limits';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { serializePresentationDocument } from '../model/parse';
import { createImageElement, createSlide, nextSlideName } from '../model/factories';
import { recordHistory, stepBack, stepForward, withRevision, type HistoryEntry } from './history';
import { fitImageWithinSlide, type PreparedPresentationImage } from './insertImageAsset';
import { normalizeTransform, type TransformGeometry } from './transformGeometry';
import { measureTextWidth } from './textMeasure';
import { growTextToFit, shrinkTextToFit } from './textFit';
import type { MeasureText } from '../rendering/textLayout';
import type { AlignmentGuide } from './alignmentGuides';
import type {
	Element,
	NormalizedCrop,
	PresentationAsset,
	PresentationDocument,
	Slide,
	TextParagraph,
	Theme
} from '../model/types';

/** Geometry a gesture is previewing for one element; never part of the document. */
export type TransformPreview = TransformGeometry & { elementId: string };

export type PresentationViewState = {
	activeSlideId: string | null;
	selectedElementIds: string[];
	/** Text element whose DOM editor is open; view state only. */
	editingElementId: string | null;
	zoom: number;
	pan: { x: number; y: number };
	/** In-progress move/resize/rotate; committed once the gesture ends. */
	transformPreview: TransformPreview | null;
	/** Live alignment guides for a move gesture; view state only. */
	guides: AlignmentGuide[];
};

export type PresentationStoreState = {
	document: PresentationDocument | null;
	view: PresentationViewState;
	/** Revision known to be persisted; -1 means the document was never saved. */
	savedRevision: number;
	dirty: boolean;
	saving: boolean;
	saveError: string | null;
	past: HistoryEntry[];
	future: HistoryEntry[];
	lastHistoryGroup: string | null;

	loadDocument(document: PresentationDocument, options?: { saved?: boolean }): void;
	closeDocument(): void;
	markSaving(): void;
	markSaved(revision: number): void;
	markSaveFailed(message: string): void;

	selectSlide(slideId: string): void;
	selectElements(ids: string[]): void;
	toggleElementSelection(id: string, additive?: boolean): void;
	startTextEdit(elementId: string): void;
	endTextEdit(): void;
	setZoom(zoom: number): void;
	setPan(pan: { x: number; y: number }): void;
	/** Shows one element's in-progress geometry without touching the document. */
	setTransformPreview(preview: TransformPreview | null): void;
	/** Shows the current alignment guides; view state only. */
	setGuides(guides: AlignmentGuide[]): void;
	/** Ends a gesture: one history entry, the preview cleared, locked elements untouched. */
	commitTransform(elementId: string, geometry: TransformGeometry): void;

	addSlide(afterSlideId?: string): string | null;
	duplicateSlide(slideId: string): string | null;
	renameSlide(slideId: string, name: string): void;
	reorderSlide(slideId: string, targetIndex: number): void;
	removeSlide(slideId: string): boolean;
	setSlideBackground(
		slideId: string,
		background: string,
		options?: { historyGroup?: string }
	): void;

	addElement(element: Element): string | null;
	/** Clones an element with a fresh id, offset, and selected. One undo entry. */
	duplicateElement(elementId: string): string | null;
	/** The refusal an insert would hit, resolved before anything is mutated. */
	checkImageInsert(
		image: PreparedPresentationImage,
		options?: { slideId?: string }
	): ImageInsertCheck;
	/**
	 * Adopts an insert whose document and bytes are already persisted, as exactly
	 * one undo entry. Planning is pure (`planImageInsert`) and the write belongs to
	 * the saver, so this is the only insert command: nothing is ever shown as
	 * added before its bytes are stored.
	 */
	adoptPersistedInsert(plan: ImageInsertPlan, image: PreparedPresentationImage): void;
	/** Adopts a persisted replacement, as exactly one undo entry. */
	adoptPersistedReplacement(plan: ImageReplacePlan, image: PreparedPresentationImage): void;
	/**
	 * Adopts a persisted template-layout insertion, as exactly one undo entry;
	 * a command that landed during the write is replayed on the live document.
	 */
	adoptPersistedSlideInsertion(plan: SlideInsertionPlan): void;
	updateElement(
		elementId: string,
		patch: Partial<Element>,
		options?: { historyGroup?: string }
	): void;
	transformElement(
		elementId: string,
		patch: Partial<Pick<Element, 'x' | 'y' | 'width' | 'height' | 'rotation'>>,
		options?: { historyGroup?: string }
	): void;
	removeElement(elementId: string): void;
	reorderElement(elementId: string, targetIndex: number): void;
	toggleElementLocked(elementId: string): void;
	toggleElementVisible(elementId: string): void;
	updateText(
		elementId: string,
		paragraphs: TextParagraph[],
		options?: { historyGroup?: string }
	): void;
	/** Explicit shrink-to-fit; false means unavailable, locked or unreadable. */
	shrinkText(elementId: string): boolean;
	setTheme(theme: Theme, options?: { historyGroup?: string }): void;

	endHistoryGroup(): void;
	undo(): void;
	redo(): void;
};

export type PresentationStore = {
	readonly current: PresentationStoreState;
	getState(): PresentationStoreState;
	setState(
		update:
			| Partial<PresentationStoreState>
			| PresentationStoreState
			| ((
					state: PresentationStoreState
			  ) => Partial<PresentationStoreState> | PresentationStoreState),
		replace?: boolean
	): void;
	subscribe(
		listener: (state: PresentationStoreState, previous: PresentationStoreState) => void
	): () => void;
};

type StoreSet = PresentationStore['setState'];
type StoreGet = PresentationStore['getState'];

/** Svelte-owned command store with a small imperative seam for saving and tests. */
function createStore(
	initialize: (set: StoreSet, get: StoreGet) => PresentationStoreState
): PresentationStore {
	let state = $state.raw<PresentationStoreState>(undefined!);
	const listeners = new SvelteSet<
		(state: PresentationStoreState, previous: PresentationStoreState) => void
	>();

	const setState: StoreSet = (update, replace = false) => {
		const previous = state;
		const patch = typeof update === 'function' ? update(state) : update;
		state = replace ? (patch as PresentationStoreState) : { ...state, ...patch };
		for (const listener of listeners) listener(state, previous);
	};
	const getState: StoreGet = () => state;
	state = initialize(setState, getState);

	return {
		get current() {
			return state;
		},
		getState,
		setState,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}
	};
}

const initialView: PresentationViewState = {
	activeSlideId: null,
	selectedElementIds: [],
	editingElementId: null,
	zoom: 1,
	pan: { x: 0, y: 0 },
	transformPreview: null,
	guides: []
};

function cloneElementWithNewId(element: Element): Element {
	const copy = structuredClone(element);
	copy.id = crypto.randomUUID();
	return copy;
}

/** Structural comparison so nested patches with equal content are not treated as changes. */
function sameValue(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	try {
		return JSON.stringify(a) === JSON.stringify(b);
	} catch {
		return false;
	}
}

export type ImageInsertRefusalReason =
	'media-limit' | 'no-slide' | 'no-image' | 'slide-element-cap' | 'slide-full' | 'asset-cap';
export type ImageInsertRefusal = { reason: ImageInsertRefusalReason; message: string };
export type ImageInsertCheck = { ok: true } | ({ ok: false } & ImageInsertRefusal);
export type ImageInsertPlan = { document: PresentationDocument; elementId: string };

function formatMediaSize(bytes: number): string {
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Stored bytes for the assets the document currently references. */
function totalMediaBytes(document: PresentationDocument): number {
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

/** Why a replacement would be refused: the same asset cap and byte budget as an insert. */
export function imageReplaceRefusal(
	document: PresentationDocument,
	image: PreparedPresentationImage,
	elementId: string
): ImageInsertRefusal | null {
	const element = document.slides
		.flatMap((slide) => slide.elements)
		.find((candidate) => candidate.id === elementId);
	if (!element || element.kind !== 'image')
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

/**
 * Builds the next document for a replacement: the element keeps its id,
 * placement, rotation, opacity and flips; only the asset, alt text and a fresh
 * centered cover crop change. Crop stays non-destructive document data.
 */
export function planImageReplacement(
	document: PresentationDocument,
	elementId: string,
	image: PreparedPresentationImage
): ImageReplacePlan | null {
	const draft = structuredClone(document);
	const target = draft.slides
		.flatMap((slide) => slide.elements)
		.find((candidate) => candidate.id === elementId);
	if (!target || target.kind !== 'image') return null;
	const knownAsset = draft.assets.some((asset) => asset.id === image.asset.id);
	if (!knownAsset) draft.assets.push(structuredClone(image.asset));
	target.assetId = image.asset.id;
	target.alt = image.asset.provenance.label;
	target.crop = coverCrop(image, target);
	return {
		document: serializePresentationDocument(withRevision(document, draft)),
		elementId
	};
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

export function createPresentationStore(
	options: { measureText?: MeasureText } = {}
): PresentationStore {
	const measure = options.measureText ?? measureTextWidth;

	/** Sizing/text patches refused on a locked element; lock toggling is its own command. */
	const lockedPatchKeys = ['paragraphs', 'width', 'height', 'padding', 'lineHeight', 'autoGrow'];

	return createStore((set, get) => {
		/** Validates, bumps the revision and records one undo entry. Updaters return
		 * `false` for a no-op so redo history and the revision are left untouched. */
		const commit = (
			updater: (draft: PresentationDocument) => boolean | void,
			options: { historyGroup?: string } = {}
		): boolean => {
			const current = get().document;
			if (!current) return false;
			const draft = structuredClone(current);
			const changed = updater(draft);
			if (changed === false) return false;
			// First validation pass: the command's own change must be valid before
			// automatic fitting is allowed to touch it.
			let next = serializePresentationDocument(withRevision(current, draft));
			const previous = new SvelteMap(
				current.slides.flatMap((slide) => slide.elements).map((element) => [element.id, element])
			);
			let fitted = false;
			for (const slide of next.slides) {
				slide.elements = slide.elements.map((element) => {
					if (element.kind !== 'text' || !element.autoGrow || element.locked) return element;
					const old = previous.get(element.id);
					const signature = (value: typeof element) =>
						JSON.stringify([
							value.paragraphs,
							value.width,
							value.height,
							value.padding,
							value.lineHeight,
							value.autoGrow
						]);
					if (old?.kind === 'text' && signature(old) === signature(element)) return element;
					const result = growTextToFit(element, next.pageSize, measure);
					if (result !== element) fitted = true;
					return result;
				});
			}
			// Second validation pass: fitted geometry is published only when valid.
			if (fitted) next = serializePresentationDocument(next);
			const recorded = recordHistory(
				{ past: get().past, future: [], lastHistoryGroup: get().lastHistoryGroup },
				current,
				options.historyGroup
			);
			set({
				document: next,
				past: recorded.past,
				future: recorded.future,
				lastHistoryGroup: recorded.lastHistoryGroup,
				dirty: next.revision !== get().savedRevision
			});
			return true;
		};

		/**
		 * Records an insert that is already planned. `persisted` means the document was
		 * written before it is exposed, so the revision it carries is the saved one and
		 * the editor must not look dirty — or schedule a redundant write for it.
		 */
		const applyInsert = (input: { plan: ImageInsertPlan; persisted: boolean }): void => {
			const current = get().document;
			if (!current || current.id !== input.plan.document.id) return;
			const recorded = recordHistory(
				{ past: get().past, future: [], lastHistoryGroup: get().lastHistoryGroup },
				current
			);
			set({
				document: input.plan.document,
				past: recorded.past,
				future: recorded.future,
				lastHistoryGroup: recorded.lastHistoryGroup,
				view: { ...get().view, selectedElementIds: [input.plan.elementId], editingElementId: null },
				savedRevision: input.persisted ? input.plan.document.revision : get().savedRevision,
				dirty: input.persisted ? false : input.plan.document.revision !== get().savedRevision,
				saving: input.persisted ? false : get().saving,
				saveError: input.persisted ? null : get().saveError
			});
		};

		/**
		 * The replacement counterpart of `applyInsert`: the element already exists, so
		 * selection and view state are left alone and only the document and history move.
		 */
		const applyReplace = (input: { plan: ImageReplacePlan; persisted: boolean }): void => {
			const current = get().document;
			if (!current || current.id !== input.plan.document.id) return;
			const recorded = recordHistory(
				{ past: get().past, future: [], lastHistoryGroup: get().lastHistoryGroup },
				current
			);
			set({
				document: input.plan.document,
				past: recorded.past,
				future: recorded.future,
				lastHistoryGroup: recorded.lastHistoryGroup,
				savedRevision: input.persisted ? input.plan.document.revision : get().savedRevision,
				dirty: input.persisted ? false : input.plan.document.revision !== get().savedRevision,
				saving: input.persisted ? false : get().saving,
				saveError: input.persisted ? null : get().saveError
			});
		};

		/** Slide-insertion counterpart of `applyInsert`; selection moves to the first new slide. */
		const applySlideInsertion = (input: { plan: SlideInsertionPlan; persisted: boolean }): void => {
			const current = get().document;
			if (!current || current.id !== input.plan.document.id) return;
			const recorded = recordHistory(
				{ past: get().past, future: [], lastHistoryGroup: get().lastHistoryGroup },
				current
			);
			set({
				document: input.plan.document,
				past: recorded.past,
				future: recorded.future,
				lastHistoryGroup: recorded.lastHistoryGroup,
				view: {
					...get().view,
					activeSlideId: input.plan.slideIds[0] ?? get().view.activeSlideId,
					selectedElementIds: [],
					editingElementId: null
				},
				savedRevision: input.persisted ? input.plan.document.revision : get().savedRevision,
				dirty: input.persisted ? false : input.plan.document.revision !== get().savedRevision,
				saving: input.persisted ? false : get().saving,
				saveError: input.persisted ? null : get().saveError
			});
		};

		/** Re-plans a slide insertion on the live document after a raced write. */
		const replaySlideInsertion = (plan: SlideInsertionPlan): void => {
			const current = get().document;
			if (!current || current.id !== plan.document.id) return;
			const replanned = planSlideInsertion(current, plan.slides, plan.assets, {
				afterSlideId: plan.afterSlideId
			});
			if (replanned) applySlideInsertion({ plan: replanned, persisted: false });
		};

		/**
		 * Re-applies an insert over a live document that moved on during the write. The
		 * stored revision carries the insert; the live document carries the interim
		 * command. Planning reuses the plan's target slide and stays pure, so a refusal
		 * at replay time leaves the live document untouched.
		 */
		const replayInsert = (plan: ImageInsertPlan, image: PreparedPresentationImage): void => {
			const current = get().document;
			if (!current || current.id !== plan.document.id) return;
			const slideId =
				plan.document.slides.find((slide) =>
					slide.elements.some((element) => element.id === plan.elementId)
				)?.id ?? null;
			const replanned = planImageInsert(current, image, { slideId });
			if (replanned) applyInsert({ plan: replanned, persisted: false });
		};

		/** The replacement counterpart of `replayInsert`. */
		const replayReplace = (plan: ImageReplacePlan, image: PreparedPresentationImage): void => {
			const current = get().document;
			if (!current || current.id !== plan.document.id) return;
			const replanned = planImageReplacement(current, plan.elementId, image);
			if (replanned) applyReplace({ plan: replanned, persisted: false });
		};

		const activeSlide = (): Slide | undefined => {
			const { document, view } = get();
			if (!document) return undefined;
			return document.slides.find((slide) => slide.id === view.activeSlideId) ?? document.slides[0];
		};

		const selectSurvivor = (slides: Slide[], removedId: string): string => {
			const remaining = slides.filter((slide) => slide.id !== removedId);
			const index = slides.findIndex((slide) => slide.id === removedId);
			const survivor =
				remaining[Math.min(Math.max(index, 0), remaining.length - 1)] ?? remaining[0]!;
			return survivor.id;
		};

		return {
			document: null,
			view: initialView,
			savedRevision: -1,
			dirty: false,
			saving: false,
			saveError: null,
			past: [],
			future: [],
			lastHistoryGroup: null,

			loadDocument(document, options) {
				const clean = serializePresentationDocument(document);
				const saved = options?.saved ?? true;
				set({
					document: clean,
					view: { ...initialView, activeSlideId: clean.slides[0]?.id ?? null },
					savedRevision: saved ? clean.revision : -1,
					dirty: !saved,
					saving: false,
					saveError: null,
					past: [],
					future: [],
					lastHistoryGroup: null
				});
			},

			closeDocument() {
				set({
					document: null,
					view: initialView,
					savedRevision: -1,
					dirty: false,
					saving: false,
					saveError: null,
					past: [],
					future: [],
					lastHistoryGroup: null
				});
			},

			markSaving() {
				set({ saving: true, saveError: null });
			},

			markSaved(revision) {
				const document = get().document;
				set({
					saving: false,
					saveError: null,
					savedRevision: revision,
					dirty: document ? document.revision !== revision : false
				});
			},

			markSaveFailed(message) {
				set({ saving: false, saveError: message });
			},

			selectSlide(slideId) {
				const document = get().document;
				if (!document || !document.slides.some((slide) => slide.id === slideId)) return;
				set({
					view: {
						...get().view,
						activeSlideId: slideId,
						selectedElementIds: [],
						editingElementId: null,
						transformPreview: null,
						guides: []
					}
				});
			},

			selectElements(ids) {
				const document = get().document;
				if (!document) return;
				const slide = activeSlide();
				const valid = slide
					? ids.filter((id) => slide.elements.some((element) => element.id === id))
					: [];
				set({ view: { ...get().view, selectedElementIds: valid } });
			},

			toggleElementSelection(id, additive = false) {
				const current = get().view.selectedElementIds;
				if (!additive) {
					set({ view: { ...get().view, selectedElementIds: current.includes(id) ? [] : [id] } });
					return;
				}
				set({
					view: {
						...get().view,
						selectedElementIds: current.includes(id)
							? current.filter((existing) => existing !== id)
							: [...current, id]
					}
				});
			},

			startTextEdit(elementId) {
				const document = get().document;
				const element = document?.slides
					.flatMap((slide) => slide.elements)
					.find((candidate) => candidate.id === elementId);
				if (element?.kind !== 'text') return;
				set({
					view: { ...get().view, selectedElementIds: [elementId], editingElementId: elementId }
				});
			},

			endTextEdit() {
				if (get().view.editingElementId === null) return;
				set({ view: { ...get().view, editingElementId: null } });
			},

			setZoom(zoom) {
				set({ view: { ...get().view, zoom: Math.min(8, Math.max(0.1, zoom)) } });
			},

			setPan(pan) {
				set({ view: { ...get().view, pan } });
			},

			setTransformPreview(preview) {
				set({ view: { ...get().view, transformPreview: preview } });
			},

			setGuides(guides) {
				set({ view: { ...get().view, guides } });
			},

			commitTransform(elementId, geometry) {
				const element = get()
					.document?.slides.flatMap((slide) => slide.elements)
					.find((candidate) => candidate.id === elementId);
				if (!element || element.locked) return;
				const clean = normalizeTransform(geometry);
				if (!clean) return;
				get().transformElement(elementId, clean);
				// The gesture is over: the next drag on this element is its own undo entry.
				get().endHistoryGroup();
				if (get().view.transformPreview?.elementId === elementId) get().setTransformPreview(null);
				get().setGuides([]);
			},

			addSlide(afterSlideId) {
				const document = get().document;
				if (!document) return null;
				if (document.slides.length >= PRESENTATION_LIMITS.maxSlides) return null;
				// A new slide starts from the document theme, not the factory default, so a
				// presentation's own background default is what the next slide uses.
				const slide = createSlide({
					name: nextSlideName(document.slides),
					background: document.theme.colors.background
				});
				const anchor = afterSlideId ?? get().view.activeSlideId ?? document.slides.at(-1)!.id;
				commit((draft) => {
					const index = draft.slides.findIndex((candidate) => candidate.id === anchor);
					draft.slides.splice(index === -1 ? draft.slides.length : index + 1, 0, slide);
				});
				set({
					view: {
						...get().view,
						activeSlideId: slide.id,
						selectedElementIds: [],
						editingElementId: null
					}
				});
				return slide.id;
			},

			duplicateSlide(slideId) {
				const document = get().document;
				if (!document) return null;
				if (document.slides.length >= PRESENTATION_LIMITS.maxSlides) return null;
				const source = document.slides.find((slide) => slide.id === slideId);
				if (!source) return null;
				const copy: Slide = {
					...structuredClone(source),
					id: crypto.randomUUID(),
					name: `${source.name} copy`,
					elements: source.elements.map(cloneElementWithNewId)
				};
				commit((draft) => {
					const index = draft.slides.findIndex((slide) => slide.id === slideId);
					draft.slides.splice(index + 1, 0, copy);
				});
				set({
					view: {
						...get().view,
						activeSlideId: copy.id,
						selectedElementIds: [],
						editingElementId: null
					}
				});
				return copy.id;
			},

			renameSlide(slideId, name) {
				const trimmed = name.trim();
				if (!trimmed) return;
				commit((draft) => {
					const slide = draft.slides.find((candidate) => candidate.id === slideId);
					if (!slide || slide.name === trimmed) return false;
					slide.name = trimmed.slice(0, 200);
					return true;
				});
			},

			reorderSlide(slideId, targetIndex) {
				commit((draft) => {
					const index = draft.slides.findIndex((slide) => slide.id === slideId);
					if (index === -1) return false;
					const clamped = Math.max(0, Math.min(targetIndex, draft.slides.length - 1));
					if (clamped === index) return false;
					const [slide] = draft.slides.splice(index, 1);
					draft.slides.splice(clamped, 0, slide!);
					return true;
				});
			},

			removeSlide(slideId) {
				const document = get().document;
				if (!document || document.slides.length <= 1) return false;
				if (!document.slides.some((slide) => slide.id === slideId)) return false;
				const survivor = selectSurvivor(document.slides, slideId);
				commit((draft) => {
					draft.slides = draft.slides.filter((slide) => slide.id !== slideId);
					return true;
				});
				const editingWasRemoved =
					get().view.editingElementId !== null &&
					document.slides.some(
						(slide) =>
							slide.id === slideId &&
							slide.elements.some((element) => element.id === get().view.editingElementId)
					);
				if (get().view.activeSlideId === slideId)
					set({
						view: {
							...get().view,
							activeSlideId: survivor,
							selectedElementIds: [],
							editingElementId: null
						}
					});
				else if (editingWasRemoved) set({ view: { ...get().view, editingElementId: null } });
				return true;
			},

			setSlideBackground(slideId, background, options) {
				commit((draft) => {
					const slide = draft.slides.find((candidate) => candidate.id === slideId);
					if (!slide || slide.background === background) return false;
					slide.background = background;
					return true;
				}, options);
			},

			addElement(element) {
				const document = get().document;
				const slide = activeSlide();
				if (!document || !slide) return null;
				if (slide.elements.length >= PRESENTATION_LIMITS.maxElementsPerSlide) return null;
				if (slide.elements.some((candidate) => candidate.id === element.id)) return null;
				commit((draft) => {
					const target = draft.slides.find((candidate) => candidate.id === slide.id);
					if (!target) return false;
					target.elements.push(structuredClone(element));
					return true;
				});
				set({ view: { ...get().view, selectedElementIds: [element.id] } });
				return element.id;
			},

			duplicateElement(elementId) {
				const document = get().document;
				if (!document) return null;
				const slide = document.slides.find((candidate) =>
					candidate.elements.some((element) => element.id === elementId)
				);
				const source = slide?.elements.find((element) => element.id === elementId);
				if (!slide || !source) return null;
				if (slide.elements.length >= PRESENTATION_LIMITS.maxElementsPerSlide) return null;
				const index = slide.elements.findIndex((element) => element.id === elementId);
				const copy = cloneElementWithNewId(source);
				copy.name = `${source.name} copy`;
				copy.x = source.x + 24;
				copy.y = source.y + 24;
				commit((draft) => {
					const target = draft.slides.find((candidate) => candidate.id === slide.id);
					if (!target) return false;
					target.elements.splice(index + 1, 0, copy);
					return true;
				});
				set({ view: { ...get().view, selectedElementIds: [copy.id], editingElementId: null } });
				return copy.id;
			},

			checkImageInsert(image, options) {
				const document = get().document;
				if (!document)
					return {
						ok: false,
						reason: 'no-slide',
						message: 'Open a presentation before adding an image.'
					};
				const refusal = imageInsertRefusal(
					document,
					image,
					options?.slideId ?? activeSlide()?.id ?? null
				);
				return refusal ? { ok: false, ...refusal } : { ok: true };
			},

			adoptPersistedInsert(plan, image) {
				const current = get().document;
				// A command can land while the write is in flight (the write includes the media
				// put). The stored revision then holds the insert, and the live document holds
				// that command; both are real. Adopting the plan over the live document would
				// silently drop the command while reporting the document saved, so instead the
				// stored revision becomes the new base and the insert is replayed on top of what
				// the user is looking at. `dirty` is forced true: the live document and the stored
				// row can carry the same revision number while differing in content.
				if (
					current &&
					current.id === plan.document.id &&
					current.revision !== plan.document.revision - 1
				) {
					set({
						saving: false,
						saveError: null,
						savedRevision: plan.document.revision,
						dirty: true
					});
					// Re-plans against the live document. If it is refused now (a cap was
					// reached in the meantime) nothing is lost: the next write reconciles the
					// stored insert with the live document.
					replayInsert(plan, image);
					return;
				}
				applyInsert({ plan, persisted: true });
			},

			adoptPersistedReplacement(plan, image) {
				const current = get().document;
				// Same revision race as an insert: replay the replacement on the live document
				// instead of dropping a command that landed while the write was in flight.
				if (
					current &&
					current.id === plan.document.id &&
					current.revision !== plan.document.revision - 1
				) {
					set({
						saving: false,
						saveError: null,
						savedRevision: plan.document.revision,
						dirty: true
					});
					replayReplace(plan, image);
					return;
				}
				applyReplace({ plan, persisted: true });
			},

			adoptPersistedSlideInsertion(plan) {
				const current = get().document;
				if (
					current &&
					current.id === plan.document.id &&
					current.revision !== plan.document.revision - 1
				) {
					set({
						saving: false,
						saveError: null,
						savedRevision: plan.document.revision,
						dirty: true
					});
					replaySlideInsertion(plan);
					return;
				}
				applySlideInsertion({ plan, persisted: true });
			},

			updateElement(elementId, patch, options) {
				commit((draft) => {
					const element = draft.slides
						.flatMap((slide) => slide.elements)
						.find((candidate) => candidate.id === elementId);
					if (!element) return false;
					if (
						element.locked &&
						lockedPatchKeys.some((key) => Object.prototype.hasOwnProperty.call(patch, key))
					)
						return false;
					const target = element as unknown as Record<string, unknown>;
					let changed = false;
					for (const [key, value] of Object.entries(patch)) {
						if (sameValue(target[key], value as unknown)) continue;
						target[key] = structuredClone(value as unknown);
						changed = true;
					}
					return changed;
				}, options);
			},

			transformElement(elementId, patch, options) {
				const element = get()
					.document?.slides.flatMap((slide) => slide.elements)
					.find((candidate) => candidate.id === elementId);
				if (!element || element.locked) return;
				get().updateElement(elementId, patch as Partial<Element>, {
					historyGroup: options?.historyGroup ?? `transform:${elementId}`
				});
			},

			removeElement(elementId) {
				commit((draft) => {
					let removed = false;
					for (const slide of draft.slides) {
						const before = slide.elements.length;
						slide.elements = slide.elements.filter((element) => element.id !== elementId);
						if (slide.elements.length !== before) removed = true;
					}
					return removed;
				});
				set({
					view: {
						...get().view,
						selectedElementIds: get().view.selectedElementIds.filter((id) => id !== elementId),
						editingElementId:
							get().view.editingElementId === elementId ? null : get().view.editingElementId
					}
				});
			},

			reorderElement(elementId, targetIndex) {
				commit((draft) => {
					const slide = draft.slides.find((candidate) =>
						candidate.elements.some((element) => element.id === elementId)
					);
					if (!slide) return false;
					const index = slide.elements.findIndex((element) => element.id === elementId);
					const clamped = Math.max(0, Math.min(targetIndex, slide.elements.length - 1));
					if (index === clamped) return false;
					const [element] = slide.elements.splice(index, 1);
					slide.elements.splice(clamped, 0, element!);
					return true;
				});
			},

			toggleElementLocked(elementId) {
				commit((draft) => {
					const element = draft.slides
						.flatMap((slide) => slide.elements)
						.find((candidate) => candidate.id === elementId);
					if (!element) return false;
					element.locked = !element.locked;
					return true;
				});
			},

			toggleElementVisible(elementId) {
				commit((draft) => {
					const element = draft.slides
						.flatMap((slide) => slide.elements)
						.find((candidate) => candidate.id === elementId);
					if (!element) return false;
					element.visible = !element.visible;
					return true;
				});
			},

			updateText(elementId, paragraphs, options) {
				const element = get()
					.document?.slides.flatMap((slide) => slide.elements)
					.find((candidate) => candidate.id === elementId);
				if (element?.kind !== 'text' || element.locked) return;
				get().updateElement(elementId, { paragraphs }, options);
			},

			shrinkText(elementId) {
				const element = get()
					.document?.slides.flatMap((slide) => slide.elements)
					.find((candidate) => candidate.id === elementId);
				if (element?.kind !== 'text' || element.locked) return false;
				const fitted = shrinkTextToFit(element, measure);
				if (!fitted) return false;
				get().endHistoryGroup();
				get().updateElement(elementId, { paragraphs: fitted.paragraphs, autoGrow: false });
				get().endHistoryGroup();
				return true;
			},

			setTheme(theme, options) {
				commit((draft) => {
					if (JSON.stringify(draft.theme) === JSON.stringify(theme)) return false;
					draft.theme = structuredClone(theme);
					return true;
				}, options);
			},

			endHistoryGroup() {
				set({ lastHistoryGroup: null });
			},

			undo() {
				const { document, past, future, lastHistoryGroup } = get();
				if (!document) return;
				const step = stepBack({ past, future, lastHistoryGroup }, document);
				if (!step) return;
				set({
					document: step.restored,
					past: step.history.past,
					future: step.history.future,
					lastHistoryGroup: null,
					dirty: step.restored.revision !== get().savedRevision,
					view: ensureView(step.restored, get().view)
				});
			},

			redo() {
				const { document, past, future, lastHistoryGroup } = get();
				if (!document) return;
				const step = stepForward({ past, future, lastHistoryGroup }, document);
				if (!step) return;
				set({
					document: step.restored,
					past: step.history.past,
					future: step.history.future,
					lastHistoryGroup: null,
					dirty: step.restored.revision !== get().savedRevision,
					view: ensureView(step.restored, get().view)
				});
			}
		};
	});
}

function ensureView(
	document: PresentationDocument,
	view: PresentationViewState
): PresentationViewState {
	const slideExists = document.slides.some((slide) => slide.id === view.activeSlideId);
	const activeSlideId = slideExists ? view.activeSlideId : (document.slides[0]?.id ?? null);
	const slide = document.slides.find((candidate) => candidate.id === activeSlideId);
	const ids = new Set(slide?.elements.map((element) => element.id) ?? []);
	const editingElementId =
		view.editingElementId !== null &&
		slide?.elements.some(
			(element) => element.id === view.editingElementId && element.kind === 'text'
		)
			? view.editingElementId
			: null;
	return {
		...view,
		activeSlideId,
		selectedElementIds: view.selectedElementIds.filter((id) => ids.has(id)),
		editingElementId,
		transformPreview: null,
		guides: []
	};
}
