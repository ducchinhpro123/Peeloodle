/**
 * Trusted processing endpoint (P56/P57).
 *
 * The browser posts `{ jobId }` and its Supabase access token; this function
 * claims that job with a lease, downloads the reserved source object, validates
 * and derives it with the native decoder, stores the immutable derivatives and
 * finalizes the version. Image bytes never travel in the request body and no
 * arbitrary URL is ever fetched: the source path comes from the claimed row.
 *
 * The caller's own JWT is used for every Supabase call, so row policies and the
 * admin check apply exactly as they do in the browser — no service-role key
 * exists here. Without a server deployment this route does not exist, and the
 * dashboard says so instead of pretending a file was validated.
 */
import { error, json } from '@sveltejs/kit';
import { parseCloudConfig } from '$lib/cloud/config';
import { SupabaseCatalog } from '$lib/catalog/remote';
import { runProcessingJob } from '$lib/catalog/processing/runJob';
import { processAssetBytes } from '$lib/catalog/processing/index';

const MAX_REQUEST_BYTES = 64 * 1024;

/**
 * @param {string} origin
 */
function publicConfig(origin) {
	const env = /** @type {Record<string, unknown>} */ (import.meta.env);
	return parseCloudConfig({
		url: typeof env.VITE_SUPABASE_URL === 'string' ? env.VITE_SUPABASE_URL : '',
		key:
			typeof env.VITE_SUPABASE_PUBLISHABLE_KEY === 'string'
				? env.VITE_SUPABASE_PUBLISHABLE_KEY
				: '',
		origins: typeof env.VITE_AUTH_ALLOWED_ORIGINS === 'string' ? env.VITE_AUTH_ALLOWED_ORIGINS : '',
		origin
	});
}

/** @type {import('./$types').RequestHandler} */
export const POST = async ({ request, url }) => {
	const body = await request.text();
	if (body.length > MAX_REQUEST_BYTES)
		return json({ ok: false, reason: 'request_too_large' }, { status: 413 });

	/** @type {unknown} */
	let parsed;
	try {
		parsed = JSON.parse(body);
	} catch {
		return json({ ok: false, reason: 'invalid_request' }, { status: 400 });
	}
	const candidate = /** @type {{ jobId?: unknown } | null} */ (parsed);
	const jobId = typeof candidate?.jobId === 'string' ? candidate.jobId : null;
	if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId))
		return json({ ok: false, reason: 'invalid_request' }, { status: 400 });

	const authorization = request.headers.get('authorization') ?? '';
	if (!authorization.startsWith('Bearer ') || authorization.length < 20)
		return json({ ok: false, reason: 'unauthenticated' }, { status: 401 });

	const config = publicConfig(url.origin);
	if (!config) return json({ ok: false, reason: 'unconfigured' }, { status: 503 });

	const { createClient } = await import('@supabase/supabase-js');
	const client = createClient(config.url, config.key, {
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		global: { headers: { Authorization: authorization } }
	});
	const repository = new SupabaseCatalog(client);

	try {
		const outcome = await runProcessingJob(
			{
				claim: (job, leaseSeconds) => repository.claimUploadJob(leaseSeconds, job),
				downloadSource: (path) => repository.downloadSource(path),
				uploadDerivative: (path, bytes, mime) => repository.uploadDerivative(path, bytes, mime),
				complete: (job, token, report) => repository.completeUploadJob(job, token, report),
				fail: (job, token, failure) => repository.failUploadJob(job, token, failure),
				process: processAssetBytes
			},
			jobId
		);
		return json(outcome, { status: outcome.status === 'refused' ? 409 : 200 });
	} catch (caught) {
		// A thrown adapter error is a transport or permission problem, not a
		// processing verdict: keep the message but do not claim anything changed.
		error(
			502,
			`Catalog processing failed: ${caught instanceof Error ? caught.message : 'unknown error'}`
		);
	}
};
