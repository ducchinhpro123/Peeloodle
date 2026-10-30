/**
 * How a mounted slide editor persists its document and what it may do.
 *
 * The same editor serves local presentations (IndexedDB, autosave) and catalog
 * template drafts (one immutable version per explicit save, catalog artwork
 * only). Everything that differs between the two lives here, so components ask
 * a capability or read a label instead of branching on a mode.
 */

import {
	describeTemplateSaveFailure,
	TEMPLATE_SAVE_CONFLICT_MESSAGE
} from '../../templates/templateDraftRepository';

export type EditorPolicy = {
	kind: 'local' | 'template';
	capabilities: {
		/** Debounced autosave and a save when the page is hidden. */
		autosave: boolean;
		/** Pictures from the device, including replacing a picture. */
		localMedia: boolean;
		/** PDF, PPTX and backup downloads (also the backup fallback after a failed save). */
		export: boolean;
		saveAsTemplate: boolean;
		stickers: boolean;
		templateSlides: boolean;
	};
	labels: {
		heading: string;
		save: string;
		saving: string;
		saved: string;
		/** Shown after an explicit save succeeds; null when the status line says enough. */
		savedNote: string | null;
		/** Shown when a held navigation could not save. */
		leaveFailure: string;
	};
	describeFailure?: (error: unknown) => string;
	conflictMessage?: string;
	/**
	 * `keep-copy` writes the local edits as a separate copy; `reload-draft`
	 * discards them for the newer server draft, so leaving during a conflict is
	 * refused until the administrator chooses.
	 */
	conflictRecovery: 'keep-copy' | 'reload-draft';
};

export const localPolicy: EditorPolicy = {
	kind: 'local',
	capabilities: {
		autosave: true,
		localMedia: true,
		export: true,
		saveAsTemplate: true,
		stickers: true,
		templateSlides: true
	},
	labels: {
		heading: 'Presentation',
		save: 'Save',
		saving: 'Saving…',
		saved: 'Saved in this browser',
		savedNote: null,
		leaveFailure:
			'This presentation could not be saved, so it is still open. Press Save to try again — or press Keep my copy if another tab or window has a newer version.'
	},
	conflictRecovery: 'keep-copy'
};

export const templatePolicy: EditorPolicy = {
	kind: 'template',
	capabilities: {
		autosave: false,
		localMedia: false,
		export: false,
		saveAsTemplate: false,
		stickers: false,
		templateSlides: false
	},
	labels: {
		heading: 'Template draft',
		save: 'Save version',
		saving: 'Saving version…',
		saved: 'Draft saved',
		savedNote: 'Saved as a new draft version.',
		leaveFailure:
			'This draft could not be saved, so it is still open. Press Save version to try again — or reload the draft to discard these changes.'
	},
	describeFailure: describeTemplateSaveFailure,
	conflictMessage: TEMPLATE_SAVE_CONFLICT_MESSAGE,
	conflictRecovery: 'reload-draft'
};
