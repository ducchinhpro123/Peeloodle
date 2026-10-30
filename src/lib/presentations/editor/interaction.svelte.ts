/** In-progress gesture feedback (transform preview, alignment guides); never saved. */

import type { AlignmentGuide } from './alignmentGuides';
import type { DocumentState, TransformPreview } from './document/documentState.svelte';

export type InteractionState = {
	readonly preview: TransformPreview | null;
	readonly guides: AlignmentGuide[];
	setPreview(preview: TransformPreview | null): void;
	setGuides(guides: AlignmentGuide[]): void;
};

export function createInteraction(doc: DocumentState): InteractionState {
	return {
		get preview() {
			return doc.view.transformPreview;
		},
		get guides() {
			return doc.view.guides;
		},
		setPreview: (preview) => doc.setTransformPreview(preview),
		setGuides: (guides) => doc.setGuides(guides)
	};
}
