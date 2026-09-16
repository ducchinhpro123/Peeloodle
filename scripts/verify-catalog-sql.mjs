// Catalog migration and authorization verification (P46/P47/P48/P50).
//
// Runs the real `supabase/migrations/*.sql` files, in filename order, against a
// throwaway PostgreSQL cluster on localhost, and then exercises the catalog with
// four actors: an anonymous client, an ordinary signed-in client, an admin
// client and the service role (trusted processing). It is the local substitute
// for a deployed Supabase test project: no credentials, no network and no
// production database are involved.
//
// The shim stands in for the Supabase platform only (auth schema/`auth.uid()`,
// the `storage` tables and `storage.foldername()`, the platform roles, and a
// permissive `extensions.jsonb_matches_schema` used by the older sticker
// migration because `pg_jsonschema` is not installed here). Catalog policy and
// RPC behaviour is the real thing: the migration files are applied unmodified
// apart from stripping the old `create extension pg_jsonschema` line.
//
// Requires the PostgreSQL server binaries (`initdb`, `pg_ctl`, `psql`). Run:
//   node scripts/verify-catalog-sql.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import postgres from 'postgres';

const root = path.resolve(import.meta.dirname, '..');
const migrationsDir = path.join(root, 'supabase/migrations');

function findBin(name) {
	const candidates = [
		...process.env.PATH.split(path.delimiter).map((dir) => path.join(dir, name)),
		...(existsSync('/usr/lib/postgresql')
			? readdirSync('/usr/lib/postgresql').map((version) =>
					path.join('/usr/lib/postgresql', version, 'bin', name)
				)
			: [])
	];
	const found = candidates.find((candidate) => existsSync(candidate));
	if (!found) throw new Error(`Could not find the PostgreSQL binary ${name}`);
	return found;
}
const run = (bin, args, options = {}) =>
	execFileSync(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...options });
const runWithInput = (bin, args, input) => execFileSync(bin, args, { input, encoding: 'utf8' });

async function freePort() {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			server.close(() => resolve(port));
		});
	});
}

const SHIM = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text unique);
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

create schema if not exists extensions;
create or replace function extensions.jsonb_matches_schema(schema json, document jsonb)
returns boolean language sql immutable as $$ select true; $$;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null,
  owner uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1];
$$;
grant usage on schema auth, storage, extensions to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to service_role;
grant select on storage.objects to anon, authenticated;
`;

let failures = 0;
let passed = 0;
async function check(label, fn) {
	try {
		await fn();
		passed += 1;
	} catch (error) {
		failures += 1;
		console.error(`FAIL  ${label}\n      ${error.message}`);
	}
}
async function expectError(promise, code) {
	let error = null;
	try {
		await promise;
	} catch (caught) {
		error = caught;
	}
	if (!error) throw new Error(`expected SQLSTATE ${code}, but the statement succeeded`);
	if (error.code !== code)
		throw new Error(`expected SQLSTATE ${code}, got ${error.code}: ${error.message}`);
}

async function main(binaries) {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'peeloodle-catalog-'));
	const port = await freePort();
	const pgCtl = binaries.pgCtl;
	run(binaries.initdb, ['-D', dataDir, '-U', 'postgres', '--auth=trust', '--no-sync']);
	run(pgCtl, [
		'-D',
		dataDir,
		'-l',
		path.join(dataDir, 'server.log'),
		'-o',
		`-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=${dataDir}`,
		'-w',
		'start'
	]);
	const connection = {
		host: '127.0.0.1',
		port,
		database: 'postgres',
		username: 'postgres',
		max: 1
	};
	const sql = postgres(connection);
	try {
		await sql.unsafe(SHIM);

		// Apply the real migrations in order. The old sticker migration creates the
		// pg_jsonschema extension, which is not installed here; the shim's stub
		// function stands in for it.
		for (const file of readdirSync(migrationsDir)
			.filter((candidate) => candidate.endsWith('.sql'))
			.sort()) {
			const text = readFileSync(path.join(migrationsDir, file), 'utf8').replace(
				/^create extension if not exists pg_jsonschema.*$/m,
				'-- pg_jsonschema replaced by the harness stub (extensions.jsonb_matches_schema)'
			);
			runWithInput(
				binaries.psql,
				[
					'-v',
					'ON_ERROR_STOP=1',
					'-h',
					'127.0.0.1',
					'-p',
					String(port),
					'-U',
					'postgres',
					'-d',
					'postgres'
				],
				text
			);
			passed += 1;
			console.log(`ok    migration applies: ${file}`);
		}

		const admin = '11111111-1111-4111-8111-111111111111';
		const editor = '22222222-2222-4222-8222-222222222222';
		await sql.unsafe(`insert into auth.users (id, email) values
			('${admin}', 'admin@example.test'),
			('${editor}', 'editor@example.test')`);

		// P47: bootstrap is a controlled SQL step; runtime membership is read by
		// the guarded predicate below.
		await sql.unsafe(`insert into public.catalog_admins (user_id) values ('${admin}')`);
		const actor = async (role, subject) => {
			const session = postgres({ ...connection, max: 1 });
			await session.unsafe(`set role ${role}`);
			if (subject)
				await session.unsafe(
					`select set_config('request.jwt.claims', '{"sub":"${subject}"}', false)`
				);
			return session;
		};
		const asAdmin = await actor('authenticated', admin);
		const asEditor = await actor('authenticated', editor);
		const asAnon = await actor('anon');

		await check('catalog_is_admin() is true for admins and false for ordinary users', async () => {
			const [isAdmin] = await asAdmin.unsafe('select public.catalog_is_admin() as value');
			const [isEditor] = await asEditor.unsafe('select public.catalog_is_admin() as value');
			if (isAdmin.value !== true || isEditor.value !== false)
				throw new Error('unexpected admin flags');
		});
		await check('anonymous clients cannot call the admin predicate', () =>
			expectError(asAnon.unsafe('select public.catalog_is_admin()'), '42501')
		);
		await check('ordinary users cannot call admin RPCs', () =>
			expectError(
				asEditor.unsafe("select public.catalog_admin_create_collection('Nope', '', '{}', 0)"),
				'42501'
			)
		);

		// P49/P50: drafts, compare-and-set revisions and published pointers.
		const [created] = await asAdmin.unsafe(
			"select public.catalog_admin_create_collection('Animals', 'Everyday animals', array['animals'], 1) as result"
		);
		const collection = created.result.item;
		await check('admin creates a draft collection', () => {
			if (!created.result.ok || collection.state !== 'draft' || collection.revision !== 1)
				throw new Error(JSON.stringify(created.result));
		});
		const [conflict] = await asAdmin.unsafe(
			`select public.catalog_admin_update_collection('${collection.id}', 99, 'Renamed', '', '{}', 1) as result`
		);
		await check('stale revision returns revision_conflict with the current row', () => {
			if (conflict.result.ok || conflict.result.reason !== 'revision_conflict')
				throw new Error(JSON.stringify(conflict.result));
			if (conflict.result.detail.item.revision !== 1) throw new Error('missing current row');
		});
		const [updated] = await asAdmin.unsafe(
			`select public.catalog_admin_update_collection('${collection.id}', 1, 'Animals', 'Everyday animals', array['animals','pets'], 1) as result`
		);
		await check('admin edit bumps the revision', () => {
			if (!updated.result.ok || updated.result.item.revision !== 2)
				throw new Error(JSON.stringify(updated.result));
		});

		const [assetResult] = await asAdmin.unsafe(
			`select public.catalog_admin_create_asset('${collection.id}', 'Cat', 'raster', '', '{}', '{"source":"fixture"}', 1) as result`
		);
		const asset = assetResult.result.item;
		await check('admin creates a draft asset', () => {
			if (
				!assetResult.result.ok ||
				asset.state !== 'draft' ||
				asset.collection_id !== collection.id
			)
				throw new Error(JSON.stringify(assetResult.result));
		});
		const [draftCollection] = await asAdmin.unsafe(
			"select public.catalog_admin_create_collection('Private drafts', '', '{}', 2) as result"
		);
		const draftCollectionId = draftCollection.result.item.id;
		const draftAsset = (
			await asAdmin.unsafe(
				`select public.catalog_admin_create_asset('${draftCollectionId}', 'Hidden', 'raster') as result`
			)
		)[0].result.item;
		const pendingAsset = (
			await asAdmin.unsafe(
				`select public.catalog_admin_create_asset('${draftCollectionId}', 'Pending', 'raster') as result`
			)
		)[0].result.item;

		// Trusted processing writes immutable versions; the service role stands in
		// for the (M5) processing worker here.
		const versionPath = (assetId, versionId) => `assets/${assetId}/${versionId}/image.png`;
		const insertVersion = (id, ownerAsset, { validated = true, number = 1 } = {}) =>
			sql.unsafe(`insert into public.catalog_asset_versions
				(id, asset_id, version_number, source_path, source_sha256, source_bytes, source_mime,
				 derivative_path, derivative_sha256, derivative_bytes, derivative_mime,
				 derivative_width, derivative_height, validation_state)
				values (
					'${id}', '${ownerAsset}', ${number},
					'batches/b/${id}/image.png', repeat('a', 64), 1000, 'image/png',
					'${versionPath(ownerAsset, id)}', repeat('b', 64), 800, 'image/png',
					64, 64, '${validated ? 'validated' : 'pending'}'
				) returning id`);
		const versionId = '44444444-4444-4444-8444-444444444444';
		const draftVersionId = '55555555-5555-4555-8555-555555555555';
		const pendingVersionId = '77777777-7777-4777-8777-777777777777';
		await insertVersion(versionId, asset.id);
		await insertVersion(draftVersionId, draftAsset.id);
		await insertVersion(pendingVersionId, pendingAsset.id, { validated: false });

		const [unvalidatedPublish] = await asAdmin.unsafe(
			`select public.catalog_admin_publish_asset('${pendingAsset.id}', '${pendingVersionId}', 1) as result`
		);
		await check('a pending version cannot be published', () => {
			if (
				unvalidatedPublish.result.ok ||
				unvalidatedPublish.result.reason !== 'version_not_validated'
			)
				throw new Error(JSON.stringify(unvalidatedPublish.result));
		});
		const [draftCollectionPublish] = await asAdmin.unsafe(
			`select public.catalog_admin_publish_asset('${asset.id}', '${versionId}', 1) as result`
		);
		await check('an asset cannot publish while its collection is a draft', () => {
			if (
				draftCollectionPublish.result.ok ||
				draftCollectionPublish.result.reason !== 'collection_not_published'
			)
				throw new Error(JSON.stringify(draftCollectionPublish.result));
		});
		const [stalePublish] = await asAdmin.unsafe(
			`select public.catalog_admin_publish_asset('${asset.id}', '${versionId}', 99) as result`
		);
		await check('publish respects the expected revision', () => {
			if (stalePublish.result.ok || stalePublish.result.reason !== 'revision_conflict')
				throw new Error(JSON.stringify(stalePublish.result));
		});
		const [publishedCollection] = await asAdmin.unsafe(
			`select public.catalog_admin_publish_collection('${collection.id}', 2) as result`
		);
		await check('admin publishes the collection', () => {
			if (!publishedCollection.result.ok || publishedCollection.result.item.state !== 'published')
				throw new Error(JSON.stringify(publishedCollection.result));
		});
		const [publishedAsset] = await asAdmin.unsafe(
			`select public.catalog_admin_publish_asset('${asset.id}', '${versionId}', 1) as result`
		);
		await check('publishing an asset sets the pointer to the validated version', () => {
			if (
				!publishedAsset.result.ok ||
				publishedAsset.result.item.published_version_id !== versionId
			)
				throw new Error(JSON.stringify(publishedAsset.result));
		});
		await check('publish is journaled with the actor, subject and outcome', async () => {
			const rows = await sql.unsafe(
				`select actor_id, outcome from public.catalog_events
				 where subject_id = '${asset.id}' and operation = 'publish' order by id`
			);
			if (rows.length !== 2) throw new Error(JSON.stringify(rows));
			if (rows[0].outcome !== 'rejected' || rows[1].outcome !== 'ok')
				throw new Error(JSON.stringify(rows));
			if (rows.some((row) => row.actor_id !== admin)) throw new Error('wrong actor');
		});

		// P46: immutable versions and pointer integrity.
		await check('version rows reject updates', () =>
			expectError(
				sql.unsafe(
					`update public.catalog_asset_versions set derivative_width = 32 where id = '${versionId}'`
				),
				'55000'
			)
		);
		await check('version rows reject deletes', () =>
			expectError(
				sql.unsafe(`delete from public.catalog_asset_versions where id = '${versionId}'`),
				'55000'
			)
		);
		await check('a published pointer cannot name another asset version', () =>
			expectError(
				sql.unsafe(
					`update public.catalog_assets set published_version_id = '${draftVersionId}' where id = '${asset.id}'`
				),
				'23514'
			)
		);
		await check('a published asset cannot clear its published pointer', () =>
			expectError(
				sql.unsafe(
					`update public.catalog_assets set published_version_id = null where id = '${asset.id}'`
				),
				'23514'
			)
		);

		// P48: visibility. Drafts are invisible to everyone but admins.
		await check(
			'anonymous clients see only published metadata and the published version',
			async () => {
				const collections = await asAnon.unsafe('select id from public.catalog_collections');
				const assets = await asAnon.unsafe('select id from public.catalog_assets');
				const versions = await asAnon.unsafe('select id from public.catalog_asset_versions');
				if (collections.length !== 1 || collections[0].id !== collection.id)
					throw new Error(`collections: ${JSON.stringify(collections)}`);
				if (assets.length !== 1 || assets[0].id !== asset.id)
					throw new Error(`assets: ${JSON.stringify(assets)}`);
				if (versions.length !== 1 || versions[0].id !== versionId)
					throw new Error(`versions: ${JSON.stringify(versions)}`);
				const hidden = await asAnon
					.unsafe('select id from public.catalog_upload_jobs')
					.catch((error) => {
						if (error.code === '42501') return [];
						throw error;
					});
				if (hidden.length !== 0) throw new Error('upload jobs are readable');
			}
		);
		await check('ordinary signed-in clients see the same published surface', async () => {
			const versions = await asEditor.unsafe('select id from public.catalog_asset_versions');
			if (versions.length !== 1 || versions[0].id !== versionId)
				throw new Error(JSON.stringify(versions));
		});
		await check('admins see drafts', async () => {
			const versions = await asAdmin.unsafe(
				'select id from public.catalog_asset_versions order by id'
			);
			if (versions.length !== 3) throw new Error(JSON.stringify(versions));
		});
		await check('admins cannot write catalog tables directly', () =>
			expectError(
				asAdmin.unsafe("insert into public.catalog_collections (name) values ('Direct write')"),
				'42501'
			)
		);

		// P48: Storage policies keyed to the published version.
		await sql.unsafe(`insert into storage.objects (bucket_id, name) values
			('catalog-derivatives', '${versionPath(asset.id, versionId)}'),
			('catalog-derivatives', '${versionPath(draftAsset.id, draftVersionId)}'),
			('catalog-sources', 'batches/b/${versionId}/image.png')`);
		await check('published derivatives are readable, drafts and sources are not', async () => {
			const visible = await asAnon.unsafe('select name from storage.objects order by name');
			if (visible.length !== 1 || visible[0].name !== versionPath(asset.id, versionId))
				throw new Error(`anon: ${JSON.stringify(visible)}`);
			const adminVisible = await asAdmin.unsafe('select name from storage.objects order by name');
			if (adminVisible.length !== 3) throw new Error(`admin: ${JSON.stringify(adminVisible)}`);
		});
		await check('ordinary users cannot write derivatives', () =>
			expectError(
				asEditor.unsafe(
					"insert into storage.objects (bucket_id, name) values ('catalog-derivatives', 'assets/1/2/3.png')"
				),
				'42501'
			)
		);

		// P50: template dependencies preserve pinned media.
		const [templateResult] = await asAdmin.unsafe(
			"select public.catalog_admin_create_template('Class deck', 'class', '', array['class'], 1) as result"
		);
		const template = templateResult.result.item;
		const templateVersionId = '66666666-6666-4666-8666-666666666666';
		await sql.unsafe(`insert into public.catalog_template_versions
			(id, template_id, version_number, document, document_sha256, document_bytes, cover_path, cover_sha256,
			 slide_previews, font_requirements, validation_state)
			values (
				'${templateVersionId}', '${template.id}', 1, '{"schemaVersion":1}', repeat('c', 64), 100,
				'templates/${template.id}/${templateVersionId}/cover.png', repeat('d', 64),
				'[{"path":"templates/${template.id}/${templateVersionId}/slide-1.png","ordinal":0}]', '[]', 'validated'
			)`);
		await sql.unsafe(`insert into public.catalog_template_dependencies (template_version_id, asset_id, asset_version_id)
			values ('${templateVersionId}', '${draftAsset.id}', '${draftVersionId}')`);
		const [unavailable] = await asAdmin.unsafe(
			`select public.catalog_admin_publish_template('${template.id}', '${templateVersionId}', 1) as result`
		);
		await check('publishing a template with an unpublished dependency is refused', () => {
			if (unavailable.result.ok || unavailable.result.reason !== 'dependency_unavailable')
				throw new Error(JSON.stringify(unavailable.result));
		});
		await sql.unsafe(`insert into storage.objects (bucket_id, name) values
			('catalog-derivatives', 'templates/${template.id}/${templateVersionId}/cover.png'),
			('catalog-derivatives', 'templates/${template.id}/${templateVersionId}/slide-1.png')`);
		await asAdmin.unsafe(
			`select public.catalog_admin_publish_collection('${draftCollectionId}', 1)`
		);
		await asAdmin.unsafe(
			`select public.catalog_admin_publish_asset('${draftAsset.id}', '${draftVersionId}', 1)`
		);
		const [publishedTemplate] = await asAdmin.unsafe(
			`select public.catalog_admin_publish_template('${template.id}', '${templateVersionId}', 1) as result`
		);
		await check('template publication passes once the dependency is live', () => {
			if (!publishedTemplate.result.ok) throw new Error(JSON.stringify(publishedTemplate.result));
		});
		const [pinned] = await asAdmin.unsafe(
			`select public.catalog_admin_archive_asset('${draftAsset.id}', 2) as result`
		);
		await check('a published template pins its asset version against archive', () => {
			if (pinned.result.ok || pinned.result.reason !== 'pinned_by_template')
				throw new Error(JSON.stringify(pinned.result));
			if (pinned.result.detail.templates[0].id !== template.id)
				throw new Error('pin detail is missing the template');
		});
		const [containsItems] = await asAdmin.unsafe(
			`select public.catalog_admin_archive_collection('${draftCollectionId}', 2, false) as result`
		);
		await check('collection archive without item handling is refused and reports the count', () => {
			if (containsItems.result.ok || containsItems.result.reason !== 'contains_items')
				throw new Error(JSON.stringify(containsItems.result));
			if (containsItems.result.detail.count !== 2) throw new Error('missing contained count');
		});
		const [pinnedCollection] = await asAdmin.unsafe(
			`select public.catalog_admin_archive_collection('${draftCollectionId}', 2, true) as result`
		);
		await check('collection archive still refuses to break a pinned template', () => {
			if (pinnedCollection.result.ok || pinnedCollection.result.reason !== 'pinned_by_template')
				throw new Error(JSON.stringify(pinnedCollection.result));
		});
		const [archived] = await asAdmin.unsafe(
			`select public.catalog_admin_archive_asset('${asset.id}', 2) as result`
		);
		await check('an unpinned asset archives and leaves the public catalog', async () => {
			if (!archived.result.ok || archived.result.item.state !== 'archived')
				throw new Error(JSON.stringify(archived.result));
			const rows = await asAnon.unsafe('select id from public.catalog_assets');
			if (rows.some((row) => row.id === asset.id)) throw new Error('archived asset still visible');
		});
		await check(
			'template derivatives stop being publicly readable after template archive',
			async () => {
				const before = await asAnon.unsafe('select name from storage.objects order by name');
				if (before.length !== 3) throw new Error(`before: ${JSON.stringify(before)}`);
				const [result] = await asAdmin.unsafe(
					`select public.catalog_admin_archive_template('${template.id}', 2) as result`
				);
				if (!result.result.ok) throw new Error(JSON.stringify(result.result));
				const after = await asAnon.unsafe('select name from storage.objects order by name');
				if (after.length !== 1 || after[0].name !== versionPath(draftAsset.id, draftVersionId))
					throw new Error(`after: ${JSON.stringify(after)}`);
			}
		);

		await asAdmin.end({ timeout: 5 });
		await asEditor.end({ timeout: 5 });
		await asAnon.end({ timeout: 5 });
	} finally {
		await sql.end({ timeout: 5 }).catch(() => {});
		try {
			run(pgCtl, ['-D', dataDir, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' });
		} catch {
			/* the cluster is throwaway */
		}
		rmSync(dataDir, { recursive: true, force: true });
	}

	console.log(`\n${passed} checks passed`);
	if (failures > 0) {
		console.error(`${failures} checks failed`);
		process.exit(1);
	}
	console.log(
		'PASS: catalog migrations, immutability, published-pointer integrity, RLS/Storage visibility and guarded publish/archive against real PostgreSQL.'
	);
}

// Missing server binaries are reported as unavailable rather than failed: the
// checks are a local gate, like scripts/verify-cloud.mjs without credentials.
let binaries;
try {
	binaries = { initdb: findBin('initdb'), pgCtl: findBin('pg_ctl'), psql: findBin('psql') };
} catch (error) {
	console.log(
		`SKIPPED: ${error.message} — install the PostgreSQL server binaries (initdb, pg_ctl, psql) to run the catalog SQL checks.`
	);
	process.exit(0);
}
main(binaries).catch((error) => {
	console.error(error);
	process.exit(1);
});
