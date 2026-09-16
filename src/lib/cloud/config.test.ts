/**
 * Public cloud configuration rules. These matter because the app must stay
 * local-only unless the page's exact origin is allowed and the key is really a
 * publishable/anon key; a private or service key must never be accepted here.
 */

import { describe, expect, it } from 'vitest';
import { parseCloudConfig, safeReturnPath } from './config';

const good = {
	url: 'https://synthetic-test.supabase.co',
	key: `sb_publishable_${'a'.repeat(24)}`,
	origins: 'http://localhost:4173, https://app.example',
	origin: 'http://localhost:4173'
};

function legacyAnonKey(payload: Record<string, unknown>): string {
	const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
	return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

describe('parseCloudConfig', () => {
	it('accepts a publishable key on an allowed origin', () => {
		expect(parseCloudConfig(good)).toEqual({
			url: 'https://synthetic-test.supabase.co',
			key: good.key,
			origins: ['http://localhost:4173', 'https://app.example']
		});
	});

	it('accepts a legacy anon key but never a service-role key', () => {
		expect(parseCloudConfig({ ...good, key: legacyAnonKey({ role: 'anon' }) })).not.toBeNull();
		expect(parseCloudConfig({ ...good, key: legacyAnonKey({ role: 'service_role' }) })).toBeNull();
	});

	it('rejects a non-Supabase host, http outside localhost, and credentials in the URL', () => {
		expect(parseCloudConfig({ ...good, url: 'https://example.com' })).toBeNull();
		expect(parseCloudConfig({ ...good, url: 'http://synthetic-test.supabase.co' })).toBeNull();
		expect(
			parseCloudConfig({ ...good, url: 'https://user:pass@synthetic-test.supabase.co' })
		).toBeNull();
		expect(parseCloudConfig({ ...good, url: 'not a url' })).toBeNull();
	});

	it('rejects an origin the page is not served from', () => {
		expect(parseCloudConfig({ ...good, origin: 'http://127.0.0.1:4173' })).toBeNull();
		expect(parseCloudConfig({ ...good, origins: '' })).toBeNull();
	});

	it('rejects a malformed key', () => {
		expect(parseCloudConfig({ ...good, key: '' })).toBeNull();
		expect(parseCloudConfig({ ...good, key: 'anon' })).toBeNull();
		expect(parseCloudConfig({ ...good, key: `sb_publishable_short` })).toBeNull();
	});
});

describe('safeReturnPath', () => {
	it('allows only known routes', () => {
		expect(safeReturnPath('/')).toBe('/');
		expect(safeReturnPath('/create')).toBe('/create');
		expect(safeReturnPath('/templates')).toBe('/templates');
		expect(safeReturnPath('/my-stickers')).toBe('/my-stickers');
		expect(safeReturnPath('/editor/abc-123')).toBe('/editor/abc-123');
		expect(safeReturnPath('/admin')).toBe('/admin');
		expect(safeReturnPath('/admin/collections')).toBe('/admin/collections');
		expect(safeReturnPath('/admin/templates')).toBe('/admin/templates');
	});

	it('falls back for arbitrary or encoded destinations', () => {
		expect(safeReturnPath(null)).toBe('/my-stickers');
		expect(safeReturnPath('//evil.example')).toBe('/my-stickers');
		expect(safeReturnPath('/editor/../../etc')).toBe('/my-stickers');
		expect(safeReturnPath('/editor/%2F..%2Fetc')).toBe('/my-stickers');
		expect(safeReturnPath('/presentations')).toBe('/my-stickers');
		expect(safeReturnPath('https://evil.example')).toBe('/my-stickers');
	});
});
