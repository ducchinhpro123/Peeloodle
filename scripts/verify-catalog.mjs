// Live catalog isolation (P53) and upload abuse/recovery (P79) checks against a
// real, dedicated Supabase test project. Provision three accounts — one catalog
// administrator and one ordinary user, plus the anonymous client — and run:
//
//   node --env-file=.env.catalog-test scripts/verify-catalog.mjs
//
// The dedicated test project is `peeloodle-catalog-test` (ref
// `wkmivbdheoynxaqolzdr`); see `supabase/README.md` and
// `proofs/p53-live-catalog-isolation.md` for provisioning and results. Never point
// this at the production project.
//
// P79 adds: whole-batch refusal of malformed files, unclaimable sources whose
// bytes contradict the batch, single-claim leases, wrong-token refusal, lease
// expiry reclaim, parallel claim races, malformed completion reports and source
// signing denial. The processing endpoint itself is not required for these; the
// byte-level malformed-file checks are covered by the Node and SQL harnesses and
// by the P08 preview run.
//
// Required: SUPABASE_TEST_URL, SUPABASE_TEST_KEY (publishable/anon only),
// SUPABASE_TEST_ADMIN_EMAIL, SUPABASE_TEST_ADMIN_PASSWORD,
// SUPABASE_TEST_USER_EMAIL, SUPABASE_TEST_USER_PASSWORD.
// Optional: SUPABASE_TEST_PUBLISHED_ASSET_ID for the signed-URL read check.
//
// Never use a service-role key here: an ordinary user must be exercised as an
// ordinary user. Role revocation is the documented SQL step in
// `supabase/README.md` and cannot be performed by this client; the script
// verifies that a non-member account is denied before and after the operator
// removes the membership row.
import assert from 'node:assert/strict';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const {
	SUPABASE_TEST_URL: url,
	SUPABASE_TEST_KEY: key,
	SUPABASE_TEST_ADMIN_EMAIL: adminEmail,
	SUPABASE_TEST_ADMIN_PASSWORD: adminPassword,
	SUPABASE_TEST_USER_EMAIL: userEmail,
	SUPABASE_TEST_USER_PASSWORD: userPassword,
	SUPABASE_TEST_PUBLISHED_ASSET_ID: publishedAssetId
} = process.env;
assert(
	url && key && adminEmail && adminPassword && userEmail && userPassword,
	'Provide dedicated test-account configuration (never a frontend service key)'
);

const client = () =>
	createClient(url, key, {
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
	});
const signIn = async (actor, email, password) => {
	const { data, error } = await actor.auth.signInWithPassword({ email, password });
	assert.ifError(error);
	return data.user.id;
};

let failures = 0;
let passed = 0;
async function check(label, fn) {
	try {
		await fn();
		passed += 1;
		console.log(`ok    ${label}`);
	} catch (error) {
		failures += 1;
		console.error(`FAIL  ${label}\n      ${error.message}`);
	}
}
/** RLS may deny at the grant level or filter to zero rows; both are "not visible". */
async function invisible(query) {
	const { data, error } = await query;
	if (error) {
		assert.match(String(error.code), /^(42501|PGRST)/, `unexpected error: ${error.message}`);
		return;
	}
	assert.equal((data ?? []).length, 0, 'rows were visible');
}

const admin = client();
const adminSecondSession = client();
const user = client();
const anon = client();
const stamp = Date.now().toString(36);
const collectionName = `Verification ${stamp}`;
let collection = null;
/** P79 fixtures cleaned up in `finally`. */
const abuseBatches = [];
const abuseSources = [];
let recoveryJobId = null;

await signIn(admin, adminEmail, adminPassword);
await signIn(adminSecondSession, adminEmail, adminPassword);
await signIn(user, userEmail, userPassword);

try {
	await check(
		'the admin predicate distinguishes admin, ordinary and anonymous clients',
		async () => {
			const [adminFlag, userFlag, anonFlag] = await Promise.all([
				admin.rpc('catalog_is_admin'),
				user.rpc('catalog_is_admin'),
				anon.rpc('catalog_is_admin')
			]);
			assert.equal(adminFlag.data, true, adminFlag.error?.message);
			assert.equal(userFlag.data, false, userFlag.error?.message);
			assert(anonFlag.error, 'anonymous clients must not call the predicate');
		}
	);

	await check('ordinary and anonymous clients cannot call admin RPCs', async () => {
		for (const actor of [user, anon]) {
			const attempt = await actor.rpc('catalog_admin_create_collection', {
				name: `Denied ${stamp}`
			});
			assert(attempt.error, 'the call unexpectedly succeeded');
			const upload = await actor.rpc('catalog_admin_create_upload_batch', {
				p_collection_id: null,
				p_files: [{ name: 'denied.png', mime: 'image/png', bytes: 32 }]
			});
			assert(upload.error, 'the upload-batch call unexpectedly succeeded');
			const claim = await actor.rpc('catalog_admin_claim_upload_job', { p_lease_seconds: 30 });
			assert(claim.error, 'the claim call unexpectedly succeeded');
			const claimSelf = await actor.rpc('catalog_admin_claim_upload_job', {
				p_lease_seconds: 30,
				p_job_id: '00000000-0000-4000-8000-000000000000'
			});
			assert(claimSelf.error, 'a targeted claim unexpectedly succeeded');
		}
	});

	await check('ordinary and anonymous clients cannot insert catalog rows directly', async () => {
		for (const actor of [user, anon]) {
			const attempt = await actor
				.from('catalog_collections')
				.insert({ name: `Denied insert ${stamp}` });
			assert(attempt.error, 'a direct insert unexpectedly succeeded');
		}
	});

	await check('ordinary and anonymous clients cannot write the catalog buckets', async () => {
		for (const actor of [user, anon]) {
			for (const bucket of ['catalog-derivatives', 'catalog-sources']) {
				const attempt = await actor.storage
					.from(bucket)
					.upload(`p53-denied-${bucket}-${stamp}.png`, new Uint8Array([1, 2, 3]), {
						contentType: 'image/png'
					});
				assert(attempt.error, `a ${bucket} upload unexpectedly succeeded`);
			}
		}
	});

	await check('membership, upload bookkeeping and the audit journal are invisible', async () => {
		await invisible(user.from('catalog_admins').select('user_id'));
		await invisible(anon.from('catalog_admins').select('user_id'));
		await invisible(user.from('catalog_upload_jobs').select('id'));
		await invisible(user.from('catalog_events').select('id'));
	});

	await check('ordinary clients read published metadata only', async () => {
		for (const table of ['catalog_collections', 'catalog_assets', 'catalog_templates']) {
			const { data, error } = await user.from(table).select('id,state');
			assert.ifError(error);
			assert(
				(data ?? []).every((row) => row.state === 'published'),
				`${table} exposed a non-published row`
			);
		}
	});

	await check(
		'a draft stays invisible to everyone but an admin, and publish reveals it',
		async () => {
			const created = await admin.rpc('catalog_admin_create_collection', {
				name: collectionName,
				description: 'P53 verification fixture',
				tags: ['verification'],
				sort_order: 9999
			});
			assert.ifError(created.error);
			assert.equal(created.data.ok, true, JSON.stringify(created.data));
			collection = created.data.item;
			await invisible(user.from('catalog_collections').select('id').eq('id', collection.id));
			await invisible(anon.from('catalog_collections').select('id').eq('id', collection.id));

			const fetched = await admin
				.from('catalog_collections')
				.select('id,state,revision')
				.eq('id', collection.id)
				.single();
			assert.ifError(fetched.error);
			const published = await admin.rpc('catalog_admin_publish_collection', {
				id: collection.id,
				expected_revision: fetched.data.revision
			});
			assert.ifError(published.error);
			assert.equal(published.data.ok, true, JSON.stringify(published.data));
			collection = published.data.item;

			const visible = await user.from('catalog_collections').select('id').eq('id', collection.id);
			assert.ifError(visible.error);
			assert.equal(visible.data.length, 1, 'the published collection is not readable');
		}
	);

	await check('a publish race resolves to exactly one conflict', async () => {
		const revision = collection.revision;
		const [first, second] = await Promise.all([
			admin.rpc('catalog_admin_publish_collection', {
				id: collection.id,
				expected_revision: revision
			}),
			adminSecondSession.rpc('catalog_admin_publish_collection', {
				id: collection.id,
				expected_revision: revision
			})
		]);
		const results = [first, second].map((response) => {
			assert.ifError(response.error);
			return response.data;
		});
		assert.equal(results.filter((result) => result.ok).length, 1, JSON.stringify(results));
		assert.equal(
			results.filter((result) => !result.ok && result.reason === 'revision_conflict').length,
			1,
			JSON.stringify(results)
		);
	});

	await check('a published derivative is fetchable through a signed URL', async () => {
		if (!publishedAssetId) {
			console.log('      note: SUPABASE_TEST_PUBLISHED_ASSET_ID is not set; skipping');
			return;
		}
		const asset = await user
			.from('catalog_assets')
			.select('id,state,published_version_id')
			.eq('id', publishedAssetId)
			.single();
		assert.ifError(asset.error);
		assert.equal(asset.data.state, 'published');
		const version = await user
			.from('catalog_asset_versions')
			.select('derivative_path,derivative_mime')
			.eq('id', asset.data.published_version_id)
			.single();
		assert.ifError(version.error);
		for (const actor of [user, anon]) {
			const signed = await actor.storage
				.from('catalog-derivatives')
				.createSignedUrl(version.data.derivative_path, 60);
			assert.ifError(signed.error);
			const response = await fetch(signed.data.signedUrl);
			assert.equal(response.status, 200);
			assert.match(response.headers.get('content-type') ?? '', /^image\//);
		}
	});

	// ── P79: upload abuse, lease expiry and claim races ──────────────────────

	// Drain claimable jobs left by an earlier run so each check below sees only
	// its own fixtures.
	for (let drained = 0; drained < 50; drained += 1) {
		const claim = await admin.rpc('catalog_admin_claim_upload_job', { p_lease_seconds: 30 });
		if (claim.error || !claim.data.ok) break;
		await admin.rpc('catalog_admin_fail_upload_job', {
			p_job_id: claim.data.item.id,
			p_lease_token: claim.data.lease.token,
			p_error_code: 'drained',
			p_error_message: 'drained before the P79 abuse checks'
		});
		abuseSources.push(claim.data.item.source_path);
	}

	await check('an upload batch with a malformed file is refused whole', async () => {
		const cases = [
			[{ name: 'bad.exe', mime: 'application/x-msdownload', bytes: 32 }],
			[{ name: 'huge.png', mime: 'image/png', bytes: 20971521 }],
			[{ name: 'sneaky/../path.png', mime: 'image/png', bytes: 32 }],
			[
				{ name: 'fine.png', mime: 'image/png', bytes: 32 },
				{ name: 'bad.svg', mime: 'text/plain', bytes: 32 }
			],
			[]
		];
		for (const files of cases) {
			const attempt = await admin.rpc('catalog_admin_create_upload_batch', {
				p_collection_id: null,
				p_files: files
			});
			assert.ifError(attempt.error);
			assert.equal(attempt.data.ok, false, `accepted ${JSON.stringify(files)}`);
			assert(
				['invalid_file', 'too_many_files'].includes(attempt.data.reason),
				`unexpected reason ${attempt.data.reason}`
			);
		}
	});

	await check('a source whose bytes contradict the batch cannot be claimed', async () => {
		const created = await admin.rpc('catalog_admin_create_upload_batch', {
			p_collection_id: null,
			p_files: [{ name: 'mismatch.png', mime: 'image/png', bytes: 1024 }]
		});
		assert.ifError(created.error);
		assert.equal(created.data.ok, true, JSON.stringify(created.data));
		const [job] = created.data.item.jobs;
		abuseBatches.push(created.data.item.batch.id);
		abuseSources.push(job.source_path);
		const upload = await admin.storage
			.from('catalog-sources')
			.upload(job.source_path, new Uint8Array(512), { contentType: 'image/png' });
		assert.ifError(upload.error);
		const claim = await admin.rpc('catalog_admin_claim_upload_job', {
			p_lease_seconds: 30,
			p_job_id: job.id
		});
		assert.ifError(claim.error);
		assert.equal(claim.data.ok, false, JSON.stringify(claim.data));
		assert.equal(claim.data.reason, 'none_pending');
	});

	await check('a leased job is claimed once and refuses every other token', async () => {
		const created = await admin.rpc('catalog_admin_create_upload_batch', {
			p_collection_id: null,
			p_files: [{ name: 'lease.png', mime: 'image/png', bytes: 1024 }]
		});
		assert.ifError(created.error);
		assert.equal(created.data.ok, true, JSON.stringify(created.data));
		const [job] = created.data.item.jobs;
		const batchId = created.data.item.batch.id;
		abuseBatches.push(batchId);
		abuseSources.push(job.source_path);
		const upload = await admin.storage
			.from('catalog-sources')
			.upload(job.source_path, new Uint8Array(1024), { contentType: 'image/png' });
		assert.ifError(upload.error);

		const claim = await admin.rpc('catalog_admin_claim_upload_job', {
			p_lease_seconds: 30,
			p_job_id: job.id
		});
		assert.ifError(claim.error);
		assert.equal(claim.data.ok, true, JSON.stringify(claim.data));
		assert.equal(claim.data.item.id, job.id, 'claimed a different job');
		const token = claim.data.lease.token;
		recoveryJobId = job.id;

		// A second worker finds nothing while the lease is live.
		const second = await adminSecondSession.rpc('catalog_admin_claim_upload_job', {
			p_lease_seconds: 30,
			p_job_id: job.id
		});
		assert.ifError(second.error);
		assert.equal(second.data.ok, false, JSON.stringify(second.data));
		assert.equal(second.data.reason, 'none_pending');

		// A wrong token cannot fail the job...
		const wrong = await admin.rpc('catalog_admin_fail_upload_job', {
			p_job_id: job.id,
			p_lease_token: '00000000-0000-4000-8000-000000000000',
			p_error_code: 'abuse',
			p_error_message: 'not the lease holder'
		});
		assert.ifError(wrong.error);
		assert.equal(wrong.data.ok, false, JSON.stringify(wrong.data));
		assert.equal(wrong.data.reason, 'lease_lost');

		// ...the lease token never appears in the admin status payload...
		const status = await admin.rpc('catalog_admin_upload_status', { p_batch_id: batchId });
		assert.ifError(status.error);
		assert(!JSON.stringify(status.data).includes(token), 'the lease token leaked in status');

		// ...and a malformed completion report is refused without a version row.
		const malformed = await admin.rpc('catalog_admin_complete_upload_job', {
			p_job_id: job.id,
			p_lease_token: token,
			p_report: { version_id: 'not-a-uuid', derivative_mime: 'text/plain' }
		});
		assert.ifError(malformed.error);
		assert.equal(malformed.data.ok, false, JSON.stringify(malformed.data));
		assert.equal(malformed.data.reason, 'invalid_report');
		const versions = await admin
			.from('catalog_asset_versions')
			.select('id')
			.eq('asset_id', job.asset_id);
		assert.ifError(versions.error);
		assert.equal(versions.data.length, 0, 'a malformed report created a version');

		// Failing with the true token is allowed, and retry returns the job to the
		// queue without touching the source object.
		const failed = await admin.rpc('catalog_admin_fail_upload_job', {
			p_job_id: job.id,
			p_lease_token: token,
			p_error_code: 'decode_failed',
			p_error_message: 'The file header lies about its dimensions.'
		});
		assert.ifError(failed.error);
		assert.equal(failed.data.ok, true, JSON.stringify(failed.data));
		assert.equal(failed.data.item.stage, 'failed');
		const retried = await admin.rpc('catalog_admin_retry_upload_job', { p_job_id: job.id });
		assert.ifError(retried.error);
		assert.equal(retried.data.ok, true, JSON.stringify(retried.data));
		assert.equal(retried.data.item.stage, 'queued');
	});

	await check('an expired lease is reclaimed without duplicating work', async () => {
		const claim = await admin.rpc('catalog_admin_claim_upload_job', {
			p_lease_seconds: 30,
			p_job_id: recoveryJobId
		});
		assert.ifError(claim.error);
		assert.equal(claim.data.ok, true, JSON.stringify(claim.data));
		assert.equal(claim.data.item.id, recoveryJobId);
		const attempts = claim.data.item.attempts;
		console.log('      note: waiting 31s for the lease to expire');
		await new Promise((resolve) => setTimeout(resolve, 31_000));
		const reclaimed = await admin.rpc('catalog_admin_claim_upload_job', {
			p_lease_seconds: 30,
			p_job_id: recoveryJobId
		});
		assert.ifError(reclaimed.error);
		assert.equal(reclaimed.data.ok, true, JSON.stringify(reclaimed.data));
		assert.equal(reclaimed.data.item.id, recoveryJobId, 'reclaimed a different job');
		assert.equal(reclaimed.data.item.attempts, attempts + 1);
	});

	await check('parallel claims never hand one job to two workers', async () => {
		const created = await admin.rpc('catalog_admin_create_upload_batch', {
			p_collection_id: null,
			p_files: [
				{ name: 'race-a.png', mime: 'image/png', bytes: 1024 },
				{ name: 'race-b.png', mime: 'image/png', bytes: 1024 }
			]
		});
		assert.ifError(created.error);
		assert.equal(created.data.ok, true, JSON.stringify(created.data));
		abuseBatches.push(created.data.item.batch.id);
		for (const job of created.data.item.jobs) {
			abuseSources.push(job.source_path);
			const upload = await admin.storage
				.from('catalog-sources')
				.upload(job.source_path, new Uint8Array(1024), { contentType: 'image/png' });
			assert.ifError(upload.error);
		}
		const [first, second] = await Promise.all([
			admin.rpc('catalog_admin_claim_upload_job', { p_lease_seconds: 60 }),
			adminSecondSession.rpc('catalog_admin_claim_upload_job', { p_lease_seconds: 60 })
		]);
		assert.ifError(first.error);
		assert.ifError(second.error);
		const claims = [first.data, second.data].filter((result) => result.ok);
		assert.equal(claims.length, 2, JSON.stringify([first.data, second.data]));
		assert.notEqual(claims[0].item.id, claims[1].item.id, 'the same job was claimed twice');
	});

	await check('source objects never sign for ordinary clients', async () => {
		const signed = await user.storage.from('catalog-sources').createSignedUrl(abuseSources[0], 60);
		assert(signed.error, 'a source object unexpectedly signed for an ordinary user');
	});

	await check('archive removes the collection from ordinary reading', async () => {
		const fetched = await admin
			.from('catalog_collections')
			.select('revision')
			.eq('id', collection.id)
			.single();
		assert.ifError(fetched.error);
		const archived = await admin.rpc('catalog_admin_archive_collection', {
			id: collection.id,
			expected_revision: fetched.data.revision,
			archive_items: false
		});
		assert.ifError(archived.error);
		assert.equal(archived.data.ok, true, JSON.stringify(archived.data));
		await invisible(user.from('catalog_collections').select('id').eq('id', collection.id));
	});
} finally {
	for (const batchId of abuseBatches) {
		await admin.rpc('catalog_admin_cancel_upload_batch', { p_batch_id: batchId });
	}
	if (abuseSources.length > 0) await admin.storage.from('catalog-sources').remove(abuseSources);
	await Promise.all([admin.auth.signOut(), adminSecondSession.auth.signOut(), user.auth.signOut()]);
}

console.log(`\n${passed} checks passed`);
if (failures > 0) {
	console.error(`${failures} checks failed`);
	process.exit(1);
}
console.log(
	'PASS: live catalog isolation (admin/ordinary/anonymous reads, denied admin RPCs, denied direct writes and bucket writes, publish race, signed derivative reads, archive revocation) and P79 upload abuse/recovery (malformed batches refused, unclaimable mismatched sources, single-claim leases, wrong-token refusal, lease expiry reclaim, parallel claim races, malformed reports, source signing denial).'
);
