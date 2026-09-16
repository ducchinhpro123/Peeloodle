# P65 Save-as-Template Draft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a catalog administrator copy the currently open local presentation into one independent, immutable template draft after every referenced image has a validated catalog version.

**Architecture:** A pure orchestration service clones the presentation with fresh IDs, resolves existing catalog provenance, sends local media through the existing upload/processing path, rewrites only the cloned asset metadata, and calls one guarded RPC that atomically inserts the stable template, pending immutable version, and dependency pins. The existing presentation editor gains one admin-only dialog; the local presentation and shared editor model remain unchanged.

**Tech Stack:** Svelte 5, SvelteKit, TypeScript/JSDoc, Vitest browser tests, PostgreSQL/Supabase RPCs and RLS, existing catalog processing pipeline.

**Spec:** `docs/superpowers/specs/2026-09-16-milestone-6-templates-design.md`

## Global Constraints

- P65 is one independently testable increment; P66–P75 are separate plans.
- Reuse the existing presentation parser, clone helper, repositories, upload processor, and editor. Add no second editor or document model.
- The source presentation is read-only during save-as-template. The template document receives fresh document, slide, element, and asset IDs.
- Existing catalog-origin images reuse the exact validated asset/version only after hash, byte length, MIME, and dimensions match the local copy.
- Upload and process every local upload or sticker snapshot before creating the template draft. Newly created catalog assets stay drafts and are never published implicitly.
- Local images require an administrator-chosen, non-archived catalog collection.
- Template creation is one database transaction: no stable template may exist without its first immutable version and complete dependency pins.
- Pending template versions may have both cover fields null and no previews. Validated versions must have both cover fields populated. Version and dependency rows stay immutable.
- Use the caller’s authenticated session and existing admin RPC checks. Never add or expose a service-role credential.
- P53 live Supabase isolation remains unavailable without a dedicated test project; record this gap instead of claiming live verification.

## File Structure

- Create `supabase/migrations/20260916180000_catalog_template_drafts.sql` — nullable pending-cover constraint and atomic draft RPC.
- Modify `scripts/verify-catalog-sql.mjs` — P65 authorization, rollback, dependency, and immutability checks.
- Modify `src/lib/catalog/types.ts` — complete pending template-version projection and draft envelope.
- Modify `src/lib/catalog/repository.ts` — `getAssetVersion` and `createTemplateDraft` contracts.
- Modify `src/lib/catalog/parse.ts` — nullable cover fields and draft-envelope parser.
- Modify `src/lib/catalog/remote.ts` — exact-version read and draft RPC adapter.
- Modify `src/lib/catalog/remote.test.ts` — wire-shape tests.
- Modify `src/lib/cloud/database.ts` — migration-aligned row and RPC types.
- Modify `src/lib/catalog/memory.ts` — in-memory parity for exact-version reads and atomic draft creation.
- Modify `src/lib/catalog/catalog.test.ts` — in-memory semantic tests.
- Create `src/lib/presentations/templates/saveAsTemplateDraft.ts` — clone, media resolution/upload, document rewrite, hash, and final RPC.
- Create `src/lib/presentations/templates/saveAsTemplateDraft.test.ts` — orchestration and source-independence tests.
- Create `src/lib/components/presentation/SaveAsTemplateDialog.svelte` — admin metadata and collection form.
- Modify `src/lib/components/presentation/PresentationEditorPage.svelte` — flush/capture callback and admin-only action.
- Modify `src/routes/presentations/[presentationId]/+page.svelte` — membership check and separate admin repository prop.
- Modify `src/lib/components/presentation-editor-page.svelte.test.ts` — browser contract for visibility, success, and failure.
- Modify `docs/slides-implementation-plan.md`, `docs/migration-progress.md`, and `CONTEXT.md` — truthful P65 checkpoint and new seams.

---

### Task 1: Atomic Template-Draft RPC

**Files:**

- Create: `supabase/migrations/20260916180000_catalog_template_drafts.sql`
- Modify: `scripts/verify-catalog-sql.mjs`

**Interfaces:**

- Consumes: existing `catalog_require_admin()`, `catalog_templates`, `catalog_template_versions`, `catalog_asset_versions`, and `catalog_template_dependencies`.
- Produces: RPC `catalog_admin_create_template_draft(p_title text, p_use_case text, p_document jsonb, p_document_sha256 text, p_document_bytes bigint, p_description text, p_tags text[], p_sort_order integer, p_font_requirements jsonb) returns jsonb`.
- Success envelope: `{ ok: true, item: { template: <catalog_templates row>, version: <catalog_template_versions row> } }`.
- Business refusal: `{ ok: false, reason: 'invalid_document' | 'dependency_unavailable', detail: { assetIds?: uuid[] } }`.

- [ ] **Step 1: Add failing SQL-harness checks for P65**

Append checks after the existing P50 template checks in `scripts/verify-catalog-sql.mjs`. Use one document asset whose camel-case presentation fields match an existing validated asset version:

```js
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
```

Add checks that:

1. `asUser` receives SQLSTATE `42501` when calling the RPC.
2. A wrong derivative SHA returns `dependency_unavailable` and leaves both `catalog_templates` and `catalog_template_versions` counts unchanged.
3. Valid input returns a draft template plus version 1 with `cover_path is null`, `cover_sha256 is null`, `slide_previews = []`, and `validation_state = 'pending'`.
4. Exactly one dependency row pins the requested asset/version pair.
5. Updating the inserted version or dependency raises SQLSTATE `55000`.
6. Directly inserting a `validated` version with null cover fields violates a check constraint.

- [ ] **Step 2: Run the SQL harness and confirm the new checks fail**

Run:

```bash
npm run test:catalog-sql
```

Expected: failure because `catalog_admin_create_template_draft` does not exist and pending versions still require cover fields.

- [ ] **Step 3: Add the pending-cover constraints**

Create `supabase/migrations/20260916180000_catalog_template_drafts.sql` beginning with:

```sql
alter table public.catalog_template_versions
  alter column cover_path drop not null,
  alter column cover_sha256 drop not null;

alter table public.catalog_template_versions
  add constraint catalog_template_cover_pair check (
    (cover_path is null and cover_sha256 is null)
    or (cover_path is not null and cover_sha256 is not null)
  ),
  add constraint catalog_template_validated_cover check (
    validation_state <> 'validated'
    or (cover_path is not null and cover_sha256 is not null)
  );
```

Do not alter the existing immutability triggers.

- [ ] **Step 4: Implement the guarded atomic RPC**

In the same migration, implement the RPC with this transaction order:

```sql
create function public.catalog_admin_create_template_draft(
  p_title text,
  p_use_case text,
  p_document jsonb,
  p_document_sha256 text,
  p_document_bytes bigint,
  p_description text default '',
  p_tags text[] default '{}',
  p_sort_order integer default 0,
  p_font_requirements jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  template_row public.catalog_templates;
  version_row public.catalog_template_versions;
  unavailable jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_document) <> 'object'
    or jsonb_typeof(p_document->'assets') <> 'array'
    or jsonb_typeof(p_font_requirements) <> 'array'
  then
    return jsonb_build_object('ok', false, 'reason', 'invalid_document', 'detail', '{}'::jsonb);
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_document->'assets') asset
    where asset->'provenance'->>'source' <> 'catalog'
      or coalesce(asset->'provenance'->>'catalogItemId', '') !~ '^[0-9a-f-]{36}$'
      or coalesce(asset->'provenance'->>'catalogVersionId', '') !~ '^[0-9a-f-]{36}$'
      or coalesce(asset->>'byteLength', '') !~ '^[1-9][0-9]{0,8}$'
      or coalesce(asset->>'width', '') !~ '^[1-9][0-9]{0,4}$'
      or coalesce(asset->>'height', '') !~ '^[1-9][0-9]{0,4}$'
      or coalesce(asset->>'sha256', '') !~ '^[a-f0-9]{64}$'
      or asset->>'mimeType' not in ('image/png', 'image/webp')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_document', 'detail', '{}'::jsonb);
  end if;

  select coalesce(jsonb_agg(distinct asset->'provenance'->>'catalogItemId'), '[]'::jsonb)
  into unavailable
  from jsonb_array_elements(p_document->'assets') asset
  left join public.catalog_asset_versions version
    on version.id = (asset->'provenance'->>'catalogVersionId')::uuid
   and version.asset_id = (asset->'provenance'->>'catalogItemId')::uuid
  where version.id is null
     or version.validation_state <> 'validated'
     or version.derivative_sha256 <> asset->>'sha256'
     or version.derivative_bytes <> (asset->>'byteLength')::bigint
     or version.derivative_mime <> asset->>'mimeType'
     or version.derivative_width <> (asset->>'width')::integer
     or version.derivative_height <> (asset->>'height')::integer;

  if jsonb_array_length(unavailable) > 0 then
    return jsonb_build_object(
      'ok', false,
      'reason', 'dependency_unavailable',
      'detail', jsonb_build_object('assetIds', unavailable)
    );
  end if;

  insert into public.catalog_templates (title, use_case, description, tags, sort_order)
  values (p_title, p_use_case, p_description, coalesce(p_tags, '{}'), coalesce(p_sort_order, 0))
  returning * into template_row;

  insert into public.catalog_template_versions (
    template_id, version_number, document, document_sha256, document_bytes,
    cover_path, cover_sha256, slide_previews, font_requirements,
    validation_state, validation
  ) values (
    template_row.id, 1, p_document, p_document_sha256, p_document_bytes,
    null, null, '[]'::jsonb, p_font_requirements,
    'pending', jsonb_build_object('created_by', actor)
  ) returning * into version_row;

  insert into public.catalog_template_dependencies (
    template_version_id, asset_id, asset_version_id
  )
  select distinct
    version_row.id,
    (asset->'provenance'->>'catalogItemId')::uuid,
    (asset->'provenance'->>'catalogVersionId')::uuid
  from jsonb_array_elements(p_document->'assets') asset;

  insert into public.catalog_events (
    actor_id, operation, subject_table, subject_id, outcome, detail
  ) values (
    actor, 'create_draft', 'catalog_templates', template_row.id, 'ok',
    jsonb_build_object('version_id', version_row.id)
  );

  return jsonb_build_object(
    'ok', true,
    'item', jsonb_build_object(
      'template', to_jsonb(template_row),
      'version', to_jsonb(version_row)
    )
  );
end;
$$;
```

The first asset-shape check must run before the numeric casts, so malformed `byteLength`, `width`, or `height` returns `invalid_document` instead of raising. Revoke from `public, anon`; grant execution only to `authenticated`, matching the existing admin RPC migration.

- [ ] **Step 5: Run the SQL harness and confirm all checks pass**

Run:

```bash
npm run test:catalog-sql
```

Expected: every existing check plus the six P65 checks passes.

- [ ] **Step 6: Commit the database boundary**

```bash
git add supabase/migrations/20260916180000_catalog_template_drafts.sql scripts/verify-catalog-sql.mjs
git commit -m "Add atomic template draft creation"
```

---

### Task 2: Typed Repository and Supabase Adapter

**Files:**

- Modify: `src/lib/catalog/types.ts`
- Modify: `src/lib/catalog/repository.ts`
- Modify: `src/lib/catalog/parse.ts`
- Modify: `src/lib/catalog/remote.ts`
- Modify: `src/lib/catalog/remote.test.ts`
- Modify: `src/lib/cloud/database.ts`

**Interfaces:**

- Produces: `CatalogTemplateDraftInput`, `CatalogTemplateDraft`, `CatalogAdminRepository.getAssetVersion(assetId, versionId)`, and `CatalogAdminRepository.createTemplateDraft(input)`.
- Consumes: the RPC and row shape from Task 1.

- [ ] **Step 1: Add failing wire-contract tests**

In `src/lib/catalog/remote.test.ts`, add tests proving:

```ts
await catalog.getAssetVersion(assetVersionRow.asset_id, assetVersionRow.id);
expect(calls).toContainEqual(['eq', 'id', assetVersionRow.id]);
expect(calls).toContainEqual(['eq', 'asset_id', assetVersionRow.asset_id]);
```

and:

```ts
const result = await catalog.createTemplateDraft({
	metadata: {
		title: 'Class deck',
		useCase: 'class',
		description: '',
		tags: ['class'],
		sortOrder: 1
	},
	document: { schemaVersion: 1, assets: [] },
	documentSha256: 'a'.repeat(64),
	documentBytes: 128,
	fontRequirements: [{ fontId: 'be-vietnam-pro' }]
});
expect(result.ok).toBe(true);
expect(calls.at(-1)).toEqual([
	'rpc',
	'catalog_admin_create_template_draft',
	expect.objectContaining({
		p_title: 'Class deck',
		p_use_case: 'class',
		p_document_sha256: 'a'.repeat(64),
		p_document_bytes: 128
	})
]);
```

The fake RPC response must contain nested snake-case `template` and `version` rows. Also assert that a pending version with `cover_path: null` parses successfully and a validated version with a null cover is rejected by `parseTemplateVersion`.

- [ ] **Step 2: Run the focused test and confirm failure**

```bash
npm run test:unit -- --run src/lib/catalog/remote.test.ts
```

Expected: compile/runtime failures because the new methods and nullable projection do not exist.

- [ ] **Step 3: Extend catalog domain types**

In `src/lib/catalog/types.ts`, replace the narrow version projection with:

```ts
export type CatalogFontRequirement = { fontId: string };

export type CatalogTemplateVersion = {
	id: string;
	templateId: string;
	versionNumber: number;
	document: unknown;
	documentSha256: string;
	documentBytes: number;
	coverPath: string | null;
	coverSha256: string | null;
	slidePreviews: CatalogSlidePreview[];
	fontRequirements: CatalogFontRequirement[];
	validationState: CatalogValidationState;
	validation: Record<string, unknown>;
	createdAt: string;
};

export type CatalogTemplateDraft = {
	template: CatalogTemplate;
	version: CatalogTemplateVersion;
};
```

Update existing test fixtures so validated versions have a cover hash and pending versions use null for both cover fields.

- [ ] **Step 4: Add repository inputs and methods**

In `src/lib/catalog/repository.ts`, add:

```ts
export type CatalogTemplateDraftInput = {
	metadata: CatalogTemplateInput;
	document: unknown;
	documentSha256: string;
	documentBytes: number;
	fontRequirements: { fontId: string }[];
};
```

Extend `CatalogAdminRepository` with:

```ts
getAssetVersion(assetId: string, versionId: string): Promise<CatalogAssetVersion>;
createTemplateDraft(
	input: CatalogTemplateDraftInput
): Promise<CatalogActionResult<CatalogTemplateDraft>>;
```

Add `'invalid_document'` to `CatalogRefusal` and to `REFUSALS` in `parse.ts`.

- [ ] **Step 5: Parse the complete version and draft envelope**

In `src/lib/catalog/parse.ts`:

- Parse `document_sha256`, `document_bytes`, nullable `cover_path`, nullable `cover_sha256`, `font_requirements`, and `validation`.
- Reject a validated version if either cover field is null.
- Add `parseTemplateDraft(value)` that parses `{ template, version }` through `parseTemplate` and `parseTemplateVersion`.

Use this exact font parser shape:

```ts
function parseFontRequirements(value: unknown): CatalogFontRequirement[] {
	if (!Array.isArray(value)) invalid('Invalid font_requirements');
	return value.map((entry) => {
		const requirement = record(entry, 'font requirement');
		return { fontId: text(requirement, 'fontId') };
	});
}
```

- [ ] **Step 6: Implement the Supabase adapter methods**

In `src/lib/catalog/remote.ts`:

1. Expand `TEMPLATE_VERSION_COLUMNS` to include every field parsed in Step 5.
2. Add an admin exact-version query over `catalog_asset_versions` with both IDs and `.single()`.
3. Add `createTemplateDraft` calling `catalog_admin_create_template_draft` with the exact `p_*` names from Task 1 and parse its nested item with `parseTemplateDraft`.

- [ ] **Step 7: Align generated database declarations**

In `src/lib/cloud/database.ts`:

- Change `catalog_template_versions.Row.cover_path` and `.cover_sha256` to `string | null`.
- Add the `catalog_admin_create_template_draft` function declaration with the exact argument names and `Returns: Json`.

Do not make table inserts client-writable; `Insert` and `Update` remain `never`.

- [ ] **Step 8: Run focused repository tests and type checking**

```bash
npm run test:unit -- --run src/lib/catalog/remote.test.ts src/lib/catalog/catalog.test.ts
npm run check
```

Expected: tests pass and Svelte/TypeScript reports zero errors.

- [ ] **Step 9: Commit the typed adapter**

```bash
git add src/lib/catalog/types.ts src/lib/catalog/repository.ts src/lib/catalog/parse.ts src/lib/catalog/remote.ts src/lib/catalog/remote.test.ts src/lib/cloud/database.ts
git commit -m "Expose template draft repository operations"
```

---

### Task 3: In-Memory Catalog Parity

**Files:**

- Modify: `src/lib/catalog/memory.ts`
- Modify: `src/lib/catalog/catalog.test.ts`

**Interfaces:**

- Implements: `getAssetVersion` and `createTemplateDraft` from Task 2.
- Produces: a deterministic fake used by orchestration and browser tests.

- [ ] **Step 1: Add failing semantic tests**

In `src/lib/catalog/catalog.test.ts`, add one test that seeds a validated asset version and submits a matching catalog-backed document. Assert:

```ts
expect(result.ok).toBe(true);
expect(catalog.templates).toHaveLength(1);
expect(catalog.templateVersions).toHaveLength(1);
expect(catalog.dependencies).toEqual([
	{
		templateVersionId: catalog.templateVersions[0]!.id,
		assetId: sourceAsset.id,
		assetVersionId: sourceVersion.id
	}
]);
expect(catalog.templateVersions[0]).toMatchObject({
	coverPath: null,
	coverSha256: null,
	validationState: 'pending'
});
```

Add a second submission with a wrong SHA. Assert `dependency_unavailable` and unchanged lengths for all three arrays. Add an exact-version read check that rejects a mismatched asset/version pair with `CatalogError('not_found')`.

- [ ] **Step 2: Run the focused test and confirm failure**

```bash
npm run test:unit -- --run src/lib/catalog/catalog.test.ts
```

Expected: failure because `MemoryCatalog` lacks the Task 2 methods.

- [ ] **Step 3: Implement exact-version reads**

Add:

```ts
async getAssetVersion(assetId: string, versionId: string): Promise<CatalogAssetVersion> {
	this.#assertAdmin();
	const version = this.versions.find(
		(candidate) => candidate.id === versionId && candidate.assetId === assetId
	);
	if (!version) throw new CatalogError('not_found', 'Asset version not found');
	return this.#snapshot(version);
}
```

- [ ] **Step 4: Implement atomic draft creation in memory**

Validate the entire cloned document before mutating arrays:

1. Require `document.assets` to be an array.
2. For each asset, require catalog provenance and find the exact version.
3. Compare derivative SHA, bytes, MIME, width, height, and `validationState === 'validated'`.
4. If any dependency is missing or mismatched, return `dependency_unavailable` with its catalog item ID and mutate nothing.
5. Construct the template, pending version, and de-duplicated dependencies in local variables.
6. Push all three only after validation completes.
7. Return snapshots of the nested template/version envelope.

Use null cover fields and an empty preview list. Keep `document` as a `structuredClone`, never the caller’s live object.

- [ ] **Step 5: Run catalog tests**

```bash
npm run test:unit -- --run src/lib/catalog/catalog.test.ts src/lib/catalog/remote.test.ts
```

Expected: both suites pass.

- [ ] **Step 6: Commit fake parity**

```bash
git add src/lib/catalog/memory.ts src/lib/catalog/catalog.test.ts
git commit -m "Mirror template draft creation in memory"
```

---

### Task 4: Presentation-to-Template Orchestration

**Files:**

- Create: `src/lib/presentations/templates/saveAsTemplateDraft.ts`
- Create: `src/lib/presentations/templates/saveAsTemplateDraft.test.ts`

**Interfaces:**

- Consumes: `PresentationRepository`, `CatalogAdminRepository`, `clonePresentationDocumentWithNewIds`, `presentationDocumentToJson`, and `sha256Hex`.
- Produces:

```ts
export type SaveAsTemplateDraftInput = {
	sourceDocument: PresentationDocument;
	presentationRepository: PresentationRepository;
	catalogRepository: CatalogAdminRepository;
	collectionId: string | null;
	metadata: CatalogTemplateInput;
};

export type TemplateDraftErrorCode =
	| 'collection_required'
	| 'missing_media'
	| 'dependency_mismatch'
	| 'upload_failed'
	| 'draft_refused';

export class TemplateDraftError extends Error {
	readonly code: TemplateDraftErrorCode;
}

export async function saveAsTemplateDraft(
	input: SaveAsTemplateDraftInput
): Promise<CatalogTemplateDraft>;
```

- [ ] **Step 1: Write the failing orchestration tests**

Create `saveAsTemplateDraft.test.ts` with four tests:

1. **Text-only deck:** creates a pending template draft with fresh document/slide/element IDs and leaves `sourceDocument` byte-for-byte unchanged.
2. **Existing catalog image:** resolves the exact version without creating an upload batch; mismatched local bytes/metadata throw `TemplateDraftError('dependency_mismatch')` before template creation.
3. **Local image:** reads the presentation media, creates one upload batch in the chosen collection, uploads the source, processes it, rewrites only the cloned asset to the validated derivative metadata/catalog provenance, closes the batch, then creates the template draft.
4. **Processing failure:** creates no template/version/dependency; the source document and its stored media remain unchanged; the error code is `upload_failed`.

Use `createPresentationDocument`, `clonePresentationDocumentWithNewIds` expectations, `fixtureImagePng()`, `MemoryPresentationRepository`, and `MemoryCatalog`. Seed the memory catalog with the admin actor and a non-archived collection.

- [ ] **Step 2: Run the focused test and confirm failure**

```bash
npm run test:unit -- --run src/lib/presentations/templates/saveAsTemplateDraft.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement font requirement collection and safe upload names**

In `saveAsTemplateDraft.ts`, add private helpers:

```ts
function fontRequirements(document: PresentationDocument): { fontId: string }[] {
	const ids = new Set([document.theme.headingFontId, document.theme.bodyFontId]);
	for (const slide of document.slides)
		for (const element of slide.elements)
			if (element.kind === 'text')
				for (const paragraph of element.paragraphs)
					for (const run of paragraph.runs) ids.add(run.fontId);
	return [...ids].sort().map((fontId) => ({ fontId }));
}

function uploadName(index: number, mime: PresentationAsset['mimeType']): string {
	const extension = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]!;
	return `template-asset-${String(index + 1).padStart(3, '0')}.${extension}`;
}
```

- [ ] **Step 4: Implement exact catalog dependency resolution**

For each source asset with `provenance.source === 'catalog'`:

1. Require `catalogItemId` and `catalogVersionId`.
2. Call `catalogRepository.getAssetVersion(itemId, versionId)`.
3. Compare the source asset’s SHA, bytes, MIME, width, and height to the version derivative.
4. Rewrite the corresponding cloned asset from the validated version with `blobKey: catalog/<derivativeSha256>` and catalog provenance.

Throw `TemplateDraftError('dependency_mismatch', ...)` on any mismatch.

- [ ] **Step 5: Implement local-media upload and processing**

For all remaining assets:

1. Require `collectionId`; otherwise throw `collection_required` before creating a batch.
2. Read every media record first with `presentationRepository.getMedia`. Convert missing reads to `missing_media`.
3. Create one upload batch with `collectionId` and safe generated names.
4. Upload each source Blob to its reserved `job.sourcePath` in position order.
5. Process queued jobs in slices of two with `catalogRepository.processUploadJob(job.id)`.
6. Require every outcome to be `processed`.
7. Resolve each output through `getAssetVersion(job.assetId, outcome.versionId)` and rewrite the corresponding cloned asset from derivative metadata.
8. Close the batch after success. On any failure after batch creation, attempt `closeUploadBatch(batchId)` without replacing the original error, then throw `upload_failed`.

Do not call `publishAsset` or `publishCollection`.

- [ ] **Step 6: Serialize, hash, and create the draft last**

After every cloned asset is resolved:

```ts
const json = presentationDocumentToJson(templateDocument);
const bytes = new TextEncoder().encode(json);
const result = await catalogRepository.createTemplateDraft({
	metadata: input.metadata,
	document: JSON.parse(json),
	documentSha256: await sha256Hex(bytes),
	documentBytes: bytes.length,
	fontRequirements: fontRequirements(templateDocument)
});
if (!result.ok)
	throw new TemplateDraftError('draft_refused', `Template draft was refused (${result.reason})`);
return result.item;
```

No call in this function may write through `PresentationRepository`.

- [ ] **Step 7: Run orchestration and catalog tests**

```bash
npm run test:unit -- --run src/lib/presentations/templates/saveAsTemplateDraft.test.ts src/lib/catalog/catalog.test.ts src/lib/catalog/remote.test.ts
```

Expected: all pass.

- [ ] **Step 8: Commit the orchestration service**

```bash
git add src/lib/presentations/templates/saveAsTemplateDraft.ts src/lib/presentations/templates/saveAsTemplateDraft.test.ts
git commit -m "Copy presentations into template drafts"
```

---

### Task 5: Admin-Only Editor Action

**Files:**

- Create: `src/lib/components/presentation/SaveAsTemplateDialog.svelte`
- Modify: `src/lib/components/presentation/PresentationEditorPage.svelte`
- Modify: `src/routes/presentations/[presentationId]/+page.svelte`
- Modify: `src/lib/components/presentation-editor-page.svelte.test.ts`

**Interfaces:**

- `SaveAsTemplateDialog.svelte` consumes:

```js
/** @type {{
 * repository: import('$lib/catalog/repository').CatalogAdminRepository,
 * needsCollection: boolean,
 * defaultTitle: string,
 * onsave: (input: {
 *   metadata: import('$lib/catalog/repository').CatalogTemplateInput,
 *   collectionId: string | null
 * }) => Promise<void>
 * }} */
```

- `PresentationEditorPage.svelte` receives optional `catalogAdminRepository` separately from the public `catalogRepository`.
- The route passes the admin repository only after `repository.isAdmin()` returns true.

- [ ] **Step 1: Add failing browser tests**

Extend `openEditor` in `presentation-editor-page.svelte.test.ts` with an optional `catalogAdminRepository` prop.

Add tests that:

1. No “Save as template” button exists when the prop is null.
2. An admin memory repository sees the button; clicking it opens a labelled dialog.
3. Submitting a text-only deck creates one pending template version, reports `Template draft “Editor deck template” created.`, and leaves the local repository document unchanged.
4. A local-image deck requires a collection selection and shows the service’s failure in `role="alert"` without closing the dialog.

Use native input/select events and exact accessible labels; do not query implementation-only Svelte state.

- [ ] **Step 2: Run the browser test and confirm failure**

```bash
mkdir -p .tmp
TMPDIR="$PWD/.tmp" npm run test:unit -- --run src/lib/components/presentation-editor-page.svelte.test.ts
```

Expected: failure because the prop, button, and dialog do not exist.

- [ ] **Step 3: Build the focused dialog component**

Create `SaveAsTemplateDialog.svelte` using the shared `Modal` and native form controls:

- opener button text: `Save as template`;
- title default: `${defaultTitle} template`, capped at 200 characters;
- use-case `<select>` values: `class`, `research-defense`, `club-pitch`;
- description textarea;
- comma-separated tags normalized with `split(',').map(trim).filter(Boolean).slice(0, 50)`;
- collection select shown only when `needsCollection` is true;
- load non-archived collections with `repository.listCollectionsForAdmin({ limit: 100 })` when opening;
- block submission until a required collection is selected;
- disable close/submit only while the promise is running;
- keep the dialog open and show caught errors in `role="alert"`;
- close and restore opener focus after `onsave` resolves.

Use `$state` only for open/form/loading/error state and `$derived` for `canSubmit`. Use `onclick`/`onsubmit`, not legacy `on:` directives.

- [ ] **Step 4: Wire the action into the existing editor**

In `PresentationEditorPage.svelte`:

1. Add `catalogAdminRepository?: CatalogAdminRepository | null` to props.
2. Import `SaveAsTemplateDialog` and `saveAsTemplateDraft`.
3. Add an async callback that flushes `textSession`, reads `store.getState().document`, and calls the service with the local presentation repository, admin catalog repository, metadata, and collection.
4. On success set `editorNote` to `Template draft “<title>” created.`.
5. Render the dialog beside Export/Save only when the admin repository and current presentation exist.
6. Set `needsCollection` when any asset has provenance other than `catalog`.

The callback must read the document after flushing text; it must not call `saving.save()` or mutate the local store.

- [ ] **Step 5: Resolve administrator membership in the route**

In `src/routes/presentations/[presentationId]/+page.svelte`, maintain two states:

```js
/** @type {import('$lib/catalog/remote').SupabaseCatalog | null} */
let catalogRepository = $state.raw(null);
/** @type {import('$lib/catalog/repository').CatalogAdminRepository | null} */
let catalogAdminRepository = $state.raw(null);
```

After `getCatalogRepository()` resolves, set the public repository immediately, await `value.isAdmin()`, and set the admin repository only when true and the effect is still live. On failure clear both. Pass `{catalogAdminRepository}` to `PresentationEditorPage`.

The backend RPC remains the authority; hiding the button is only UI messaging.

- [ ] **Step 6: Run the Svelte autofixer until clean**

Run:

```bash
npx @sveltejs/mcp svelte-autofixer src/lib/components/presentation/SaveAsTemplateDialog.svelte --svelte-version 5
npx @sveltejs/mcp svelte-autofixer src/lib/components/presentation/PresentationEditorPage.svelte --svelte-version 5
npx @sveltejs/mcp svelte-autofixer 'src/routes/presentations/[presentationId]/+page.svelte' --svelte-version 5
```

Apply valid suggestions and repeat until no issues remain. Preserve the existing justified `leaveguard` ESLint suppression in `PresentationEditorPage.svelte`.

- [ ] **Step 7: Run focused browser and server-import tests**

```bash
TMPDIR="$PWD/.tmp" npm run test:unit -- --run src/lib/components/presentation-editor-page.svelte.test.ts src/lib/components/presentation-editor-page.server.test.ts
npm run check
```

Expected: browser contracts pass, the SSR import still does not pull native Konva/canvas, and check reports zero errors/warnings.

- [ ] **Step 8: Commit the editor action**

```bash
git add src/lib/components/presentation/SaveAsTemplateDialog.svelte src/lib/components/presentation/PresentationEditorPage.svelte 'src/routes/presentations/[presentationId]/+page.svelte' src/lib/components/presentation-editor-page.svelte.test.ts
git commit -m "Add save-as-template to the presentation editor"
```

---

### Task 6: P65 Checkpoint and Full Verification

**Files:**

- Modify: `docs/slides-implementation-plan.md`
- Modify: `docs/migration-progress.md`
- Modify: `CONTEXT.md`

**Interfaces:**

- Consumes: all P65 behavior and evidence from Tasks 1–5.
- Produces: truthful handoff state for P66.

- [ ] **Step 1: Update milestone documentation**

Make these exact documentation changes:

- Mark only P65 complete in `docs/slides-implementation-plan.md`.
- Add a dated P65 checkpoint to `docs/migration-progress.md` naming the atomic RPC, repository/service seams, editor action, SQL/browser evidence, and the fact that uploaded supporting assets remain drafts.
- Record the new migration and `src/lib/presentations/templates/saveAsTemplateDraft.ts` in `CONTEXT.md`.
- State that P53 live RLS/Storage verification remains unrun and that P66–P75 remain open.

- [ ] **Step 2: Run formatting and static checks**

```bash
npm run format
npm run check
npm run lint
npm run build
```

Expected: every command exits zero; `svelte-check` reports zero errors and zero warnings.

- [ ] **Step 3: Run unit/browser and SQL suites**

```bash
mkdir -p .tmp
TMPDIR="$PWD/.tmp" npm run test:unit -- --run
npm run test:catalog-sql
```

Expected: all unit/browser tests and every catalog SQL check pass. Do not run or claim `npm run test:catalog-live` without dedicated Supabase test credentials.

- [ ] **Step 4: Inspect the final diff and database boundary**

```bash
git diff --check
git status --short
git diff --stat HEAD~5..HEAD
```

Confirm:

- no service-role key or credential was added;
- no local presentation write occurs in `saveAsTemplateDraft.ts`;
- the template RPC is the final operation after media processing;
- the source deck remains byte-identical in tests;
- only P65 is marked complete.

- [ ] **Step 5: Commit the checkpoint**

```bash
git add docs/slides-implementation-plan.md docs/migration-progress.md CONTEXT.md
git commit -m "Checkpoint save-as-template drafts"
```
