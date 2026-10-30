/**
 * The mounted slide editor, shared with every component inside the editor page
 * without prop drilling. Context (not a module singleton) keeps it per mount.
 */

import { createContext } from 'svelte';
import type { SlideEditor } from './createSlideEditor.svelte';

export const [getSlideEditor, setSlideEditor] = createContext<SlideEditor>();
