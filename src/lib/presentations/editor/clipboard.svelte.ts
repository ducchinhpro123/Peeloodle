/** Element snapshots plus browser clipboard interop, scoped to one editor. */
import type { Element } from '../model/types';
import { PRESENTATION_LIMITS } from '../model/limits';
import type { DocumentState } from './document/documentState.svelte';
import type { SelectionState } from './selection.svelte';
import type { TextEditSession } from './textEditSession.svelte';

type Entry = {
	documentId: string;
	slideId: string;
	elements: Element[];
	pastesBySlide: Record<string, number>;
};
type ExternalPaste = {
	text(value: string): void;
	image(file: File): void | Promise<void>;
};
export type Clipboard = {
	readonly canPaste: boolean;
	copy(cut?: boolean, data?: DataTransfer): boolean;
	paste(): Promise<void>;
	pasteData(data: DataTransfer): void;
	configure(handlers: ExternalPaste): void;
};
const MIME = 'application/x-peeloodle-elements+json';
const MAX_CLIPBOARD = PRESENTATION_LIMITS.maxDocumentChars;

export function createClipboard(input: {
	doc: DocumentState;
	selection: SelectionState;
	text: TextEditSession;
	report(message: string): void;
}): Clipboard {
	const { doc, selection, text, report } = input;
	let entry = $state.raw<Entry | null>(null);
	let handlers: ExternalPaste | null = null;
	let busy = false;
	const fail = () =>
		report(
			'The elements could not be pasted. Check slide capacity and that their artwork is in this deck.'
		);
	const pasteEntry = (copied: Entry) => {
		const document = doc.document;
		const slideId = selection.activeSlideId;
		if (!document || !slideId || selection.editingId) return;
		if (
			copied.documentId !== document.id &&
			copied.elements.some((element) => element.kind === 'image')
		)
			return fail();
		const count = copied.pastesBySlide[slideId] ?? 0;
		const offset = 24 * (count + (slideId === copied.slideId ? 1 : 0));
		try {
			if (!doc.pasteElements(copied.elements, offset).length) return fail();
			entry = { ...copied, pastesBySlide: { ...copied.pastesBySlide, [slideId]: count + 1 } };
		} catch {
			fail();
		}
	};
	const accept = (plain: string, html = '', json = '') => {
		try {
			if (!json && html.length <= MAX_CLIPBOARD) {
				const node = new DOMParser()
					.parseFromString(html, 'text/html')
					.querySelector('[data-peeloodle-elements]');
				json = node?.getAttribute('data-peeloodle-elements') ?? '';
			}
			if (json) {
				if (json.length > MAX_CLIPBOARD) throw new Error('Too large');
				const value = JSON.parse(json);
				if (
					value.version !== 1 ||
					!Array.isArray(value.elements) ||
					!value.elements.length ||
					value.elements.length > PRESENTATION_LIMITS.maxElementsPerSlide
				)
					throw new Error('Invalid clipboard');
				// Reuse cascade state only for the exact snapshot still on the clipboard.
				const copied =
					entry &&
					JSON.stringify(entry.elements) === JSON.stringify(value.elements) &&
					entry.documentId === value.documentId
						? entry
						: {
								documentId: value.documentId,
								slideId: value.slideId,
								elements: value.elements,
								pastesBySlide: {}
							};
				pasteEntry(copied);
			} else if (plain.trim()) {
				handlers?.text(plain);
			} else report('There is no text, image or slide element to paste.');
		} catch {
			report('This clipboard content could not be pasted. Copy it again and retry.');
		}
	};
	return {
		get canPaste() {
			return doc.document !== null && !selection.editingId;
		},
		configure(next) {
			handlers = next;
		},
		copy(cut = false, data) {
			text.flush();
			const document = doc.document;
			const slide = selection.activeSlide;
			const elements =
				slide?.elements.filter(
					(element) => selection.ids.includes(element.id) && (!cut || !element.locked)
				) ?? [];
			if (!document || !slide || !elements.length || selection.editingId) return false;
			entry = {
				documentId: document.id,
				slideId: slide.id,
				elements: structuredClone(elements),
				pastesBySlide: {}
			};
			const json = JSON.stringify({
				version: 1,
				documentId: document.id,
				slideId: slide.id,
				elements
			});
			const plain = elements
				.map((element) =>
					element.kind === 'text'
						? element.paragraphs
								.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
								.join('\n')
						: element.name
				)
				.join('\n');
			const escapeHtml = (value: string) =>
				value
					.replaceAll('&', '&amp;')
					.replaceAll('"', '&quot;')
					.replaceAll('<', '&lt;')
					.replaceAll('>', '&gt;');
			const html = `<div data-peeloodle-elements="${escapeHtml(json)}" style="white-space: pre-wrap">${escapeHtml(plain)}</div>`;
			if (data) {
				data.setData(MIME, json);
				data.setData('text/plain', plain);
				data.setData('text/html', html);
			} else
				try {
					void navigator.clipboard
						.write([
							new ClipboardItem({
								'text/plain': new Blob([plain], { type: 'text/plain' }),
								'text/html': new Blob([html], { type: 'text/html' })
							})
						])
						.catch(() =>
							report(
								'System clipboard access was blocked. Your copied elements are available in this editor.'
							)
						);
				} catch {
					report(
						'System clipboard access is unavailable. Your copied elements are available in this editor.'
					);
				}
			if (cut) doc.removeElements(elements.map((element) => element.id));
			return true;
		},
		pasteData(data) {
			if (selection.editingId) return;
			const file = Array.from(data.files).find((file) => file.type.startsWith('image/'));
			if (file) {
				void handlers?.image(file);
				return;
			}
			accept(data.getData('text/plain'), data.getData('text/html'), data.getData(MIME));
		},
		async paste() {
			if (selection.editingId || busy) return;
			busy = true;
			const documentId = doc.document?.id;
			const slideId = selection.activeSlideId;
			const current = () =>
				doc.document?.id === documentId &&
				selection.activeSlideId === slideId &&
				!selection.editingId;
			try {
				const items = await navigator.clipboard.read();
				let plain = '',
					html = '';
				for (const item of items) {
					const imageType = item.types.find((type) => type.startsWith('image/'));
					if (imageType) {
						const blob = await item.getType(imageType);
						if (current())
							await handlers?.image(new File([blob], 'Clipboard image', { type: imageType }));
						return;
					}
					if (item.types.includes('text/plain'))
						plain = await (await item.getType('text/plain')).text();
					if (item.types.includes('text/html'))
						html = await (await item.getType('text/html')).text();
				}
				if (current()) accept(plain, html);
			} catch {
				if (current()) {
					if (entry) pasteEntry(entry);
					else
						report(
							'Clipboard access was blocked. Allow clipboard access in your browser, or use Ctrl+V on the canvas.'
						);
				}
			} finally {
				busy = false;
			}
		}
	};
}
