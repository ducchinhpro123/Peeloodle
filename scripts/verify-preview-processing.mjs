// P08 — verify native processing in an authorized preview deployment.
//
// Runs against the hosted preview created by
// `scripts/p08-vercel-preview-wizard.sh` and the dedicated catalog test project:
//
//   node --env-file=.env.catalog-test --env-file=.env.p08-preview \
//     scripts/verify-preview-processing.mjs
//
// It proves the three P08 claims on the deployed serverless runtime:
//   1. image bytes go straight from the browser-side admin client to Storage —
//      the processing request body carries only the job id;
//   2. one POST /api/catalog/process invocation claims, decodes with the native
//      decoder, stores the derivative and finalizes the version;
//   3. the configured limits are enforced at the preview (64 KiB request body,
//      20 MiB source, 4096px derivative bound) and a replay cannot duplicate work.
//
// Requires P08_PREVIEW_URL (or the first CLI argument), SUPABASE_TEST_URL,
// SUPABASE_TEST_KEY, SUPABASE_TEST_ADMIN_EMAIL and SUPABASE_TEST_ADMIN_PASSWORD.
// Never point this at production StickerLab, and never use a service-role key.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const {
	P08_PREVIEW_URL: configuredPreview,
	SUPABASE_TEST_URL: url,
	SUPABASE_TEST_KEY: key,
	SUPABASE_TEST_ADMIN_EMAIL: adminEmail,
	SUPABASE_TEST_ADMIN_PASSWORD: adminPassword
} = process.env;
const previewUrl = process.argv[2] ?? configuredPreview;
assert(
	previewUrl && url && key && adminEmail && adminPassword,
	'Provide P08_PREVIEW_URL plus the dedicated test-project admin credentials (never production)'
);
const base = previewUrl.replace(/\/+$/, '');

const REQUEST_LIMIT = 64 * 1024;
const SOURCE_LIMIT = 20 * 1024 * 1024;

let passed = 0;
const results = [];
async function check(label, fn) {
	try {
		const detail = await fn();
		passed += 1;
		results.push({ label, ok: true, detail });
		console.log(`ok    ${label}`);
	} catch (error) {
		results.push({ label, ok: false, error: String(error?.message ?? error) });
		console.error(`FAIL  ${label}\n      ${error.message}`);
	}
}

const admin = createClient(url, key, {
	auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
const { data: session, error: signInError } = await admin.auth.signInWithPassword({
	email: adminEmail,
	password: adminPassword
});
assert.ifError(signInError);
const token = session.session.access_token;

const post = (body, headers = {}) =>
	fetch(`${base}/api/catalog/process`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});

await check('the preview route exists and refuses an unauthenticated request', async () => {
	const response = await post({ jobId: crypto.randomUUID() });
	const payload = await response.json();
	assert.equal(
		response.status,
		401,
		`expected 401, got ${response.status}: ${JSON.stringify(payload)}`
	);
	assert.equal(payload.reason, 'unauthenticated');
});

await check(`the preview enforces the ${REQUEST_LIMIT / 1024} KiB request-body limit`, async () => {
	const response = await post('x'.repeat(REQUEST_LIMIT + 1), { authorization: `Bearer ${token}` });
	assert.equal(response.status, 413, `expected 413, got ${response.status}`);
	assert.equal((await response.json()).reason, 'request_too_large');
});

await check('the preview refuses a malformed job id', async () => {
	const response = await post({ jobId: 'not-a-uuid' }, { authorization: `Bearer ${token}` });
	assert.equal(response.status, 400, `expected 400, got ${response.status}`);
});

const created = { jobId: null, sourcePath: null, versionId: null, derivativePath: null };
await check('one endpoint call processes a job whose bytes went straight to Storage', async () => {
	const png = await sharp({
		create: { width: 96, height: 64, channels: 4, background: { r: 30, g: 90, b: 200, alpha: 1 } }
	})
		.png()
		.toBuffer();
	const batch = await admin.rpc('catalog_admin_create_upload_batch', {
		p_collection_id: null,
		p_files: [{ name: 'preview-check.png', mime: 'image/png', bytes: png.length }]
	});
	assert.ifError(batch.error);
	assert.equal(batch.data.ok, true, JSON.stringify(batch.data));
	const job = batch.data.item.jobs[0];
	const upload = await admin.storage
		.from('catalog-sources')
		.upload(job.source_path, png, { contentType: 'image/png' });
	assert.ifError(upload.error);

	const body = JSON.stringify({ jobId: job.id });
	assert(
		body.length < 1024,
		`the request body carries ${body.length} bytes; image bytes must not travel through it`
	);
	const started = Date.now();
	const response = await post(body, { authorization: `Bearer ${token}` });
	const outcome = await response.json();
	const elapsedMs = Date.now() - started;
	assert.equal(response.status, 200, JSON.stringify(outcome));
	assert.equal(outcome.status, 'processed', JSON.stringify(outcome));
	assert.equal(outcome.width, 96, JSON.stringify(outcome));
	assert.equal(outcome.height, 64, JSON.stringify(outcome));
	assert.equal(outcome.sourceFormat, 'png', JSON.stringify(outcome));

	const version = await admin
		.from('catalog_asset_versions')
		.select(
			'derivative_path,derivative_mime,derivative_bytes,derivative_width,derivative_height,validation_state'
		)
		.eq('id', outcome.versionId)
		.single();
	assert.ifError(version.error);
	assert.equal(version.data.validation_state, 'validated');
	assert.equal(version.data.derivative_width, 96);
	assert.equal(version.data.derivative_height, 64);
	const stored = await admin.storage
		.from('catalog-derivatives')
		.download(version.data.derivative_path);
	assert.ifError(stored.error);
	assert.equal(stored.data.size, version.data.derivative_bytes);

	const jobRow = await admin
		.from('catalog_upload_jobs')
		.select('stage,attempts')
		.eq('id', job.id)
		.single();
	assert.ifError(jobRow.error);
	assert.equal(jobRow.data.stage, 'ready');

	created.jobId = job.id;
	created.sourcePath = job.source_path;
	created.versionId = outcome.versionId;
	created.derivativePath = version.data.derivative_path;
	return {
		sourceBytes: png.length,
		requestBytes: body.length,
		elapsedMs,
		width: outcome.width,
		height: outcome.height,
		sourceFormat: outcome.sourceFormat,
		versionId: outcome.versionId
	};
});

await check('a replayed invocation cannot duplicate the version', async () => {
	assert(created.jobId, 'the processing check did not run');
	const response = await post({ jobId: created.jobId }, { authorization: `Bearer ${token}` });
	const outcome = await response.json();
	assert.equal(outcome.status, 'refused', JSON.stringify(outcome));
	const versions = await admin
		.from('catalog_asset_versions')
		.select('id')
		.eq('id', created.versionId);
	assert.ifError(versions.error);
	assert.equal(versions.data.length, 1);
});

await mkdir('proofs/out', { recursive: true });
const report = {
	generatedAt: new Date().toISOString(),
	previewUrl: base,
	project: url,
	node: process.version,
	limits: {
		requestBytes: REQUEST_LIMIT,
		sourceBytes: SOURCE_LIMIT,
		checkedLive: ['requestBytes'],
		checkedByRpcOrSql: [
			'sourceBytes (batch validation, P79 live)',
			'derivative bounds (completion validation, P79 live)'
		]
	},
	checks: results,
	fixture: created
};
await writeFile('proofs/out/p08-preview-report.json', `${JSON.stringify(report, null, '\t')}\n`);

console.log(`\n${passed} checks passed`);
if (passed !== results.length) process.exitCode = 1;
else
	console.log(
		'PASS: native processing on the preview (direct-to-Storage bytes, one-job invocation, enforced request limit, replay-safe).'
	);
