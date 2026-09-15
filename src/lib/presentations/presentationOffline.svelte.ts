/**
 * The presentation offline record for this app session, plus its component bridge.
 *
 * This is the one place that knows how the app is served: SvelteKit fetches a route's
 * own chunk on navigation, so readiness has to prepare both the shared module list and
 * the two routes' code (`preloadCode`), and it has to wait for the presentation fonts
 * before it may claim the session is ready. The framework-independent state machine and
 * its wording live in `offlineReadiness.ts`.
 *
 * The work waits for an idle moment so it does not compete with the page's own route and
 * font loading; the timeout keeps that wait bounded on a busy page.
 */

import { preloadCode } from '$app/navigation';
import {
	createPresentationOfflineReadiness,
	type PresentationOfflineSnapshot
} from './offlineReadiness';
import { PRESENTATION_OFFLINE_MODULES, PRESENTATION_OFFLINE_ROUTES } from './offlineModules';
import { ensurePresentationFonts } from './rendering/fonts';

/**
 * The route chunks the client router will need, or nothing outside a SvelteKit page.
 *
 * Component tests render these pages into a bare document with no SvelteKit app, so the
 * router has no route manifest to preload against; `app.html` declares the preload
 * contract the real document carries. The production offline journey is what proves the
 * preload itself, not this guard.
 */
function preloadPresentationRoutes(): Promise<void>[] {
	if (
		typeof document === 'undefined' ||
		!document.body.hasAttribute('data-sveltekit-preload-data')
	) {
		return [];
	}
	return PRESENTATION_OFFLINE_ROUTES.map((route) => preloadCode(route));
}

/** One record per page session: every presentation route below shares it. */
export const presentationOffline = createPresentationOfflineReadiness({
	isOnline: () => navigator.onLine !== false,
	prepare: async () => {
		await Promise.all([
			...preloadPresentationRoutes(),
			ensurePresentationFonts(),
			...PRESENTATION_OFFLINE_MODULES.map((load) => load())
		]);
	}
});

function whenIdle(task: () => void): () => void {
	if (typeof requestIdleCallback === 'function') {
		const handle = requestIdleCallback(task, { timeout: 2_000 });
		return () => cancelIdleCallback(handle);
	}
	const handle = setTimeout(task, 0);
	return () => clearTimeout(handle);
}

/** Current readiness snapshot plus the effect that starts the warm-up once. */
export function usePresentationOfflineReadiness(): {
	get snapshot(): PresentationOfflineSnapshot;
} {
	let snapshot = $state.raw(presentationOffline.getSnapshot());
	$effect(() => {
		const unsubscribe = presentationOffline.subscribe(
			() => (snapshot = presentationOffline.getSnapshot())
		);
		const cancel = whenIdle(() => void presentationOffline.prepare());
		return () => {
			unsubscribe();
			cancel();
		};
	});
	return {
		get snapshot() {
			return snapshot;
		}
	};
}
