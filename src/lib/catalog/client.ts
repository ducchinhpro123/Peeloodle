/**
 * Catalog repository accessor for routes and components.
 *
 * The Supabase client is the shared PKCE client from `#lib/cloud/config.js`, so the
 * session that signed in is the session every catalog call runs with. Without
 * public cloud configuration there is no catalog and callers render the honest
 * "not configured" state instead.
 */
import { getAuthClient } from '#lib/cloud/config.js';
import { SupabaseCatalog } from './remote';

let cached: SupabaseCatalog | null = null;

export async function getCatalogRepository(): Promise<SupabaseCatalog | null> {
	const auth = await getAuthClient();
	if (!auth) return null;
	cached ??= new SupabaseCatalog(auth);
	return cached;
}
