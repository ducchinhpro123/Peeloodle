/**
 * In-app element clipboard for one mounted slide editor.
 *
 * A copy is a snapshot of one element plus how often it was pasted per slide,
 * so repeated pastes cascade instead of stacking exactly on top of each other.
 * Pastes stay within the deck the element came from, which still holds its
 * artwork.
 */

import type { Element } from '../model/types';
import type { DocumentState } from './document/documentState.svelte';
import type { SelectionState } from './selection.svelte';
import type { TextEditSession } from './textEditSession.svelte';

export type PasteResult = { ok: true } | { ok: false; reason: string; message: string };

type Entry = {
	documentId: string;
	slideId: string;
	element: Element;
	pastesBySlide: Record<string, number>;
};

export type Clipboard = {
	/** True when the copied element belongs to the open deck. */
	readonly canPaste: boolean;
	copy(): boolean;
	paste(): PasteResult;
};

/** Offset of each successive paste, in document units. */
const PASTE_STEP = 24;

export function createClipboard(input: {
	doc: DocumentState;
	selection: SelectionState;
	text: TextEditSession;
}): Clipboard {
	const { doc, selection, text } = input;
	let entry = $state.raw<Entry | null>(null);

	return {
		get canPaste() {
			return entry !== null && entry.documentId === doc.document?.id;
		},
		copy() {
			text.flush();
			const document = doc.document;
			const slide = selection.activeSlide;
			const element = selection.primary;
			if (!document || !slide || !element || selection.editingId) return false;
			entry = {
				documentId: document.id,
				slideId: slide.id,
				element: structuredClone(element),
				pastesBySlide: {}
			};
			return true;
		},
		paste() {
			const copied = entry;
			const document = doc.document;
			const slideId = selection.activeSlideId;
			if (!copied || !document || copied.documentId !== document.id || !slideId) {
				return { ok: false, reason: 'empty', message: 'There is nothing to paste.' };
			}
			if (selection.editingId)
				return { ok: false, reason: 'editing', message: 'Finish editing text first.' };
			const previousPastes = copied.pastesBySlide[slideId] ?? 0;
			const offset = PASTE_STEP * (previousPastes + (slideId === copied.slideId ? 1 : 0));
			try {
				const id = doc.pasteElement(copied.element, offset);
				if (!id) {
					return {
						ok: false,
						reason: 'refused',
						message:
							'The element could not be pasted. Check the slide capacity and that its artwork is still in this deck.'
					};
				}
				entry = {
					...copied,
					pastesBySlide: { ...copied.pastesBySlide, [slideId]: previousPastes + 1 }
				};
				return { ok: true };
			} catch {
				return {
					ok: false,
					reason: 'failed',
					message: 'The element could not be pasted into this slide.'
				};
			}
		}
	};
}
