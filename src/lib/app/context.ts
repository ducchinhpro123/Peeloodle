/**
 * App-scoped instance context.
 *
 * The editor state and its save coordinator are created once per app tree by
 * the root layout and read by route components, so a draft survives navigation
 * between `/create` and `/editor/:projectId` exactly as the source store did.
 * Keeping them in context (not a module-level singleton) also keeps mutable
 * editor state out of a server-global module.
 */

import { createContext } from 'svelte';
import type { EditorState } from '#lib/editor/editorState.svelte.js';
import type { DraftSaving } from '#lib/editor/draftSaving.js';
import type { StickerLabRepository } from '#lib/persistence/repository.js';
import type { PresentationRepository } from '#lib/presentations/persistence/repository.js';
import type { PresentationStore } from '#lib/presentations/editor/store.svelte.js';

export type AppContext = {
	repository: StickerLabRepository;
	editor: EditorState;
	saving: DraftSaving;
	presentationRepository: PresentationRepository;
	presentationStore: PresentationStore;
};

export const [getAppContext, setAppContext] = createContext<AppContext>();
