/**
 * Selection for one mounted slide editor: the active slide, the selected
 * elements on it and the text box being edited.
 *
 * The values live in the document record's `view` so a command can change the
 * document and the selection in one update (undo, slide removal); this module is
 * the only surface components use to read or change them.
 */

import type { Element, Slide } from '../model/types';
import type { DocumentState } from './document/documentState.svelte';

export type SelectionState = {
	readonly activeSlideId: string | null;
	readonly activeSlide: Slide | undefined;
	readonly ids: string[];
	/** Selected elements on the active slide, in selection order. */
	readonly elements: Element[];
	/** The first selected element; inspectors and single-element commands use it. */
	readonly primary: Element | null;
	readonly editingId: string | null;
	selectSlide(slideId: string): void;
	select(ids: string[]): void;
	toggle(id: string, additive?: boolean): void;
	clear(): void;
	startTextEdit(elementId: string): void;
	endTextEdit(): void;
};

export function createSelection(doc: DocumentState): SelectionState {
	const activeSlide = () => {
		const document = doc.document;
		return (
			document?.slides.find((slide) => slide.id === doc.view.activeSlideId) ?? document?.slides[0]
		);
	};
	const elements = () => {
		const slide = activeSlide();
		if (!slide) return [];
		return doc.view.selectedElementIds
			.map((id) => slide.elements.find((element) => element.id === id))
			.filter((element): element is Element => element !== undefined);
	};
	return {
		get activeSlideId() {
			return doc.view.activeSlideId;
		},
		get activeSlide() {
			return activeSlide();
		},
		get ids() {
			return doc.view.selectedElementIds;
		},
		get elements() {
			return elements();
		},
		get primary() {
			return elements()[0] ?? null;
		},
		get editingId() {
			return doc.view.editingElementId;
		},
		selectSlide: (slideId) => doc.selectSlide(slideId),
		select: (ids) => doc.selectElements(ids),
		toggle: (id, additive) => doc.toggleElementSelection(id, additive),
		clear: () => doc.selectElements([]),
		startTextEdit: (elementId) => doc.startTextEdit(elementId),
		endTextEdit: () => doc.endTextEdit()
	};
}
