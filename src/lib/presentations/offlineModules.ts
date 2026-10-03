/**
 * The modules the presentation flow needs to keep working after the connection drops.
 *
 * A static host serves each of these as its own chunk and cannot serve it again once
 * the network is gone, so readiness fetches them while the connection is there. The
 * list is explicit because the canvas is a child chunk of the editor route: opening
 * the editor is not enough to have it in memory.
 */
import { EXPORT_BUILDER_LOADERS } from './exports/loaders';

export const PRESENTATION_OFFLINE_MODULES = [
	() => import('#lib/components/PresentationsPage.svelte'),
	() => import('#lib/components/presentation/PresentationEditorPage.svelte'),
	() => import('#lib/components/presentation/PresentationCanvas.svelte'),
	...EXPORT_BUILDER_LOADERS
] as const;

/**
 * The routes above are only half of it in SvelteKit: each route also has its own
 * generated node chunk that the client router imports on navigation, and importing a
 * component never fetches it. `preloadCode` on a concrete pathname is what pulls a
 * route's node chunk in, so these paths are warmed alongside the module list. Any
 * concrete id matches the editor's dynamic segment; nothing navigates here.
 */
export const PRESENTATION_OFFLINE_ROUTES = [
	'/presentations',
	'/presentations/offline-session'
] as const;
