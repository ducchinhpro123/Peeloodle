-- P68: validating a template draft version and publishing it.
--
-- A version becomes `validated` by inserting another immutable successor that
-- carries the same document, hash, previews, cover, fonts and dependency pins,
-- plus the validation facts. Version rows stay write-once, the validated row
-- documents one validation event, and the existing `catalog_admin_publish_template`
-- guard then points the stable template at it only when its dependencies are
-- still live.
--
-- The checks the server can make without a renderer are all made here:
--   * the document is the presentation schema the save RPC accepted, with
--     catalog-only asset keys and no private/source/signed-URL text;
--   * cover and slide previews are complete, dense, and consistent with each
--     other;
--   * every required font is one of the two bundled presentation typefaces
--     (the list mirrors `src/lib/presentations/rendering/fonts.ts`);
--   * every pinned asset version is the currently published version of a
--     published asset, so a missing dependency blocks validation.
-- Schema-level document limits that require the real presentation parser are
-- enforced when the document is parsed (client load/save) and when it was
-- written; this function re-checks the enumerable shape.

create function public.catalog_admin_validate_template_version(
  p_template_id uuid,
  p_version_id uuid,
  p_expected_revision bigint
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.catalog_require_admin();
  template_row public.catalog_templates;
  source public.catalog_template_versions;
  version_row public.catalog_template_versions;
  next_number integer;
  expected_count integer;
  unavailable jsonb := '[]'::jsonb;
  checks jsonb := '{}'::jsonb;
begin
  select * into template_row
  from public.catalog_templates t
  where t.id = p_template_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if template_row.state = 'archived' then
    return jsonb_build_object(
      'ok', false,
      'reason', 'archived',
      'detail', jsonb_build_object('template', to_jsonb(template_row))
    );
  end if;
  if template_row.revision <> p_expected_revision then
    return jsonb_build_object(
      'ok', false,
      'reason', 'revision_conflict',
      'detail', jsonb_build_object('template', to_jsonb(template_row))
    );
  end if;

  select * into source
  from public.catalog_template_versions v
  where v.id = p_version_id and v.template_id = p_template_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'version_not_found');
  end if;
  if source.validation_state <> 'pending'
    or exists (
      select 1 from public.catalog_template_versions v
      where v.template_id = p_template_id and v.version_number > source.version_number
    )
  then
    return jsonb_build_object(
      'ok', false,
      'reason', 'version_not_pending',
      'detail', jsonb_build_object('version', to_jsonb(source))
    );
  end if;

  -- Preview completeness and mutual consistency: a validated version always has
  -- a cover that is exactly one of its own dense, document-bound previews.
  if source.cover_path is null
    or source.cover_sha256 is null
    or jsonb_typeof(source.slide_previews) <> 'array'
  then
    return jsonb_build_object('ok', false, 'reason', 'invalid_document', 'detail', '{}'::jsonb);
  end if;
  expected_count := jsonb_array_length(source.slide_previews);
  if expected_count < 1 or expected_count > 50 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_document', 'detail', '{}'::jsonb);
  end if;
  if exists (
    select 1
    from jsonb_array_elements(source.slide_previews) preview
    where coalesce(preview->>'ordinal', '') !~ '^[0-9]{1,2}$'
      or coalesce(preview->>'sha256', '') !~ '^[a-f0-9]{64}$'
      or coalesce(preview->>'bytes', '') !~ '^[1-9][0-9]{0,7}$'
      or coalesce(preview->>'width', '') !~ '^[1-9][0-9]{0,4}$'
      or coalesce(preview->>'height', '') !~ '^[1-9][0-9]{0,4}$'
      or coalesce(preview->>'path', '') !~
         ('^templates/' || p_template_id::text
          || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
          || '/[A-Za-z0-9._-]{1,100}$')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_document', 'detail', '{}'::jsonb);
  end if;
  if not exists (
    select 1 from jsonb_array_elements(source.slide_previews) preview
    where preview->>'path' = source.cover_path
      and preview->>'sha256' = source.cover_sha256
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_document', 'detail', '{}'::jsonb);
  end if;

  -- Document shape and the enumerable limits.
  if jsonb_typeof(source.document) <> 'object'
    or source.document->>'schemaVersion' is distinct from '1'
    or jsonb_typeof(source.document->'slides') <> 'array'
    or jsonb_array_length(source.document->'slides') < 1
    or jsonb_array_length(source.document->'slides') > 50
    or jsonb_typeof(source.document->'assets') <> 'array'
  then
    return jsonb_build_object('ok', false, 'reason', 'invalid_document', 'detail', '{}'::jsonb);
  end if;
  -- Catalog-only asset keys: the save RPC accepted provenance pins; a validated
  -- version additionally stores the content-addressed key the model expects.
  if exists (
    select 1
    from jsonb_array_elements(source.document->'assets') asset
    where coalesce(asset->>'blobKey', '') <> 'catalog/' || coalesce(asset->>'sha256', '')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_document', 'detail', '{}'::jsonb);
  end if;
  -- Private source paths, signed-URL remnants or markup must never travel in a
  -- publishable document.
  if position('catalog-sources' in source.document::text) > 0
    or position('storage/v1' in source.document::text) > 0
    or position('token=' in source.document::text) > 0
    or position('<script' in source.document::text) > 0
  then
    return jsonb_build_object('ok', false, 'reason', 'invalid_document', 'detail', '{}'::jsonb);
  end if;

  -- Required fonts must be the bundled set and recorded explicitly.
  if jsonb_typeof(source.font_requirements) <> 'array'
    or jsonb_array_length(source.font_requirements) = 0
    or exists (
      select 1
      from jsonb_array_elements(source.font_requirements) font
      where coalesce(font->>'fontId', '') not in ('be-vietnam-pro', 'spectral')
    )
  then
    return jsonb_build_object('ok', false, 'reason', 'invalid_document', 'detail', '{}'::jsonb);
  end if;

  -- Every pin must be the published version of a published asset.
  select coalesce(jsonb_agg(distinct d.asset_id), '[]'::jsonb)
  into unavailable
  from public.catalog_template_dependencies d
  left join public.catalog_assets a on a.id = d.asset_id
  where d.template_version_id = p_version_id
    and (a.id is null or a.state <> 'published' or a.published_version_id is distinct from d.asset_version_id);
  if jsonb_array_length(unavailable) > 0 then
    insert into public.catalog_events (actor_id, operation, subject_table, subject_id, outcome, detail)
    values (actor, 'validate', 'catalog_templates', p_template_id, 'rejected',
      jsonb_build_object('reason', 'dependency_unavailable', 'assetIds', unavailable));
    return jsonb_build_object(
      'ok', false,
      'reason', 'dependency_unavailable',
      'detail', jsonb_build_object('assetIds', unavailable)
    );
  end if;

  checks := jsonb_build_object(
    'schemaVersion', 1,
    'slides', jsonb_array_length(source.document->'slides'),
    'assets', jsonb_array_length(source.document->'assets'),
    'previews', expected_count,
    'cover', source.cover_path,
    'fonts', source.font_requirements,
    'dependencies', (
      select count(*)::int
      from public.catalog_template_dependencies d
      where d.template_version_id = p_version_id
    )
  );

  select coalesce(max(v.version_number), 0) + 1
  into next_number
  from public.catalog_template_versions v
  where v.template_id = p_template_id;

  insert into public.catalog_template_versions (
    template_id, version_number, document, document_sha256, document_bytes,
    cover_path, cover_sha256, slide_previews, font_requirements,
    validation_state, validation
  ) values (
    p_template_id, next_number, source.document, source.document_sha256, source.document_bytes,
    source.cover_path, source.cover_sha256, source.slide_previews, source.font_requirements,
    'validated', jsonb_build_object(
      'validated_by', actor,
      'validated_from', source.id,
      'checks', checks
    )
  ) returning * into version_row;

  insert into public.catalog_template_dependencies (
    template_version_id, asset_id, asset_version_id
  )
  select version_row.id, d.asset_id, d.asset_version_id
  from public.catalog_template_dependencies d
  where d.template_version_id = source.id;

  update public.catalog_templates t
  set revision = t.revision + 1, updated_at = now()
  where t.id = p_template_id
  returning * into template_row;

  insert into public.catalog_events (
    actor_id, operation, subject_table, subject_id, outcome, detail
  ) values (
    actor, 'validate', 'catalog_templates', p_template_id, 'ok',
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

revoke all on function public.catalog_admin_validate_template_version(uuid, uuid, bigint)
  from public, anon;
grant execute on function public.catalog_admin_validate_template_version(uuid, uuid, bigint)
  to authenticated;
