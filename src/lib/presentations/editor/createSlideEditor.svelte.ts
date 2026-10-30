/**
 * Composition root for one mounted slide editor.
 *
 * The page creates exactly one editor per opened deck and drops it on unmount,
 * so a document, its selection and its undo history can never outlive the deck
 * they belong to or be seen by the next one.
 */

import type { PresentationRepository } from '../persistence/repository';
import { createPresentationExport, type PresentationExportController } from './exportController';
import {
	createPresentationSaving,
	type PresentationSaving
} from './persistence/persistence.svelte';
import { createDocumentState, type DocumentState } from './document/documentState.svelte';
import { createTextEditSession, type TextEditSession } from './textEditSession.svelte';
import { createSelection, type SelectionState } from './selection.svelte';
import { createViewport, type ViewportState } from './viewport.svelte';
import { createInteraction, type InteractionState } from './interaction.svelte';
import { createClipboard, type Clipboard } from './clipboard.svelte';
import { createMessages, type MessageBar } from './messages.svelte';
import { createActionRegistry, type ActionRegistry } from './actions/registry';
import { editingActions } from './actions/editing';
import { arrangeActions } from './actions/arrange';
import { viewActions } from './actions/view';
import { slideActions } from './actions/slides';
import { createEditorUi, type EditorUi } from './ui.svelte';
import { createEditorArtwork, type EditorArtwork } from './artwork.svelte';
import { createEditorInserts, type EditorInserts, type EditorServices } from './inserts.svelte';

export type SlideEditor = {
	doc: DocumentState;
	selection: SelectionState;
	viewport: ViewportState;
	interaction: InteractionState;
	clipboard: Clipboard;
	messages: MessageBar;
	actions: ActionRegistry;
	/** Ribbon, task pane and context menu state for this editor. */
	ui: EditorUi;
	/** The open deck's decoded pictures. */
	artwork: EditorArtwork;
	/** Text, shape, layout, picture and template-slide insertion. */
	inserts: EditorInserts;
	/** The editor that opens a text session owns it; saves and exports flush through it. */
	text: TextEditSession;
	persistence: PresentationSaving;
	exports: PresentationExportController;
};

export type SlideEditorInput = {
	presentationId: string;
	repository: PresentationRepository;
	/** Overrides the local-storage failure copy (template mode supplies one). */
	describeFailure?: (error: unknown) => string;
	conflictMessage?: string;
	/** Repositories that may arrive after mount; read through getters. */
	services: EditorServices;
};

export function createSlideEditor(input: SlideEditorInput): SlideEditor {
	const { presentationId, repository } = input;
	const doc = createDocumentState();
	const text = createTextEditSession();
	const persistence = createPresentationSaving({
		repository,
		documentId: presentationId,
		flushText: () => text.flush(),
		doc,
		describeFailure: input.describeFailure,
		conflictMessage: input.conflictMessage
	});
	const exports = createPresentationExport({
		repository,
		getDocument: () => doc.document,
		flushText: () => text.flush(),
		// Read at failure time: whether a reload is safe depends on the live write state.
		reloadSafety: () => {
			const status = persistence.getStatus().status;
			return {
				unsavedWork: doc.dirty,
				saveFailed: status === 'failed' || status === 'conflict'
			};
		}
	});
	const selection = createSelection(doc);
	const messages = createMessages();
	const artwork = createEditorArtwork(repository);
	const editor: SlideEditor = {
		doc,
		selection,
		viewport: createViewport(doc),
		interaction: createInteraction(doc),
		clipboard: createClipboard({
			doc,
			selection,
			text,
			report: (message) => messages.show(message)
		}),
		messages,
		ui: createEditorUi(selection),
		artwork,
		inserts: createEditorInserts({
			repository,
			doc,
			selection,
			text,
			messages,
			persistence,
			artwork,
			services: input.services
		}),
		// Assigned below: actions receive the finished editor.
		actions: undefined!,
		text,
		persistence,
		exports
	};
	editor.actions = createActionRegistry(
		editor,
		[...editingActions, ...arrangeActions, ...viewActions, ...slideActions],
		(message) => messages.show(message)
	);
	return editor;
}
