/**
 * Optional public cloud configuration and the lazily created Supabase client.
 *
 * The source's public names are kept (`VITE_SUPABASE_URL`,
 * `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_AUTH_ALLOWED_ORIGINS`). Without valid
 * public configuration the app stays fully local-only. Only a publishable/anon
 * key is ever read here: no private or service-role credential may reach the
 * browser, and no cookie/session-server architecture is added.
 *
 * The validation rules are split into `parseCloudConfig` so they are testable
 * without a window, and the real client is imported lazily so a local-only
 * session never pays for (or fetches) `@supabase/supabase-js`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database';

export type PublicCloudConfig = { url: string; key: string; origins: string[] };

function envValue(name: string): string {
	const value = (import.meta.env as Record<string, unknown>)[name];
	return typeof value === 'string' ? value : '';
}

export type CloudConfigInput = {
	url: string;
	key: string;
	origins: string;
	/** The origin the page is really served from; must be an exact allowed one. */
	origin: string;
};

/**
 * Accepts only a Supabase project URL (https on `*.supabase.co`, or http/https
 * on localhost for development), a publishable or legacy `anon` key, and an
 * exact origin match. Anything else keeps the app local-only.
 */
export function parseCloudConfig(input: CloudConfigInput): PublicCloudConfig | null {
	try {
		const url = new URL(input.url);
		const key = input.key;
		const local = ['localhost', '127.0.0.1'].includes(url.hostname);
		if (
			(!local && (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co'))) ||
			(local && !['http:', 'https:'].includes(url.protocol)) ||
			url.username ||
			url.password
		)
			return null;
		const legacy = key.split('.');
		const publicKey =
			/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key) ||
			(legacy.length === 3 &&
				JSON.parse(atob(legacy[1]!.replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon');
		const origins = input.origins
			.split(',')
			.map((origin) => origin.trim())
			.filter(Boolean);
		if (!publicKey || !origins.includes(input.origin)) return null;
		return { url: url.origin, key, origins };
	} catch {
		return null;
	}
}

/** Server-rendered output is always local-only; the client reads the real origin. */
export function readCloudConfig(): PublicCloudConfig | null {
	if (typeof window === 'undefined') return null;
	return parseCloudConfig({
		url: envValue('VITE_SUPABASE_URL'),
		key: envValue('VITE_SUPABASE_PUBLISHABLE_KEY'),
		origins: envValue('VITE_AUTH_ALLOWED_ORIGINS'),
		origin: window.location.origin
	});
}

let client: SupabaseClient<Database> | null | undefined;
let pending: Promise<SupabaseClient<Database> | null> | undefined;

export async function getAuthClient(): Promise<SupabaseClient<Database> | null> {
	if (client !== undefined) return client;
	if (!pending) {
		pending = (async () => {
			const config = readCloudConfig();
			if (!config) return (client = null);
			const { createClient } = await import('@supabase/supabase-js');
			return (client = createClient<Database>(config.url, config.key, {
				auth: { flowType: 'pkce', detectSessionInUrl: false }
			}));
		})();
	}
	return pending;
}

/**
 * Only known routes; no protocol-relative, encoded slash, backslash, or
 * arbitrary URL. The admin sections are included so a deep link that started a
 * sign-in returns to the same screen.
 */
export function safeReturnPath(value: string | null): string {
	return value &&
		/^(\/|\/create|\/templates|\/my-stickers|\/editor\/[a-zA-Z0-9-]+|\/admin(\/(assets|collections|uploads|templates))?)$/.test(
			value
		)
		? value
		: '/my-stickers';
}
