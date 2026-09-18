// Catalog migration and authorization verification (P46/P47/P48/P50, P54/P55/P61).
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
grant delete on storage.objects to authenticated;
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

		// P65: one guarded transaction creates the stable template, its first
		// immutable pending version and the dependency pins. `draftAsset` is a
		// published validated version here, so the document below can pin it.
		const draftDocument = {
			schemaVersion: 1,
			id: '77777777-7777-4777-8777-777777777777',
			title: 'Template copy',
			assets: [
				{
					id: '88888888-8888-4888-8888-888888888888',
					blobKey: `catalog/${'b'.repeat(64)}`,
					mimeType: 'image/png',
					width: 64,
					height: 64,
					sha256: 'b'.repeat(64),
					byteLength: 800,
					provenance: {
						source: 'catalog',
						label: 'Template art',
						catalogItemId: draftAsset.id,
						catalogVersionId: draftVersionId
					}
				}
			],
			slides: []
		};
		const createDraft = (document, session = asAdmin) => {
			const json = JSON.stringify(document);
			return session.unsafe(
				`select public.catalog_admin_create_template_draft('Template copy', 'class', '${json}'::jsonb, repeat('e', 64), ${Buffer.byteLength(json)}) as result`
			);
		};
		const templateCounts = async () => {
			const [row] = await sql.unsafe(`select
				(select count(*)::int from public.catalog_templates) as templates,
				(select count(*)::int from public.catalog_template_versions) as versions`);
			return row;
		};
		const createDraftRaw = (args, session = asAdmin) =>
			session.unsafe(`select public.catalog_admin_create_template_draft(${args}) as result`);
		const draftJson = JSON.stringify(draftDocument);
		// A refusal must be the documented envelope, must not raise, and must not
		// leave template or version rows behind.
		const expectRefusal = async (call, reason) => {
			const before = await templateCounts();
			let result;
			try {
				[result] = await call;
			} catch (error) {
				throw new Error(`expected ${reason}, but the call raised ${error.code}: ${error.message}`, {
					cause: error
				});
			}
			result = result.result;
			if (!result || result.ok || result.reason !== reason)
				throw new Error(`expected ${reason}, got ${JSON.stringify(result)}`);
			if (reason === 'invalid_document' && JSON.stringify(result.detail) !== '{}')
				throw new Error(`expected an empty detail, got ${JSON.stringify(result.detail)}`);
			const after = await templateCounts();
			if (after.templates !== before.templates || after.versions !== before.versions)
				throw new Error(`counts changed: ${JSON.stringify({ before, after })}`);
			return result;
		};
		await check('only administrators can create a template draft', async () => {
			await expectError(createDraft(draftDocument, asEditor), '42501');
			await expectError(createDraft(draftDocument, asAnon), '42501');
			const [attributes] = await sql.unsafe(`select
				p.prosecdef as security_definer,
				p.proconfig as config,
				has_function_privilege('authenticated', p.oid, 'execute') as authenticated_may_execute,
				has_function_privilege('anon', p.oid, 'execute') as anon_may_execute
				from pg_proc p
				where p.proname = 'catalog_admin_create_template_draft'
				  and p.pronamespace = 'public'::regnamespace`);
			if (
				attributes.security_definer !== true ||
				!attributes.config.some((entry) => entry.startsWith('search_path=')) ||
				attributes.authenticated_may_execute !== true ||
				attributes.anon_may_execute !== false
			)
				throw new Error(JSON.stringify(attributes));
		});
		await check(
			'a mismatched catalog dependency refuses the draft without writing anything',
			async () => {
				const before = await templateCounts();
				const [refused] = await createDraft({
					...draftDocument,
					assets: [{ ...draftDocument.assets[0], sha256: 'f'.repeat(64) }]
				});
				if (refused.result.ok || refused.result.reason !== 'dependency_unavailable')
					throw new Error(JSON.stringify(refused.result));
				if (!refused.result.detail.assetIds.includes(draftAsset.id))
					throw new Error(`missing asset id: ${JSON.stringify(refused.result)}`);
				const after = await templateCounts();
				if (after.templates !== before.templates || after.versions !== before.versions)
					throw new Error(`counts changed: ${JSON.stringify({ before, after })}`);
			}
		);
		let draftTemplate;
		await check('a valid document creates a template with pending version 1', async () => {
			const [row] = await createDraft(draftDocument);
			if (!row.result.ok) throw new Error(JSON.stringify(row.result));
			draftTemplate = row.result.item;
			const version = draftTemplate.version;
			if (draftTemplate.template.state !== 'draft' || draftTemplate.template.revision !== 1)
				throw new Error(JSON.stringify(draftTemplate.template));
			if (
				version.version_number !== 1 ||
				version.cover_path !== null ||
				version.cover_sha256 !== null ||
				version.validation_state !== 'pending' ||
				JSON.stringify(version.slide_previews) !== '[]' ||
				version.document_sha256 !== 'e'.repeat(64) ||
				version.document_bytes !== Buffer.byteLength(JSON.stringify(draftDocument)) ||
				version.document.slides.length !== 0 ||
				version.document.assets[0].sha256 !== 'b'.repeat(64)
			)
				throw new Error(JSON.stringify(version));
			if (version.validation.created_by !== admin)
				throw new Error(`the actor was not journaled: ${JSON.stringify(version.validation)}`);
		});
		await check('exactly one dependency row pins the requested asset version', async () => {
			const rows = await asAdmin.unsafe(
				`select asset_id, asset_version_id from public.catalog_template_dependencies
				 where template_version_id = '${draftTemplate.version.id}'`
			);
			if (rows.length !== 1) throw new Error(JSON.stringify(rows));
			if (rows[0].asset_id !== draftAsset.id || rows[0].asset_version_id !== draftVersionId)
				throw new Error(JSON.stringify(rows[0]));
		});
		await check('the created version and dependency rows stay immutable', async () => {
			await expectError(
				sql.unsafe(
					`update public.catalog_template_versions set validation_state = 'validated' where id = '${draftTemplate.version.id}'`
				),
				'55000'
			);
			await expectError(
				sql.unsafe(
					`update public.catalog_template_dependencies set asset_id = '${asset.id}' where template_version_id = '${draftTemplate.version.id}'`
				),
				'55000'
			);
		});
		// Deliberately against the P50 template so this check reports the constraint
		// change on its own, even when the draft RPC is absent.
		await check('a validated template version requires a complete cover pair', async () => {
			await expectError(
				sql.unsafe(`insert into public.catalog_template_versions
					(template_id, version_number, document, document_sha256, document_bytes, slide_previews, font_requirements, validation_state)
					values ('${template.id}', 2, '{}'::jsonb, repeat('e', 64), 10, '[]'::jsonb, '[]'::jsonb, 'validated')`),
				'23514'
			);
			await expectError(
				sql.unsafe(`insert into public.catalog_template_versions
					(template_id, version_number, document, document_sha256, document_bytes, cover_path, slide_previews, font_requirements)
					values ('${template.id}', 3, '{}'::jsonb, repeat('e', 64), 10, 'templates/x/cover.png', '[]'::jsonb, '[]'::jsonb)`),
				'23514'
			);
		});

		// Review round 1: every malformed input is a business refusal, never a
		// raised cast or not-null error, and no refusal leaves rows behind.
		await check('a malformed UUID is refused before it is cast', () =>
			expectRefusal(
				createDraft({
					...draftDocument,
					assets: [
						{
							...draftDocument.assets[0],
							provenance: {
								...draftDocument.assets[0].provenance,
								catalogVersionId: '-'.repeat(36)
							}
						}
					]
				}),
				'invalid_document'
			)
		);
		await check('a SQL NULL document is refused', () =>
			expectRefusal(
				createDraftRaw("'Template copy', 'class', null, repeat('e', 64), 10"),
				'invalid_document'
			)
		);
		await check('a SQL NULL font_requirements is refused', () =>
			expectRefusal(
				createDraftRaw(
					`'Template copy', 'class', '${draftJson}'::jsonb, repeat('e', 64), ${Buffer.byteLength(draftJson)}, '', '{}'::text[], 0, null`
				),
				'invalid_document'
			)
		);
		await check('a document without an assets key is refused', () =>
			expectRefusal(createDraft({ schemaVersion: 1, slides: [] }), 'invalid_document')
		);
		await check('an asset missing catalog provenance or a MIME type is refused', async () => {
			const withoutSource = structuredClone(draftDocument.assets[0]);
			delete withoutSource.provenance.source;
			await expectRefusal(
				createDraft({ ...draftDocument, assets: [withoutSource] }),
				'invalid_document'
			);
			const withoutMime = structuredClone(draftDocument.assets[0]);
			delete withoutMime.mimeType;
			await expectRefusal(
				createDraft({ ...draftDocument, assets: [withoutMime] }),
				'invalid_document'
			);
		});
		await check('a well-formed but unknown dependency version is refused', async () => {
			const unknown = {
				...draftDocument,
				assets: [
					{
						...draftDocument.assets[0],
						provenance: {
							...draftDocument.assets[0].provenance,
							catalogVersionId: '99999999-9999-4999-8999-999999999999'
						}
					}
				]
			};
			const result = await expectRefusal(createDraft(unknown), 'dependency_unavailable');
			if (!result.detail.assetIds.includes(draftAsset.id))
				throw new Error(JSON.stringify(result.detail));
		});
		await check('an existing non-validated dependency version is refused', async () => {
			const pending = {
				...draftDocument,
				assets: [
					{
						...draftDocument.assets[0],
						provenance: {
							source: 'catalog',
							label: 'Template art',
							catalogItemId: pendingAsset.id,
							catalogVersionId: pendingVersionId
						}
					}
				]
			};
			const result = await expectRefusal(createDraft(pending), 'dependency_unavailable');
			if (!result.detail.assetIds.includes(pendingAsset.id))
				throw new Error(JSON.stringify(result.detail));
		});

		// P66: the shared editor saves the next immutable draft version against the
		// stable template's revision. The same document/dependency rules apply, and
		// the row lock turns a stale expected revision into a business refusal.
		const saveVersion = (document, revision, session = asAdmin) => {
			const json = JSON.stringify(document);
			return session.unsafe(
				`select public.catalog_admin_save_template_version('${draftTemplate.template.id}', ${revision}, '${json}'::jsonb, repeat('c', 64), ${Buffer.byteLength(json)}) as result`
			);
		};
		const draftVersionCount = async () => {
			const [row] = await sql.unsafe(
				`select count(*)::int as versions from public.catalog_template_versions where template_id = '${draftTemplate.template.id}'`
			);
			return row.versions;
		};
		await check('only administrators can save a template version', async () => {
			await expectError(saveVersion(draftDocument, 1, asEditor), '42501');
			await expectError(saveVersion(draftDocument, 1, asAnon), '42501');
		});
		await check('a stale expected revision is refused and wrote nothing', async () => {
			const before = await draftVersionCount();
			const [refused] = await saveVersion(draftDocument, 99);
			if (refused.result.ok || refused.result.reason !== 'revision_conflict')
				throw new Error(JSON.stringify(refused.result));
			if (refused.result.detail.template.revision !== 1)
				throw new Error(JSON.stringify(refused.result.detail));
			const stored = await draftVersionCount();
			if (stored !== before) throw new Error(`${before} -> ${stored}`);
		});
		await check('an invalid document is refused and wrote nothing', async () => {
			const before = await draftVersionCount();
			const [refused] = await saveVersion({ schemaVersion: 1, slides: [] }, 1);
			if (refused.result.ok || refused.result.reason !== 'invalid_document')
				throw new Error(JSON.stringify(refused.result));
			const stored = await draftVersionCount();
			if (stored !== before) throw new Error(`${before} -> ${stored}`);
		});
		await check('a mismatched catalog dependency is refused and wrote nothing', async () => {
			const before = await draftVersionCount();
			const [refused] = await saveVersion(
				{ ...draftDocument, assets: [{ ...draftDocument.assets[0], width: 65 }] },
				1
			);
			if (refused.result.ok || refused.result.reason !== 'dependency_unavailable')
				throw new Error(JSON.stringify(refused.result));
			if (!refused.result.detail.assetIds.includes(draftAsset.id))
				throw new Error(JSON.stringify(refused.result.detail));
			const stored = await draftVersionCount();
			if (stored !== before) throw new Error(`${before} -> ${stored}`);
		});
		const savedDocument = { ...draftDocument, title: 'Template copy v2' };
		await check('a valid save creates pending version 2 and advances the revision', async () => {
			const savedJson = JSON.stringify(savedDocument);
			const [row] = await saveVersion(savedDocument, 1);
			if (!row.result.ok) throw new Error(JSON.stringify(row.result));
			const { template: savedTemplate, version } = row.result.item;
			if (savedTemplate.revision !== 2) throw new Error(JSON.stringify(savedTemplate));
			if (
				version.version_number !== 2 ||
				version.document.title !== 'Template copy v2' ||
				version.cover_path !== null ||
				version.cover_sha256 !== null ||
				version.validation_state !== 'pending' ||
				JSON.stringify(version.slide_previews) !== '[]' ||
				version.document_sha256 !== 'c'.repeat(64) ||
				version.document_bytes !== Buffer.byteLength(savedJson)
			)
				throw new Error(JSON.stringify(version));
			if (
				version.validation.created_by !== admin ||
				version.validation.previous_version_number !== 1
			)
				throw new Error(`the actor was not journaled: ${JSON.stringify(version.validation)}`);
		});
		await check('version 2 has its own dependency pins and stays immutable', async () => {
			const rows = await asAdmin.unsafe(
				`select version_number, asset_id, asset_version_id from public.catalog_template_versions v
				 join public.catalog_template_dependencies d on d.template_version_id = v.id
				 where v.template_id = '${draftTemplate.template.id}' order by version_number`
			);
			if (rows.length !== 2) throw new Error(JSON.stringify(rows));
			if (
				rows[0].version_number !== 1 ||
				rows[1].version_number !== 2 ||
				rows[1].asset_id !== draftAsset.id ||
				rows[1].asset_version_id !== draftVersionId
			)
				throw new Error(JSON.stringify(rows));
			await expectError(
				sql.unsafe(
					`update public.catalog_template_versions set document = '{}'::jsonb where template_id = '${draftTemplate.template.id}' and version_number = 2`
				),
				'55000'
			);
		});
		await check(
			'an archived template cannot be saved and an unknown one is not found',
			async () => {
				const [archivedRow] = await asAdmin.unsafe(
					`select public.catalog_admin_archive_template('${draftTemplate.template.id}', 2) as result`
				);
				if (!archivedRow.result.ok) throw new Error(JSON.stringify(archivedRow.result));
				const [archived] = await saveVersion(savedDocument, 3);
				if (archived.result.ok || archived.result.reason !== 'archived')
					throw new Error(JSON.stringify(archived.result));
				const json = JSON.stringify(savedDocument);
				const [missing] = await asAdmin.unsafe(
					`select public.catalog_admin_save_template_version('12121212-1212-4212-8212-121212121212', 1, '${json}'::jsonb, repeat('c', 64), ${Buffer.byteLength(json)}) as result`
				);
				if (missing.result.ok || missing.result.reason !== 'not_found')
					throw new Error(JSON.stringify(missing.result));
			}
		);

		// P67: attaching generated slide previews. The objects are uploaded first
		// (admin, private bucket), then one guarded transaction creates the
		// successor immutable version with the manifest and cover.
		const [previewDraftRow] = await createDraft(draftDocument);
		const previewTemplate = previewDraftRow.result.item;
		const previewVersionId = previewTemplate.version.id;
		const previewPath = (ordinal) =>
			`templates/${previewTemplate.template.id}/${previewVersionId}/preview-${String(ordinal + 1).padStart(2, '0')}.png`;
		const previewManifest = () => [
			{
				ordinal: 0,
				path: previewPath(0),
				sha256: '1'.repeat(64),
				bytes: 1024,
				width: 960,
				height: 540
			},
			{
				ordinal: 1,
				path: previewPath(1),
				sha256: '2'.repeat(64),
				bytes: 2048,
				width: 960,
				height: 540
			}
		];
		const attachPreviews = (
			previews,
			{ revision = 1, sha = 'e'.repeat(64), cover = 0, session = asAdmin } = {}
		) =>
			session.unsafe(
				`select public.catalog_admin_attach_template_previews('${previewTemplate.template.id}', '${previewVersionId}', ${revision}, '${sha}', ${cover}, '${JSON.stringify(previews)}'::jsonb) as result`
			);
		const storePreviewObjects = async (previews) => {
			for (const preview of previews) {
				await sql.unsafe(
					`insert into storage.objects (bucket_id, name, metadata) values ('catalog-derivatives', '${preview.path}', '{"size": ${preview.bytes}, "mimetype": "image/png"}'::jsonb)`
				);
			}
		};
		const previewVersionCount = async () => {
			const [row] = await sql.unsafe(
				`select count(*)::int as versions from public.catalog_template_versions where template_id = '${previewTemplate.template.id}'`
			);
			return row.versions;
		};
		await check('only administrators can attach template previews', async () => {
			await expectError(attachPreviews(previewManifest(), { session: asEditor }), '42501');
			await expectError(attachPreviews(previewManifest(), { session: asAnon }), '42501');
		});
		await check('a malformed manifest or a wrong document hash is refused', async () => {
			const before = await previewVersionCount();
			const gap = previewManifest();
			gap[1].ordinal = 2;
			const [gapResult] = await attachPreviews(gap);
			if (gapResult.result.reason !== 'invalid_document')
				throw new Error(JSON.stringify(gapResult.result));
			const [coverResult] = await attachPreviews(previewManifest(), { cover: 9 });
			if (coverResult.result.reason !== 'invalid_document')
				throw new Error(JSON.stringify(coverResult.result));
			const [hashResult] = await attachPreviews(previewManifest(), { sha: 'f'.repeat(64) });
			if (hashResult.result.reason !== 'invalid_document')
				throw new Error(JSON.stringify(hashResult.result));
			const stored = await previewVersionCount();
			if (stored !== before) throw new Error(`${before} -> ${stored}`);
		});
		await check('missing preview objects are refused with their paths', async () => {
			const before = await previewVersionCount();
			const previews = previewManifest();
			const [refused] = await attachPreviews(previews);
			if (refused.result.reason !== 'media_missing')
				throw new Error(JSON.stringify(refused.result));
			if (
				refused.result.detail.paths.length !== 2 ||
				!refused.result.detail.paths.includes(previews[0].path)
			)
				throw new Error(JSON.stringify(refused.result.detail));
			const stored = await previewVersionCount();
			if (stored !== before) throw new Error(`${before} -> ${stored}`);
		});
		await check('a stale revision is refused before any version is written', async () => {
			const previews = previewManifest();
			await storePreviewObjects(previews);
			const before = await previewVersionCount();
			const [refused] = await attachPreviews(previews, { revision: 7 });
			if (refused.result.reason !== 'revision_conflict')
				throw new Error(JSON.stringify(refused.result));
			const stored = await previewVersionCount();
			if (stored !== before) throw new Error(`${before} -> ${stored}`);
		});
		await check('a valid manifest creates the successor version with cover and pins', async () => {
			const previews = previewManifest();
			const [row] = await attachPreviews(previews, { cover: 1 });
			if (!row.result.ok) throw new Error(JSON.stringify(row.result));
			const version = row.result.item.version;
			if (
				version.version_number !== 2 ||
				version.validation_state !== 'pending' ||
				version.cover_path !== previews[1].path ||
				version.cover_sha256 !== previews[1].sha256 ||
				version.slide_previews.length !== previews.length ||
				version.slide_previews.some(
					(preview, index) =>
						preview.ordinal !== previews[index].ordinal ||
						preview.path !== previews[index].path ||
						preview.sha256 !== previews[index].sha256 ||
						preview.bytes !== previews[index].bytes ||
						preview.width !== previews[index].width ||
						preview.height !== previews[index].height
				) ||
				version.document_sha256 !== 'e'.repeat(64) ||
				version.validation.previews_of !== previewVersionId ||
				version.validation.cover_ordinal !== 1
			)
				throw new Error(JSON.stringify(version));
			if (row.result.item.template.revision !== 2)
				throw new Error(JSON.stringify(row.result.item.template));
			const dependencies = await asAdmin.unsafe(
				`select asset_id, asset_version_id from public.catalog_template_dependencies where template_version_id = '${version.id}'`
			);
			if (dependencies.length !== 1 || dependencies[0].asset_id !== draftAsset.id)
				throw new Error(JSON.stringify(dependencies));
		});
		await check('a superseded pending version cannot gain previews', async () => {
			const [refused] = await attachPreviews(previewManifest(), { revision: 2 });
			if (refused.result.reason !== 'version_not_pending')
				throw new Error(JSON.stringify(refused.result));
			const [archived] = await asAdmin.unsafe(
				`select public.catalog_admin_archive_template('${previewTemplate.template.id}', 2) as result`
			);
			if (!archived.result.ok) throw new Error(JSON.stringify(archived.result));
			const [archivedRefusal] = await attachPreviews(previewManifest(), { revision: 3 });
			if (archivedRefusal.result.reason !== 'archived')
				throw new Error(JSON.stringify(archivedRefusal.result));
		});

		// P54/P55/P61: durable upload batches, leased processing jobs, conditional
		// completion and bounded cleanup.
		const storedObject = (bucket, name, size, mime) =>
			`insert into storage.objects (bucket_id, name, metadata) values ('${bucket}', '${name}', '{"size": ${size}, "mimetype": "${mime}"}'::jsonb)`;
		const reportFor = (assetId, versionId, bytes) => ({
			version_id: versionId,
			source_sha256: 'a'.repeat(64),
			source_bytes: bytes,
			source_mime: 'image/png',
			derivative_path: `assets/${assetId}/${versionId}/asset.png`,
			derivative_sha256: 'b'.repeat(64),
			derivative_bytes: 2048,
			derivative_mime: 'image/png',
			derivative_width: 512,
			derivative_height: 512,
			thumbnail_path: `assets/${assetId}/${versionId}/thumb.webp`,
			thumbnail_sha256: 'c'.repeat(64),
			thumbnail_bytes: 512,
			validation: { source_format: 'png' }
		});
		const claim = async (seconds = 300) => {
			const [row] = await asAdmin.unsafe(
				`select public.catalog_admin_claim_upload_job(${seconds}) as result`
			);
			return row.result;
		};

		let batch;
		let jobs;
		await check('an admin batch reserves one path and one draft asset per file', async () => {
			const [row] = await asAdmin.unsafe(`select public.catalog_admin_create_upload_batch(null, '[
				{"name":"Chart 01.PNG","mime":"image/png","bytes":1024},
				{"name":"logo.svg","mime":"image/svg+xml","bytes":2048},
				{"name":"Extra photo.webp","mime":"image/webp","bytes":4096}]'::jsonb) as result`);
			if (!row.result.ok) throw new Error(JSON.stringify(row.result));
			batch = row.result.item.batch;
			jobs = row.result.item.jobs;
			if (batch.state !== 'open' || batch.counts.total !== 3 || jobs.length !== 3)
				throw new Error(JSON.stringify(row.result));
			if (!jobs.every((job) => job.source_path.startsWith(`${batch.id}/`) && job.stored === false))
				throw new Error(`paths: ${JSON.stringify(jobs)}`);
			if (jobs[0].claimed_mime !== 'image/png' || jobs[1].claimed_mime !== 'image/svg+xml')
				throw new Error('claimed mime was not recorded');
			if ('lease_token' in jobs[0] || 'lease_token' in batch)
				throw new Error('the lease token leaked into the UI payload');
			const [asset] = await asAdmin.unsafe(
				`select name, kind, provenance from public.catalog_assets where id = '${jobs[1].asset_id}'`
			);
			if (
				asset.kind !== 'svg' ||
				asset.name !== 'logo' ||
				asset.provenance.original_name !== 'logo.svg'
			)
				throw new Error(JSON.stringify(asset));
		});
		await check('an unsupported content type is refused before anything is written', async () => {
			const [row] = await asAdmin.unsafe(
				`select public.catalog_admin_create_upload_batch(null, '[{"name":"bad.gif","mime":"image/gif","bytes":10}]'::jsonb) as result`
			);
			if (row.result.ok || row.result.reason !== 'invalid_file')
				throw new Error(JSON.stringify(row.result));
			const [count] = await asAdmin.unsafe(
				'select count(*)::int as value from public.catalog_upload_batches'
			);
			if (count.value !== 1) throw new Error(`batches: ${count.value}`);
		});
		await check('a job is not claimable before its source object arrives', async () => {
			const result = await claim();
			if (result.ok || result.reason !== 'none_pending') throw new Error(JSON.stringify(result));
			await sql.unsafe(storedObject('catalog-sources', jobs[0].source_path, 999, 'image/png'));
			const wrongSize = await claim();
			if (wrongSize.ok || wrongSize.reason !== 'none_pending')
				throw new Error(`wrong size: ${JSON.stringify(wrongSize)}`);
			await sql.unsafe(
				`update storage.objects set metadata = '{"size": 1024, "mimetype": "image/png"}'::jsonb where name = '${jobs[0].source_path}'`
			);
		});

		let firstClaim;
		await check('a stored job is claimed with a lease the UI never sees', async () => {
			const result = await claim();
			if (!result.ok || result.item.stage !== 'claimed' || result.item.attempts !== 1)
				throw new Error(JSON.stringify(result));
			firstClaim = { job: result.item, token: result.lease.token };
			const [status] = await asAdmin.unsafe(
				`select public.catalog_admin_upload_status('${batch.id}') as result`
			);
			if (JSON.stringify(status.result).includes(firstClaim.token))
				throw new Error('the lease token appeared in the status payload');
			if (status.result.item.jobs[0].stored !== true)
				throw new Error('the status payload did not report the stored source');
		});
		await check('a stale worker cannot complete a claimed job', async () => {
			const report = reportFor(jobs[0].asset_id, crypto.randomUUID(), 1024);
			const [row] = await asAdmin.unsafe(
				`select public.catalog_admin_complete_upload_job('${firstClaim.job.id}', '00000000-0000-0000-0000-000000000000', '${JSON.stringify(report)}'::jsonb) as result`
			);
			if (row.result.ok || row.result.reason !== 'lease_lost')
				throw new Error(JSON.stringify(row.result));
		});
		await check('a report without its derivative object is refused', async () => {
			const report = reportFor(jobs[0].asset_id, crypto.randomUUID(), 1024);
			const [row] = await asAdmin.unsafe(
				`select public.catalog_admin_complete_upload_job('${firstClaim.job.id}', '${firstClaim.token}', '${JSON.stringify(report)}'::jsonb) as result`
			);
			if (row.result.ok || row.result.reason !== 'media_missing')
				throw new Error(JSON.stringify(row.result));
		});

		const uploadVersionId = crypto.randomUUID();
		const firstReport = reportFor(jobs[0].asset_id, uploadVersionId, 1024);
		await check(
			'completion stores an immutable validated version and marks the job ready',
			async () => {
				await sql.unsafe(
					storedObject('catalog-derivatives', firstReport.derivative_path, 2048, 'image/png')
				);
				await sql.unsafe(
					storedObject('catalog-derivatives', firstReport.thumbnail_path, 512, 'image/webp')
				);
				const [row] = await asAdmin.unsafe(
					`select public.catalog_admin_complete_upload_job('${firstClaim.job.id}', '${firstClaim.token}', '${JSON.stringify(firstReport)}'::jsonb) as result`
				);
				if (!row.result.ok) throw new Error(JSON.stringify(row.result));
				if (row.result.item.stage !== 'ready' || row.result.item.progress !== 100)
					throw new Error(JSON.stringify(row.result.item));
				if (
					row.result.version.validation_state !== 'validated' ||
					row.result.version.version_number !== 1
				)
					throw new Error(JSON.stringify(row.result.version));
				if (row.result.version.source_path !== jobs[0].source_path)
					throw new Error('the version did not record the reserved source path');
				if (row.result.version.validation.job_id !== firstClaim.job.id)
					throw new Error('the report was not journaled on the version');
			}
		);
		await check('replaying a completed job with the same version id is idempotent', async () => {
			const [row] = await asAdmin.unsafe(
				`select public.catalog_admin_complete_upload_job('${firstClaim.job.id}', '${firstClaim.token}', '${JSON.stringify(firstReport)}'::jsonb) as result`
			);
			if (!row.result.ok || row.result.replayed !== true)
				throw new Error(JSON.stringify(row.result));
			const [count] = await asAdmin.unsafe(
				`select count(*)::int as value from public.catalog_asset_versions where asset_id = '${jobs[0].asset_id}'`
			);
			if (count.value !== 1) throw new Error(`versions: ${count.value}`);
		});

		let expiredClaim;
		await check(
			'an expired lease is reclaimed and the old token is refused afterwards',
			async () => {
				await sql.unsafe(
					storedObject('catalog-sources', jobs[1].source_path, 2048, 'image/svg+xml')
				);
				const first = await claim(60);
				if (!first.ok) throw new Error(JSON.stringify(first));
				await sql.unsafe(
					`update public.catalog_upload_jobs set lease_expires_at = now() - interval '1 minute' where id = '${first.item.id}'`
				);
				const second = await claim(60);
				if (!second.ok || second.item.id !== first.item.id || second.item.attempts !== 2)
					throw new Error(`reclaim: ${JSON.stringify(second)}`);
				if (second.lease.token === first.lease.token)
					throw new Error('the reclaim reused the old token');
				expiredClaim = { job: second.item, token: second.lease.token };
				const report = reportFor(jobs[1].asset_id, crypto.randomUUID(), 2048);
				const [stale] = await asAdmin.unsafe(
					`select public.catalog_admin_complete_upload_job('${first.item.id}', '${first.lease.token}', '${JSON.stringify(report)}'::jsonb) as result`
				);
				if (stale.result.ok || stale.result.reason !== 'lease_lost')
					throw new Error(`stale: ${JSON.stringify(stale.result)}`);
			}
		);
		await check('a failed job can be retried until the attempt limit', async () => {
			const [failed] = await asAdmin.unsafe(
				`select public.catalog_admin_fail_upload_job('${expiredClaim.job.id}', '${expiredClaim.token}', 'decode_failed', 'The image could not be decoded') as result`
			);
			if (!failed.result.ok || failed.result.item.stage !== 'failed')
				throw new Error(JSON.stringify(failed.result));
			const [retried] = await asAdmin.unsafe(
				`select public.catalog_admin_retry_upload_job('${expiredClaim.job.id}') as result`
			);
			if (!retried.result.ok || retried.result.item.stage !== 'queued')
				throw new Error(JSON.stringify(retried.result));
			await sql.unsafe(
				`update public.catalog_upload_jobs set attempts = 10 where id = '${expiredClaim.job.id}'`
			);
			const [exhausted] = await asAdmin.unsafe(
				`select public.catalog_admin_retry_upload_job('${expiredClaim.job.id}') as result`
			);
			if (exhausted.result.ok || exhausted.result.reason !== 'attempts_exhausted')
				throw new Error(JSON.stringify(exhausted.result));
		});

		await check(
			'cancelling a batch cancels unfinished jobs and invalidates their leases',
			async () => {
				await sql.unsafe(storedObject('catalog-sources', jobs[2].source_path, 4096, 'image/webp'));
				const held = await claim(300);
				if (!held.ok || held.item.id !== jobs[2].id) throw new Error(JSON.stringify(held));
				const [cancelled] = await asAdmin.unsafe(
					`select public.catalog_admin_cancel_upload_batch('${batch.id}') as result`
				);
				if (!cancelled.result.ok || cancelled.result.item.batch.state !== 'cancelled')
					throw new Error(JSON.stringify(cancelled.result));
				if (cancelled.result.item.jobs.find((job) => job.id === jobs[2].id).stage !== 'cancelled')
					throw new Error('the claimed job survived cancellation');
				const report = reportFor(jobs[2].asset_id, crypto.randomUUID(), 4096);
				const [late] = await asAdmin.unsafe(
					`select public.catalog_admin_complete_upload_job('${held.item.id}', '${held.lease.token}', '${JSON.stringify(report)}'::jsonb) as result`
				);
				if (late.result.ok || late.result.reason !== 'lease_lost')
					throw new Error(JSON.stringify(late.result));
				const afterCancel = await claim();
				if (afterCancel.ok || afterCancel.reason !== 'none_pending')
					throw new Error(`claim after cancel: ${JSON.stringify(afterCancel)}`);
			}
		);

		await check('the orphan listing shows only media no version references', async () => {
			await sql.unsafe(
				storedObject(
					'catalog-derivatives',
					`assets/${jobs[2].asset_id}/${crypto.randomUUID()}/asset.png`,
					4096,
					'image/png'
				)
			);
			const [row] = await asAdmin.unsafe(
				`select public.catalog_admin_list_orphan_media('${batch.id}') as result`
			);
			if (!row.result.ok) throw new Error(JSON.stringify(row.result));
			const listed = JSON.stringify(row.result.item);
			if (!listed.includes(jobs[2].source_path))
				throw new Error(`orphan source missing: ${listed}`);
			if (listed.includes(jobs[0].source_path) || listed.includes(firstReport.derivative_path))
				throw new Error(`a referenced object was listed as an orphan: ${listed}`);
			// Two jobs never produced a version (one queued, one cancelled), and the
			// completed job's own media must not appear.
			if (row.result.item.source_total !== 2 || row.result.item.derivative_total !== 1)
				throw new Error(JSON.stringify(row.result.item));
		});
		await check('cleanup refuses referenced media and journals the rest', async () => {
			const [referenced] = await asAdmin.unsafe(
				`select public.catalog_admin_record_upload_cleanup('${batch.id}', array['${firstReport.derivative_path}']) as result`
			);
			if (referenced.result.ok || referenced.result.reason !== 'media_referenced')
				throw new Error(JSON.stringify(referenced.result));
			const [ok] = await asAdmin.unsafe(
				`select public.catalog_admin_record_upload_cleanup('${batch.id}', array['${jobs[2].source_path}']) as result`
			);
			if (!ok.result.ok || ok.result.item.removed !== 1) throw new Error(JSON.stringify(ok.result));
			const [event] = await asAdmin.unsafe(
				`select outcome, detail from public.catalog_events where operation = 'upload_cleanup' order by id desc limit 1`
			);
			if (event.outcome !== 'ok' || event.detail.removed[0] !== jobs[2].source_path)
				throw new Error(JSON.stringify(event));
		});
		await check('delete policies remove orphans and protect referenced media', async () => {
			// An RLS delete that matches no row is silent rather than an error, so
			// this check counts rows instead of expecting SQLSTATE 42501.
			const remaining = async () => {
				const rows = await asAdmin.unsafe('select name from storage.objects order by name');
				return rows.map((row) => row.name);
			};
			await asAdmin.unsafe(`delete from storage.objects where name = '${jobs[2].source_path}'`);
			await asAdmin.unsafe(`delete from storage.objects where name = '${jobs[0].source_path}'`);
			await asAdmin.unsafe(
				`delete from storage.objects where name = '${firstReport.derivative_path}'`
			);
			await asEditor.unsafe(`delete from storage.objects where name = '${jobs[1].source_path}'`);
			const after = await remaining();
			if (after.includes(jobs[2].source_path))
				throw new Error('the orphan source survived the delete');
			for (const protectedPath of [
				jobs[0].source_path,
				firstReport.derivative_path,
				jobs[1].source_path
			]) {
				if (!after.includes(protectedPath))
					throw new Error(`a protected object was deleted: ${protectedPath}`);
			}
		});
		await check('ordinary users cannot call the upload RPCs', () =>
			expectError(
				asEditor.unsafe(
					`select public.catalog_admin_create_upload_batch(null, '[{"name":"a.png","mime":"image/png","bytes":10}]'::jsonb)`
				),
				'42501'
			)
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
		'PASS: catalog migrations, immutability, published-pointer integrity, RLS/Storage visibility, guarded publish/archive and the leased upload lifecycle against real PostgreSQL.'
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
