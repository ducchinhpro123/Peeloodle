import { getTextDirection } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';

/**
 * The generated scaffold wired Better Auth + Drizzle into `handle`; this local-first
 * slice does not use them, and loading them made every production request fail with a
 * "Drizzle schema mismatch" 500. Only the Paraglide locale passthrough remains.
 *
 * @type {import('@sveltejs/kit').Handle}
 */
export const handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) => {
		event.request = request;

		return resolve(event, {
			transformPageChunk: ({ html }) =>
				html
					.replace('%paraglide.lang%', locale)
					.replace('%paraglide.dir%', getTextDirection(locale))
		});
	});
