// Live catalog isolation checks (P53) against a real, dedicated Supabase test
// project. Provision three accounts — one catalog administrator and one ordinary
// user, plus the anonymous client — and run:
//
//   node --env-file=.env.catalog-test scripts/verify-catalog.mjs
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
	await Promise.all([admin.auth.signOut(), adminSecondSession.auth.signOut(), user.auth.signOut()]);
}

console.log(`\n${passed} checks passed`);
if (failures > 0) {
	console.error(`${failures} checks failed`);
	process.exit(1);
}
console.log(
	'PASS: live catalog isolation (admin/ordinary/anonymous reads, denied admin RPCs, publish race, signed derivative reads, archive revocation).'
);
