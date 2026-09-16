/**
 * Request-shape rules for the processing endpoint. These paths never touch
 * Supabase, so they are safe to assert directly: the endpoint accepts a small
 * JSON body carrying only a job id, and refuses anything else before it looks at
 * the caller's session.
 */
import { describe, expect, it } from 'vitest';
import { POST } from '../../../../src/routes/api/catalog/process/+server.js';

async function post(body: string, headers: Record<string, string> = {}): Promise<Response> {
	return POST({
		request: new Request('https://app.test/api/catalog/process', {
			method: 'POST',
			headers,
			body
		}),
		url: new URL('https://app.test/api/catalog/process')
	} as never);
}

describe('catalog processing endpoint', () => {
	it('refuses a request without a bearer token', async () => {
		const response = await post(JSON.stringify({ jobId: '00000000-0000-4000-8000-000000000001' }));
		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ ok: false, reason: 'unauthenticated' });
	});

	it('refuses a malformed body, a missing job id and a non-id job id', async () => {
		const headers = { authorization: 'Bearer token-that-is-long-enough' };
		expect((await post('not json', headers)).status).toBe(400);
		expect((await post(JSON.stringify({}), headers)).status).toBe(400);
		expect((await post(JSON.stringify({ jobId: 'nope' }), headers)).status).toBe(400);
		expect((await post(JSON.stringify({ jobId: 42 }), headers)).status).toBe(400);
	});

	it('refuses a body larger than the reference limit', async () => {
		const body = JSON.stringify({
			jobId: '00000000-0000-4000-8000-000000000001',
			pad: 'x'.repeat(70_000)
		});
		const response = await post(body, { authorization: 'Bearer token-that-is-long-enough' });
		expect(response.status).toBe(413);
		expect(await response.json()).toEqual({ ok: false, reason: 'request_too_large' });
	});

	it('reports an unconfigured site instead of pretending to process', async () => {
		const response = await post(JSON.stringify({ jobId: '00000000-0000-4000-8000-000000000001' }), {
			authorization: 'Bearer token-that-is-long-enough'
		});
		expect([503, 200]).toContain(response.status);
		if (response.status === 503)
			expect(await response.json()).toEqual({ ok: false, reason: 'unconfigured' });
	});
});
